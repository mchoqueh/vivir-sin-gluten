import {
  areSearchTextsSimilar,
  GENERIC_PRODUCT_TOKENS,
  normalizeProductSearchText,
  uniqueUsefulTokens,
} from "./normalize";

export type OcrReading = {
  rawText: string;
  normalizedText: string;
  usefulTokens: string[];
  heroText: string;
  secondaryText: string;
  dominantTokens: string[];
  secondaryTokens: string[];
  timestamp: number;
  qualityScore: number;
};

function countSingleLetterWords(value: string) {
  return value.split(/\s+/).filter((token) => /^[a-zA-Z]$/.test(token)).length;
}

function countSymbols(value: string) {
  return value.replace(/[a-zA-Z0-9ñÑáéíóúÁÉÍÓÚüÜ\s]/g, "").length;
}

function usefulTokenLengthScore(tokens: string[]) {
  return tokens.reduce((score, token) => {
    if (token.length >= 8) return score + 6;
    if (token.length >= 5) return score + 4;
    return score + 2;
  }, 0);
}

function genericPenalty(tokens: string[]) {
  return tokens.filter((token) => GENERIC_PRODUCT_TOKENS.has(token)).length * 6;
}

export function buildOcrReading(
  rawText: string,
  bestPreviousText = "",
  timestamp = Date.now(),
  visual?: {
    heroText?: string;
    secondaryText?: string;
    dominantTokens?: string[];
    secondaryTokens?: string[];
  },
): OcrReading {
  const normalizedText = normalizeProductSearchText(rawText);
  const usefulTokens = uniqueUsefulTokens(rawText);
  const dominantTokens = visual?.dominantTokens ?? [];
  const secondaryTokens = visual?.secondaryTokens ?? [];
  const allWords = normalizedText.split(/\s+/).filter(Boolean);
  const singleLetterWords = countSingleLetterWords(normalizedText);
  const symbols = countSymbols(rawText);
  const noiseRatio =
    rawText.length > 0 ? (symbols + singleLetterWords * 2) / rawText.length : 1;
  const abruptChangePenalty =
    bestPreviousText && !areSearchTextsSimilar(bestPreviousText, rawText)
      ? Math.min(18, Math.abs(normalizedText.length - bestPreviousText.length))
      : 0;

  const qualityScore = Math.max(
    0,
    Math.round(
      usefulTokens.length * 10 +
        dominantTokens.length * 14 +
        secondaryTokens.length * 4 +
        usefulTokenLengthScore(usefulTokens) +
        usefulTokenLengthScore(dominantTokens) +
        Math.min(14, allWords.length * 2) -
        singleLetterWords * 8 -
        symbols * 1.5 -
        noiseRatio * 30 -
        genericPenalty(allWords) -
        abruptChangePenalty,
    ),
  );

  return {
    rawText,
    normalizedText,
    usefulTokens,
    heroText: visual?.heroText ?? "",
    secondaryText: visual?.secondaryText ?? "",
    dominantTokens,
    secondaryTokens,
    timestamp,
    qualityScore,
  };
}

export function countSimilarReadings(
  readings: OcrReading[],
  reading: OcrReading,
) {
  return readings.filter((item) =>
    areSearchTextsSimilar(item.rawText, reading.rawText),
  ).length;
}

export function shouldSearchReading(
  reading: OcrReading,
  similarReadCount: number,
) {
  if (reading.usefulTokens.length === 0) return false;
  if (similarReadCount >= 2) return true;
  if (reading.qualityScore >= 48) return true;
  return reading.usefulTokens.some((token) => token.length >= 7);
}

export function isReadingBetter(
  currentBest: OcrReading | null,
  nextReading: OcrReading,
) {
  if (!currentBest) return true;
  if (areSearchTextsSimilar(currentBest.rawText, nextReading.rawText)) {
    return nextReading.qualityScore >= currentBest.qualityScore - 4;
  }

  return nextReading.qualityScore >= currentBest.qualityScore + 8;
}
