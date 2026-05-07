import type { DebateMessage } from './domain.js';

const disagreementTerms = [
  'no',
  'not',
  'wrong',
  'because',
  'therefore',
  'but',
  'however',
  'actually',
  'false',
  'evidence',
  'proof',
  'source',
  'why',
  'pero',
  'porque',
  'entonces',
  'falso',
  'prueba',
  'evidencia',
  'fuente',
];

export function shouldWakeDebateClassifier(messages: DebateMessage[]): boolean {
  if (messages.length < 3) return false;

  const recent = messages.slice(-8);
  const participants = new Set(recent.map((message) => message.authorId));
  const totalTextLength = recent.reduce((sum, message) => sum + message.content.length, 0);
  const disagreementHits = recent.filter((message) => {
    const lower = message.content.toLowerCase();
    return disagreementTerms.some((term) => lower.includes(term));
  }).length;

  return participants.size >= 2 && totalTextLength >= 160 && disagreementHits >= 2;
}

export function containsExactQuote(content: string, quote: string | null): quote is string {
  if (!quote) return false;
  const normalizedQuote = quote.trim();
  return normalizedQuote.length >= 8 && content.includes(normalizedQuote);
}

export function isAssessmentStale(target: DebateMessage, now = new Date()): boolean {
  return now.getTime() - target.createdAt.getTime() > 5 * 60 * 1000;
}
