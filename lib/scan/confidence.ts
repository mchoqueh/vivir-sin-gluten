import {
  CANDIDATE_PERSISTENCE_WEIGHT,
  HERO_STABILITY_WEIGHT,
  OCR_QUALITY_WEIGHT,
  SEARCH_SCORE_WEIGHT,
} from "./config";
import { areSearchTextsSimilar, normalizeProductSearchText } from "./normalize";

export type CandidateReading = {
  productId: string;
  score: number;
  timestamp: number;
};

export type GlobalConfidenceInput = {
  searchScore: number;
  heroStability: number;
  qualityScore: number;
  candidatePersistence: number;
};

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

export function calculateGlobalConfidence({
  searchScore,
  heroStability,
  qualityScore,
  candidatePersistence,
}: GlobalConfidenceInput) {
  const normalizedSearchScore = clamp(searchScore);
  const normalizedHeroStability = clamp(heroStability);
  const normalizedQualityScore = clamp(qualityScore);
  const normalizedCandidatePersistence = clamp(candidatePersistence);

  return Math.round(
    normalizedSearchScore * SEARCH_SCORE_WEIGHT +
      normalizedHeroStability * HERO_STABILITY_WEIGHT +
      normalizedQualityScore * OCR_QUALITY_WEIGHT +
      normalizedCandidatePersistence * CANDIDATE_PERSISTENCE_WEIGHT,
  );
}

export function smoothGlobalConfidence(previous: number, next: number) {
  if (previous === 0) return Math.round(next);

  const smoothed = previous * 0.72 + next * 0.28;

  if (next < previous) {
    return Math.round(Math.max(previous - 3, smoothed));
  }

  return Math.round(smoothed);
}

export function calculateHeroStability(
  heroTexts: string[],
  stableHeroText: string,
) {
  const normalizedStableHero = normalizeProductSearchText(stableHeroText);
  if (!normalizedStableHero) return 0;

  const normalizedHeroes = heroTexts
    .map(normalizeProductSearchText)
    .filter(Boolean);
  if (normalizedHeroes.length === 0) return 0;

  const matchingHeroes = normalizedHeroes.filter((heroText) =>
    areSearchTextsSimilar(heroText, normalizedStableHero),
  ).length;
  const ratio = matchingHeroes / normalizedHeroes.length;

  return clamp(Math.round(ratio * 100));
}

export function calculateCandidatePersistence(
  readings: CandidateReading[],
  productId: string,
) {
  if (!productId || readings.length === 0) return 0;

  const frequency =
    readings.filter((reading) => reading.productId === productId).length /
    readings.length;
  let continuity = 0;

  for (let index = readings.length - 1; index >= 0; index -= 1) {
    if (readings[index].productId !== productId) break;
    continuity += 1;
  }

  const continuityRatio = continuity / readings.length;
  const latestSameCandidate = readings.at(-1)?.productId === productId ? 1 : 0;

  return clamp(
    Math.round(frequency * 45 + continuityRatio * 45 + latestSameCandidate * 10),
  );
}
