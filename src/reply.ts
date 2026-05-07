import type { FallacyAssessment, ReplyLanguage } from './domain.js';
import { displayFallacyLabel } from './domain.js';

export function buildReplyText(assessment: FallacyAssessment, language: ReplyLanguage): string {
  const label = assessment.fallacyLabel ? displayFallacyLabel(assessment.fallacyLabel) : 'Fallacy';
  const quote = assessment.quotedClaim ?? '';

  if (language === 'es') {
    return `Posible falacia: ${label}\n> ${quote}\n${assessment.explanation}`;
  }

  return `Possible fallacy: ${label}\n> ${quote}\n${assessment.explanation}`;
}
