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

const argumentMarkers = [
  'because',
  'therefore',
  'so ',
  'since ',
  'proves',
  'evidence',
  'source',
  'means that',
  'por que',
  'porque',
  'entonces',
  'por eso',
  'prueba',
  'evidencia',
  'fuente',
  'significa',
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

export function isPotentialArgumentativeClaim(content: string): boolean {
  const normalized = content.trim().toLowerCase();
  if (normalized.length < 20) return false;
  if (/^https?:\/\//.test(normalized)) return false;

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 5) return false;
  if (normalized.endsWith('?') && !argumentMarkers.some((marker) => normalized.includes(marker))) return false;

  return words.length >= 8 || argumentMarkers.some((marker) => normalized.includes(marker));
}

export function containsExactQuote(content: string, quote: string | null): quote is string {
  if (!quote) return false;
  const normalizedQuote = quote.trim();
  return normalizedQuote.length >= 8 && content.includes(normalizedQuote);
}

export function isAssessmentStale(target: DebateMessage, now = new Date()): boolean {
  return now.getTime() - target.createdAt.getTime() > 5 * 60 * 1000;
}
