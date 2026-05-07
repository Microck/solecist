import { describe, expect, it } from 'vitest';
import { containsExactQuote, isAssessmentStale, shouldWakeDebateClassifier } from './detector.js';
import type { DebateMessage } from './domain.js';

describe('debate detector', () => {
  it('wakes for multi-participant disagreement in English or Spanish', () => {
    const messages = [
      message('1', 'a', 'I think this policy is bad because it makes the problem worse.'),
      message('2', 'b', 'No, that is wrong because the evidence points in the opposite direction.'),
      message('3', 'a', 'Pero esa fuente no prueba lo que estas diciendo, entonces no sigue.'),
    ];

    expect(shouldWakeDebateClassifier(messages)).toBe(true);
  });

  it('stays asleep for casual short chat', () => {
    const messages = [message('1', 'a', 'hello'), message('2', 'b', 'hey'), message('3', 'a', 'lol')];

    expect(shouldWakeDebateClassifier(messages)).toBe(false);
  });
});

describe('public callout guards', () => {
  it('requires exact quotes with useful length', () => {
    expect(containsExactQuote('You are wrong because X causes Y.', 'X causes Y')).toBe(true);
    expect(containsExactQuote('You are wrong because X causes Y.', 'X causes Z')).toBe(false);
    expect(containsExactQuote('abcdefg', 'abcdefg')).toBe(false);
  });

  it('marks messages older than five minutes as stale', () => {
    const target = message('1', 'a', 'This is wrong because reasons.', new Date(Date.now() - 6 * 60 * 1000));

    expect(isAssessmentStale(target)).toBe(true);
  });
});

function message(id: string, authorId: string, content: string, createdAt = new Date()): DebateMessage {
  return {
    id,
    authorId,
    channelId: 'channel',
    content,
    createdAt,
  };
}
