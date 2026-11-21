import type { Decisions, GenerateContentResponseUsageMetadata } from '@google/genai';

export type ClipStage = 'probe' | 'judge' | 'instant';
export type Resolution = 'low' | 'medium' | 'high';
export type ClipAnswers = Record<string, Decisions.Answer>;
export interface ClipRules { trigger: string; worthy: string; arc: string }
export const DEFAULT_RULES: ClipRules = {
  trigger: 'Does this window contain a notable reaction, surprising event, impressive skill, funny moment, or useful insight worth examining as a highlight?',
  worthy: 'Does this video contain a compelling, understandable highlight worth sharing as a short standalone clip?',
  arc: 'Does this window contain enough setup, a clear payoff, and the immediate reaction to make a complete standalone story?',
};
export interface ClipThresholds { trigger: number; worthy: number; arc: number; viral: number; hook: number }
export const DEFAULT_THRESHOLDS: ClipThresholds = { trigger: .7, worthy: .7, arc: .65, viral: .6, hook: .5 };
export interface ClipChat { name: string; text: string; offsetSec: number }
export interface ClipRequest {
  stage: ClipStage;
  capture?: ClipCapture;
  resolution: Resolution;
  media: string;
  durationSec: number;
  targetSeconds: number;
  chat: ClipChat[];
  rules: ClipRules;
}
export interface ClipResult {
  edit?: ClipEdit;
  savedClip?: SavedClip;
  selection?: 'saved' | 'below-threshold';
  answers: ClipAnswers;
  usage?: Decisions.CreateDecisionResponse['usage'];
  durationSec: number;
  sourceOffsetSec: number;
  trim: { start: number; end: number };
  media?: string;
  inspection: { request: unknown; response: Decisions.CreateDecisionResponse; elapsedMs: number; editor?: { request: unknown; response: unknown; elapsedMs: number } };
}
export interface ClipEdit {
  start: number;
  end: number;
  reason: string;
  model: string;
  usage?: GenerateContentResponseUsageMetadata;
}
export function probability(answers: ClipAnswers, key: string): number | null {
  const answer = answers[key];
  if (answer?.type === 'noul') return answer.noul;
  if (answer?.type === 'score') return answer.score / 4;
  return null;
}
export function qualifies(answers: ClipAnswers, thresholds: ClipThresholds): boolean {
  return (['worthy', 'arc', 'viral', 'hook'] as const).every(key => {
    const value = probability(answers, key);
    return value !== null && value >= thresholds[key];
  });
}
export function trimBounds(answers: ClipAnswers, duration: number) {
  const peakAnswer = answers.peak_position;
  const lengthAnswer = answers.best_clip_duration;
  const peak = peakAnswer?.type === 'choice' ? Number(peakAnswer.choice.replace('p', '')) / 100 : .5;
  const requested = lengthAnswer?.type === 'choice' ? Number(lengthAnswer.choice.replace('s', '')) : duration;
  const length = Math.min(duration, Number.isFinite(requested) && requested > 0 ? requested : duration);
  const center = (Number.isFinite(peak) ? peak : .5) * duration;
  const start = Math.max(0, Math.min(duration - length, center - length * .65));
  return { start, end: Math.min(duration, start + length) };
}

export interface ClipCapture {
  id: string;
  roomId: string;
  source: 'manual' | 'voice' | 'manual-flush' | 'auto-trigger' | 'auto-probe';
  startedAt: number;
  thresholds: ClipThresholds;
}
export interface SavedClip {
  edit?: ClipEdit;
  id: string;
  capturedAt: number;
  roomId: string;
  source: string;
  startedAt: number;
  durationSec: number;
  originalDurationSec: number;
  trim: { start: number; end: number };
  answers: ClipAnswers;
  usage?: ClipResult['usage'];
  bytes: number;
  url: string;
  downloadUrl: string;
}
