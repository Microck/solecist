import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  DebateClassification,
  DebateClassificationInput,
  DebateMessage,
  FallacyAssessment,
  FallacyAssessmentInput,
  LlmClient,
  ReplyLanguage,
} from './domain.js';
import { FallacyEngine } from './engine.js';
import { Storage } from './storage.js';

describe('FallacyEngine', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('does not analyze before setup is complete', async () => {
    const { engine } = setup(dirs);

    const decision = await engine.handleMessage('guild', message('1', 'a', 'No because that is not proof.'));

    expect(decision).toEqual({ kind: 'ignored', reason: 'setup_incomplete_or_stopped' });
  });

  it('posts high-confidence exact-quote findings in configured channels', async () => {
    const { engine, storage } = setup(dirs);
    storage.updateGuildConfig({ guildId: 'guild', language: 'en', sensitivity: 'active' });
    storage.setChannelMode('guild', 'channel', 'forced_on');

    const decision = await engine.handleMessage(
      'guild',
      message('1', 'a', 'You are clueless, so your argument about tax policy is wrong.'),
    );

    expect(decision.kind).toBe('post');
  });

  it('rejects findings without an exact quote from the target message', async () => {
    const { engine, storage, llm } = setup(dirs);
    storage.updateGuildConfig({ guildId: 'guild', language: 'en', sensitivity: 'active' });
    storage.setChannelMode('guild', 'channel', 'forced_on');
    llm.assessment = {
      isFallacy: true,
      confidence: 0.99,
      fallacyLabel: 'ad_hominem',
      quotedClaim: 'not actually in the message',
      explanation: 'This attacks the person instead of the reasoning.',
    };

    const decision = await engine.handleMessage('guild', message('1', 'a', 'You are clueless, so your argument is wrong.'));

    expect(decision).toEqual({ kind: 'ignored', reason: 'missing_exact_quote' });
  });

  it('prevents exact duplicate retry-loop posts', async () => {
    const { engine, storage } = setup(dirs);
    storage.updateGuildConfig({ guildId: 'guild', language: 'en', sensitivity: 'active' });
    storage.setChannelMode('guild', 'channel', 'forced_on');
    const target = message('1', 'a', 'You are clueless, so your argument is wrong.');

    expect((await engine.handleMessage('guild', target)).kind).toBe('post');
    expect(await engine.handleMessage('guild', target)).toEqual({ kind: 'ignored', reason: 'exact_duplicate' });
  });

  it('does not auto-assess casual reactions even when a channel is active', async () => {
    const { engine, storage } = setup(dirs);
    storage.updateGuildConfig({ guildId: 'guild', language: 'en', sensitivity: 'active' });
    storage.setChannelMode('guild', 'channel', 'auto');
    const debateMessages = [
      message('1', 'a', 'I think this policy is bad because it makes the problem worse.'),
      message('2', 'b', 'No, that is wrong because the evidence points in the opposite direction.'),
      message('3', 'a', 'Pero esa fuente no prueba lo que estas diciendo, entonces no sigue.'),
    ];
    for (const debateMessage of debateMessages) await engine.handleMessage('guild', debateMessage);

    const decision = await engine.handleMessage('guild', message('4', 'b', 'que loco tio'));

    expect(decision).toEqual({ kind: 'ignored', reason: 'not_argumentative_claim' });
  });

  it('manual checks return no-fallacy assessments instead of going silent', async () => {
    const { engine, storage, llm } = setup(dirs);
    storage.updateGuildConfig({ guildId: 'guild', language: 'en', sensitivity: 'active' });
    llm.assessment = {
      isFallacy: false,
      confidence: 0.2,
      fallacyLabel: null,
      quotedClaim: null,
      explanation: 'No fallacy found.',
    };

    const assessment = await engine.checkMessage('guild', message('1', 'a', 'I disagree because the source says otherwise.'));

    expect(assessment.isFallacy).toBe(false);
  });
});

class FakeLlm implements LlmClient {
  assessment: FallacyAssessment = {
    isFallacy: true,
    confidence: 0.99,
    fallacyLabel: 'ad_hominem',
    quotedClaim: 'You are clueless',
    explanation: 'This attacks the person instead of the reasoning.',
  };

  async classifyDebate(_input: DebateClassificationInput): Promise<DebateClassification> {
    return { isDebate: true, confidence: 0.99, topic: 'test debate' };
  }

  async assessFallacy(_input: FallacyAssessmentInput): Promise<FallacyAssessment> {
    return this.assessment;
  }

  async summarizeDiscussion(_previousSummary: string, _messages: DebateMessage[], _language: ReplyLanguage): Promise<string> {
    return 'A short debate summary.';
  }
}

function setup(dirs: string[]): { storage: Storage; llm: FakeLlm; engine: FallacyEngine } {
  const dir = mkdtempSync(join(tmpdir(), 'solecism-'));
  dirs.push(dir);
  const storage = new Storage(join(dir, 'bot.sqlite'), 100 * 1024 * 1024);
  const llm = new FakeLlm();
  return { storage, llm, engine: new FallacyEngine(storage, llm) };
}

function message(id: string, authorId: string, content: string): DebateMessage {
  return {
    id,
    authorId,
    channelId: 'channel',
    content,
    createdAt: new Date(),
  };
}
