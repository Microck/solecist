import type { DebateMessage } from './domain.js';

const rebuttalPatterns = [
  /\bnot\b/u,
  /\bwrong\b/u,
  /\bfalse\b/u,
  /\bbut\b/u,
  /\bhowever\b/u,
  /\bactually\b/u,
  /\bthat does not (?:prove|show|mean|follow)\b/u,
  /\bdoesn'?t (?:prove|show|mean|follow)\b/u,
  /\bwhere is (?:the )?(?:evidence|proof|source)\b/u,
  /\bthat'?s not (?:evidence|proof|a source)\b/u,
  /\bpero\b/u,
  /\bfalso\b/u,
  /\bno (?:prueba|demuestra|significa|sigue)\b/u,
  /\bdonde esta (?:la )?(?:evidencia|prueba|fuente)\b/u,
];

const reasoningPatterns = [
  /\bbecause\b/u,
  /\btherefore\b/u,
  /\bso\b/u,
  /\bsince\b/u,
  /\bproves?\b/u,
  /\bevidence (?:shows|proves|points|supports)\b/u,
  /\bproof (?:that|of)\b/u,
  /\bsource (?:says|shows|proves|supports)\b/u,
  /\bmeans that\b/u,
  /\bpor que\b/u,
  /\bporque\b/u,
  /\bentonces\b/u,
  /\bpor eso\b/u,
  /\bprueba\b/u,
  /\bevidencia (?:demuestra|prueba|indica|apoya)\b/u,
  /\bfuente (?:dice|demuestra|prueba|apoya)\b/u,
  /\bsignifica\b/u,
];

const fallacySurfacePatterns = [
  /\beveryone\b/u,
  /\bnobody\b/u,
  /\balways\b/u,
  /\bnever\b/u,
  /\bonly\b/u,
  /\bobviously\b/u,
  /\bclueless\b/u,
  /\bidiot\b/u,
  /\bstupid\b/u,
  /\btodo el mundo\b/u,
  /\bnadie\b/u,
  /\bsiempre\b/u,
  /\bnunca\b/u,
  /\bobviamente\b/u,
];

export function shouldWakeDebateClassifier(messages: DebateMessage[]): boolean {
  if (messages.length < 3) return false;

  const recent = messages.slice(-8);
  const participants = new Set(recent.map((message) => message.authorId));
  const totalTextLength = recent.reduce((sum, message) => sum + message.content.length, 0);
  const argumentativeMessages = recent.filter((message) => hasReasoningCue(message.content) || hasRebuttalCue(message.content));
  const argumentativeParticipants = new Set(argumentativeMessages.map((message) => message.authorId));
  const rebuttalMessages = recent.filter((message) => hasRebuttalCue(message.content));

  return (
    participants.size >= 2 &&
    totalTextLength >= 180 &&
    argumentativeMessages.length >= 2 &&
    argumentativeParticipants.size >= 2 &&
    rebuttalMessages.length >= 1
  );
}

export function isPotentialArgumentativeClaim(content: string): boolean {
  const normalized = content.trim().toLowerCase();
  if (normalized.length < 20) return false;
  if (/^https?:\/\//.test(normalized)) return false;

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 5) return false;
  if (normalized.endsWith('?') && !hasReasoningCue(normalized) && !hasRebuttalCue(normalized)) return false;

  return hasReasoningCue(normalized) || hasRebuttalCue(normalized) || hasFallacySurfaceCue(normalized);
}

export function containsExactQuote(content: string, quote: string | null): quote is string {
  if (!quote) return false;
  const normalizedQuote = quote.trim();
  return normalizedQuote.length >= 8 && content.includes(normalizedQuote);
}

export function isAssessmentStale(target: DebateMessage, now = new Date()): boolean {
  return now.getTime() - target.createdAt.getTime() > 5 * 60 * 1000;
}

function hasReasoningCue(content: string): boolean {
  return matchesAny(content, reasoningPatterns);
}

function hasRebuttalCue(content: string): boolean {
  return matchesAny(content, rebuttalPatterns);
}

function hasFallacySurfaceCue(content: string): boolean {
  return matchesAny(content, fallacySurfacePatterns);
}

function matchesAny(content: string, patterns: RegExp[]): boolean {
  const normalized = content
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
  return patterns.some((pattern) => pattern.test(normalized));
}
