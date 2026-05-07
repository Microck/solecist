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

interface ChannelRuntime {
  analysisInProgress: boolean;
  debateCacheExpiresAt: number;
  isDebate: boolean;
  providerBackoffUntil: number;
  summaryCooldownUntil: number;
}

export class FallacyEngine {
  private readonly channelRuntime = new Map<string, ChannelRuntime>();

  constructor(
    private readonly storage: Storage,
    private readonly llm: LlmClient,
  ) {}

  async handleMessage(guildId: string, message: DebateMessage): Promise<EngineDecision> {
    const guildConfig = this.storage.getGuildConfig(guildId);
    if (!guildConfig.setupComplete || !guildConfig.language || guildConfig.emergencyStopped) {
      return { kind: 'ignored', reason: 'setup_incomplete_or_stopped' };
    }
    const language = guildConfig.language;

    const channelConfig = this.storage.getChannelConfig(guildId, message.channelId);
    if (!channelConfig || channelConfig.mode === 'forced_off') {
      return { kind: 'ignored', reason: 'channel_not_enabled' };
    }

    this.storage.saveMessage(message);
    const recentMessages = this.storage.recentMessages(message.channelId, 50);
    const runtime = this.runtimeFor(message.channelId);
    const now = Date.now();
    if (runtime.providerBackoffUntil > now) {
      return { kind: 'ignored', reason: 'provider_backoff' };
    }

    if (channelConfig.mode === 'auto' && !isPotentialArgumentativeClaim(message.content)) {
      return { kind: 'ignored', reason: 'not_argumentative_claim' };
    }

    if (channelConfig.mode === 'auto' && !shouldWakeDebateClassifier(recentMessages)) {
      return { kind: 'ignored', reason: 'heuristic_sleep' };
    }

    if (runtime.analysisInProgress) {
      return { kind: 'ignored', reason: 'analysis_in_progress' };
    }

    runtime.analysisInProgress = true;
    try {
      return await this.analyzeMessage(guildConfig.sensitivity, language, channelConfig.mode, message, recentMessages);
    } finally {
      runtime.analysisInProgress = false;
    }
  }

  private async analyzeMessage(
    sensitivity: 'conservative' | 'balanced' | 'active',
    language: 'en' | 'es',
    channelMode: 'auto' | 'forced_on' | 'forced_off',
    message: DebateMessage,
    recentMessages: DebateMessage[],
  ): Promise<EngineDecision> {
    if (channelMode === 'auto' && !(await this.isDebateWithCache(message.channelId, recentMessages, language))) {
      return { kind: 'ignored', reason: 'not_debate' };
    }

    const previousSummary = this.storage.getDiscussionSummary(message.channelId);
    const summary = await this.maybeSummarize(message.channelId, previousSummary, recentMessages, language);
    if (summary) this.storage.saveDiscussionSummary(message.channelId, summary);

    const assessment = await this.withProviderBackoff(message.channelId, () =>
      this.llm.assessFallacy({
        target: message,
        recentMessages: recentMessages.slice(-18),
        discussionSummary: summary,
        language,
        sensitivity,
      }),
    );

    const reason = this.publicPostRejectionReason(message, assessment, sensitivity);
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

  private async isDebateWithCache(
    channelId: string,
    recentMessages: DebateMessage[],
    language: 'en' | 'es',
  ): Promise<boolean> {
    const runtime = this.runtimeFor(channelId);
    const now = Date.now();
    if (runtime.debateCacheExpiresAt > now) return runtime.isDebate;

    const classification = await this.withProviderBackoff(channelId, () =>
      this.llm.classifyDebate({
        recentMessages: recentMessages.slice(-12),
        language,
      }),
    );
    const isDebate = classification.isDebate && classification.confidence >= 0.65;
    runtime.isDebate = isDebate;
    runtime.debateCacheExpiresAt = now + (isDebate ? 30_000 : 15_000);
    return isDebate;
  }

  private async maybeSummarize(
    channelId: string,
    previousSummary: string,
    recentMessages: DebateMessage[],
    language: 'en' | 'es',
  ): Promise<string> {
    if (recentMessages.length <= 18) return previousSummary;

    const runtime = this.runtimeFor(channelId);
    const now = Date.now();
    if (runtime.summaryCooldownUntil > now) return previousSummary;

    const summary = await this.withProviderBackoff(channelId, () =>
      this.llm.summarizeDiscussion(previousSummary, recentMessages.slice(-25), language),
    );
    runtime.summaryCooldownUntil = now + 60_000;
    return summary;
  }

  private async withProviderBackoff<T>(channelId: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.runtimeFor(channelId).providerBackoffUntil = Date.now() + 60_000;
      throw error;
    }
  }

  private runtimeFor(channelId: string): ChannelRuntime {
    const existing = this.channelRuntime.get(channelId);
    if (existing) return existing;

    const created: ChannelRuntime = {
      analysisInProgress: false,
      debateCacheExpiresAt: 0,
      isDebate: false,
      providerBackoffUntil: 0,
      summaryCooldownUntil: 0,
    };
    this.channelRuntime.set(channelId, created);
    return created;
  }
}
