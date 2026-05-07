export const fallacyLabels = [
  'ad_hominem',
  'strawman',
  'false_dilemma',
  'slippery_slope',
  'appeal_to_authority',
  'appeal_to_popularity',
  'appeal_to_emotion',
  'red_herring',
  'whataboutism',
  'tu_quoque',
  'hasty_generalization',
  'false_cause',
  'circular_reasoning',
  'burden_shifting',
  'moving_goalposts',
] as const;

export type FallacyLabel = (typeof fallacyLabels)[number];
export type Sensitivity = 'conservative' | 'balanced' | 'active';
export type ReplyLanguage = 'en' | 'es';
export type ChannelMode = 'auto' | 'forced_on' | 'forced_off';
export type FeedbackValue = 'useful' | 'wrong' | 'noisy';

export interface DebateMessage {
  id: string;
  channelId: string;
  authorId: string;
  content: string;
  createdAt: Date;
}

export interface DiscussionState {
  channelId: string;
  summary: string;
  startedAt: Date;
  updatedAt: Date;
}

export interface DebateClassificationInput {
  recentMessages: DebateMessage[];
  language: ReplyLanguage;
}

export interface DebateClassification {
  isDebate: boolean;
  confidence: number;
  topic: string | null;
}

export interface FallacyAssessmentInput {
  target: DebateMessage;
  recentMessages: DebateMessage[];
  discussionSummary: string;
  language: ReplyLanguage;
  sensitivity: Sensitivity;
}

export interface FallacyAssessment {
  isFallacy: boolean;
  confidence: number;
  fallacyLabel: FallacyLabel | null;
  quotedClaim: string | null;
  explanation: string;
}

export interface LlmClient {
  classifyDebate(input: DebateClassificationInput): Promise<DebateClassification>;
  assessFallacy(input: FallacyAssessmentInput): Promise<FallacyAssessment>;
  summarizeDiscussion(previousSummary: string, messages: DebateMessage[], language: ReplyLanguage): Promise<string>;
}

export const sensitivityThresholds: Record<Sensitivity, number> = {
  conservative: 0.9,
  balanced: 0.82,
  active: 0.72,
};

export const subtleFallacyLabels = new Set<FallacyLabel>([
  'strawman',
  'moving_goalposts',
  'red_herring',
  'false_cause',
  'burden_shifting',
]);

export function thresholdFor(label: FallacyLabel, sensitivity: Sensitivity): number {
  const base = sensitivityThresholds[sensitivity];
  return subtleFallacyLabels.has(label) ? Math.min(base + 0.08, 0.95) : base;
}

export function displayFallacyLabel(label: FallacyLabel): string {
  return label
    .split('_')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}
