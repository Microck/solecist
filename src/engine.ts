import type { DebateMessage, FallacyAssessment, LlmClient } from './domain.js';
import {
  containsExactQuote,
  isAssessmentStale,
  isPotentialArgumentativeClaim,
  shouldWakeDebateClassifier,
} from './detector.js';
import { thresholdFor } from './domain.js';
import type { Storage } from './storage.js';

export type EngineDecision =
  | { kind: 'ignored'; reason: string }
  | { kind: 'post'; assessment: FallacyAssessment; eventId: number };

export class FallacyEngine {
  constructor(
    private readonly storage: Storage,
    private readonly llm: LlmClient,
  ) {}

  async handleMessage(guildId: string, message: DebateMessage): Promise<EngineDecision> {
    const guildConfig = this.storage.getGuildConfig(guildId);
    if (!guildConfig.setupComplete || !guildConfig.language || guildConfig.emergencyStopped) {
      return { kind: 'ignored', reason: 'setup_incomplete_or_stopped' };
    }

    const channelConfig = this.storage.getChannelConfig(guildId, message.channelId);
    if (!channelConfig || channelConfig.mode === 'forced_off') {
      return { kind: 'ignored', reason: 'channel_not_enabled' };
    }

    this.storage.saveMessage(message);
    const recentMessages = this.storage.recentMessages(message.channelId, 50);

    if (channelConfig.mode === 'auto' && shouldWakeDebateClassifier(recentMessages)) {
      const classification = await this.llm.classifyDebate({
        recentMessages: recentMessages.slice(-12),
        language: guildConfig.language,
      });
      if (!classification.isDebate || classification.confidence < 0.65) {
        return { kind: 'ignored', reason: 'not_debate' };
      }
    }

    if (channelConfig.mode === 'auto' && !shouldWakeDebateClassifier(recentMessages)) {
      return { kind: 'ignored', reason: 'heuristic_sleep' };
    }

    if (channelConfig.mode === 'auto' && !isPotentialArgumentativeClaim(message.content)) {
      return { kind: 'ignored', reason: 'not_argumentative_claim' };
    }

    const previousSummary = this.storage.getDiscussionSummary(message.channelId);
    const summary =
      recentMessages.length > 18
        ? await this.llm.summarizeDiscussion(previousSummary, recentMessages.slice(-25), guildConfig.language)
        : previousSummary;
    if (summary) this.storage.saveDiscussionSummary(message.channelId, summary);

    const assessment = await this.llm.assessFallacy({
      target: message,
      recentMessages: recentMessages.slice(-18),
      discussionSummary: summary,
      language: guildConfig.language,
      sensitivity: guildConfig.sensitivity,
    });

    const reason = this.publicPostRejectionReason(message, assessment, guildConfig.sensitivity);
    if (reason) {
      this.storage.recordFallacyEvent({
        messageId: message.id,
        channelId: message.channelId,
        label: assessment.fallacyLabel,
        confidence: assessment.confidence,
        quotedClaim: assessment.quotedClaim,
        explanation: assessment.explanation,
        posted: false,
        reason,
      });
      return { kind: 'ignored', reason };
    }

    const eventId = this.storage.recordFallacyEvent({
      messageId: message.id,
      channelId: message.channelId,
      label: assessment.fallacyLabel,
      confidence: assessment.confidence,
      quotedClaim: assessment.quotedClaim,
      explanation: assessment.explanation,
      posted: true,
      reason: 'posted',
    });

    return { kind: 'post', assessment, eventId };
  }

  async checkMessage(guildId: string, message: DebateMessage): Promise<FallacyAssessment> {
    const guildConfig = this.storage.getGuildConfig(guildId);
    const language = guildConfig.language ?? 'en';
    const recentMessages = this.storage.recentMessages(message.channelId, 50);
    const summary = this.storage.getDiscussionSummary(message.channelId);

    return this.llm.assessFallacy({
      target: message,
      recentMessages,
      discussionSummary: summary,
      language,
      sensitivity: guildConfig.sensitivity,
    });
  }

  private publicPostRejectionReason(
    message: DebateMessage,
    assessment: FallacyAssessment,
    sensitivity: 'conservative' | 'balanced' | 'active',
  ): string | null {
    if (!assessment.isFallacy) return 'no_fallacy';
    if (!assessment.fallacyLabel) return 'missing_label';
    if (!containsExactQuote(message.content, assessment.quotedClaim)) return 'missing_exact_quote';
    if (assessment.confidence < thresholdFor(assessment.fallacyLabel, sensitivity)) return 'below_threshold';
    if (isAssessmentStale(message)) return 'stale';
    if (this.storage.hasExactPostedEvent(message.id, assessment.fallacyLabel, assessment.quotedClaim)) {
      return 'exact_duplicate';
    }
    return null;
  }
}
