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
    await seedDebateContext(engine);

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
    await seedDebateContext(engine);
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
    await seedDebateContext(engine);
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

  it('does not wake the LLM classifier for non-debate explanatory chatter', async () => {
    const { engine, storage, llm } = setup(dirs);
    storage.updateGuildConfig({ guildId: 'guild', language: 'en', sensitivity: 'active' });
    storage.setChannelMode('guild', 'channel', 'auto');
    const messages = [
      message('1', 'a', 'I pushed the notification update because the old copy was confusing.'),
      message('2', 'b', 'Thanks, the source list in the README is enough for setup.'),
      message('3', 'a', 'The evidence is in the logs from yesterday and the deployment notes.'),
    ];

    for (const item of messages) {
      expect((await engine.handleMessage('guild', item)).kind).toBe('ignored');
    }

    expect(llm.classifyCount).toBe(0);
  });

  it('does not let forced-on channels bypass debate detection', async () => {
    const { engine, storage, llm } = setup(dirs);
    storage.updateGuildConfig({ guildId: 'guild', language: 'en', sensitivity: 'active' });
    storage.setChannelMode('guild', 'channel', 'forced_on');
    const decision = await engine.handleMessage('guild', message('1', 'a', 'tu puta madre'));

    expect(decision.kind).toBe('ignored');
    expect(llm.classifyCount).toBe(0);
  });

  it('reuses recent debate classification instead of calling the classifier for every message', async () => {
    const { engine, storage, llm } = setup(dirs);
    storage.updateGuildConfig({ guildId: 'guild', language: 'en', sensitivity: 'active' });
    storage.setChannelMode('guild', 'channel', 'auto');
    const debateMessages = [
      message('1', 'a', 'I think this policy is bad because it makes the problem worse.'),
      message('2', 'b', 'No, that is wrong because the evidence points in the opposite direction.'),
      message('3', 'a', 'Pero esa fuente no prueba lo que estas diciendo, entonces no sigue.'),
      message('4', 'b', 'That argument is wrong because the source does not support it at all.'),
      message('5', 'a', 'Your conclusion is false because the evidence is about a different policy.'),
    ];

    for (const debateMessage of debateMessages) await engine.handleMessage('guild', debateMessage);

    expect(llm.classifyCount).toBe(1);
  });

  it('backs off after provider failures instead of retrying on the next message', async () => {
    const { engine, storage, llm } = setup(dirs);
    storage.updateGuildConfig({ guildId: 'guild', language: 'en', sensitivity: 'active' });
    storage.setChannelMode('guild', 'channel', 'auto');
    llm.failNextClassification = true;
    const debateMessages = [
      message('1', 'a', 'I think this policy is bad because it makes the problem worse.'),
      message('2', 'b', 'No, that is wrong because the evidence points in the opposite direction.'),
      message('3', 'a', 'Pero esa fuente no prueba lo que estas diciendo, entonces no sigue.'),
    ];

    await expect(engine.handleMessage('guild', debateMessages[0]!)).resolves.toEqual({
      kind: 'ignored',
      reason: 'heuristic_sleep',
    });
    await expect(engine.handleMessage('guild', debateMessages[1]!)).resolves.toEqual({
      kind: 'ignored',
      reason: 'heuristic_sleep',
    });
    await expect(engine.handleMessage('guild', debateMessages[2]!)).rejects.toThrow('provider failed');

    const decision = await engine.handleMessage(
      'guild',
      message('4', 'b', 'That argument is wrong because the source does not support it at all.'),
    );

    expect(decision).toEqual({ kind: 'ignored', reason: 'provider_backoff' });
    expect(llm.classifyCount).toBe(1);
  });

  it('allows only one automatic analysis at a time per channel', async () => {
    const { engine, storage, llm } = setup(dirs);
    storage.updateGuildConfig({ guildId: 'guild', language: 'en', sensitivity: 'active' });
    storage.setChannelMode('guild', 'channel', 'auto');
    llm.assessmentDelayMs = 50;
    const debateMessages = [
      message('1', 'a', 'I think this policy is bad because it makes the problem worse.'),
      message('2', 'b', 'No, that is wrong because the evidence points in the opposite direction.'),
      message('3', 'a', 'Pero esa fuente no prueba lo que estas diciendo, entonces no sigue.'),
    ];
    for (const debateMessage of debateMessages) await engine.handleMessage('guild', debateMessage);

    const first = engine.handleMessage(
      'guild',
      message('4', 'b', 'You are clueless, so that argument is wrong because the source does not support it at all.'),
    );
    const second = await engine.handleMessage(
      'guild',
      message('5', 'a', 'Your conclusion is false because the evidence is about a different policy.'),
    );

    expect(second).toEqual({ kind: 'ignored', reason: 'analysis_in_progress' });
    expect((await first).kind).toBe('post');
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
  classifyCount = 0;
  assessmentDelayMs = 0;
  failNextClassification = false;

  assessment: FallacyAssessment = {
    isFallacy: true,
    confidence: 0.99,
    fallacyLabel: 'ad_hominem',
    quotedClaim: 'You are clueless',
    explanation: 'This attacks the person instead of the reasoning.',
  };

  async classifyDebate(_input: DebateClassificationInput): Promise<DebateClassification> {
    this.classifyCount += 1;
    if (this.failNextClassification) {
      this.failNextClassification = false;
      throw new Error('provider failed');
    }
    return { isDebate: true, confidence: 0.99, topic: 'test debate' };
  }

  async assessFallacy(_input: FallacyAssessmentInput): Promise<FallacyAssessment> {
    if (this.assessmentDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.assessmentDelayMs));
    return this.assessment;
  }

  async summarizeDiscussion(_previousSummary: string, _messages: DebateMessage[], _language: ReplyLanguage): Promise<string> {
    return 'A short debate summary.';
  }
}

function setup(dirs: string[]): { storage: Storage; llm: FakeLlm; engine: FallacyEngine } {
  const dir = mkdtempSync(join(tmpdir(), 'solecist-'));
  dirs.push(dir);
  const storage = new Storage(join(dir, 'bot.sqlite'), 100 * 1024 * 1024);
  const llm = new FakeLlm();
  return { storage, llm, engine: new FallacyEngine(storage, llm) };
}

async function seedDebateContext(engine: FallacyEngine): Promise<void> {
  const debateMessages = [
    message('context-1', 'a', 'I think this policy is bad because it makes the problem worse.'),
    message('context-2', 'b', 'No, that is wrong because the evidence points in the opposite direction.'),
    message('context-3', 'a', 'Pero esa fuente no prueba lo que estas diciendo, entonces no sigue.'),
  ];

  for (const debateMessage of debateMessages) await engine.handleMessage('guild', debateMessage);
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
