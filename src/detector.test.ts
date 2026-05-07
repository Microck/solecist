import { describe, expect, it } from 'vitest';
import {
  containsExactQuote,
  isAssessmentStale,
  isPotentialArgumentativeClaim,
  shouldWakeDebateClassifier,
} from './detector.js';
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

  it('stays asleep for ordinary explanations that are not a rebuttal exchange', () => {
    const messages = [
      message('1', 'a', 'I pushed the new notification settings because the defaults were too noisy.'),
      message('2', 'b', 'Thanks, the source list in the readme helped me understand the change.'),
      message('3', 'a', 'The evidence is in the logs from yesterday and the deployment notes.'),
    ];

    expect(shouldWakeDebateClassifier(messages)).toBe(false);
  });

  it('does not count no inside unrelated words as disagreement', () => {
    const messages = [
      message('1', 'a', 'The notification copy was updated because users missed the previous message.'),
      message('2', 'b', 'The announce channel source list is useful for onboarding.'),
      message('3', 'a', 'I added another note because the first one was too short.'),
    ];

    expect(shouldWakeDebateClassifier(messages)).toBe(false);
  });
});

describe('target claim filter', () => {
  it('rejects casual reactions that are not argumentative claims', () => {
    expect(isPotentialArgumentativeClaim('que loco tio')).toBe(false);
    expect(isPotentialArgumentativeClaim('Bueno perdon')).toBe(false);
    expect(isPotentialArgumentativeClaim('es 1 cargo por cada foto?')).toBe(false);
  });

  it('accepts concise claims with reasoning markers', () => {
    expect(isPotentialArgumentativeClaim('Porque todo el mundo lo está comprando.')).toBe(true);
    expect(isPotentialArgumentativeClaim('That is wrong because the source does not prove your claim.')).toBe(true);
  });

  it('rejects long non-argument status or planning messages', () => {
    expect(isPotentialArgumentativeClaim('I pushed the notification update and will check the deployment logs later.')).toBe(false);
    expect(isPotentialArgumentativeClaim('The source list is in the README for anyone setting up the project.')).toBe(false);
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
