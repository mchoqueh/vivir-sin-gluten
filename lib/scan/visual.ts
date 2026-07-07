import { compactOcrText, tokenizeProductSearchText } from "./normalize";

export type OcrBox = {
  text: string;
  confidence: number;
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
  width: number;
  height: number;
  area: number;
  centerX: number;
  centerY: number;
  visualWeight: number;
};

export type VisualOcrResult = {
  rawText: string;
  prioritizedText: string;
  heroText: string;
  secondaryText: string;
  dominantTokens: string[];
  secondaryTokens: string[];
  boxes: OcrBox[];
};

type TesseractBbox = {
  x0?: number;
  y0?: number;
  x1?: number;
  y1?: number;
};

type TesseractItem = {
  text?: string;
  confidence?: number;
  bbox?: TesseractBbox;
};

type TesseractData = {
  text?: string;
  lines?: TesseractItem[];
  words?: TesseractItem[];
};

function asItems(value: unknown): TesseractItem[] {
  return Array.isArray(value) ? (value as TesseractItem[]) : [];
}

function normalizeConfidence(value: number | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return 0.5;
  return Math.max(0, Math.min(1, value > 1 ? value / 100 : value));
}

function toBox(
  item: TesseractItem,
  frameWidth: number,
  frameHeight: number,
  frameArea: number,
): OcrBox | null {
  const text = item.text?.replace(/\s+/g, " ").trim();
  const bbox = item.bbox;
  if (!text || !bbox) return null;

  const x0 = Number(bbox.x0 ?? 0);
  const y0 = Number(bbox.y0 ?? 0);
  const x1 = Number(bbox.x1 ?? 0);
  const y1 = Number(bbox.y1 ?? 0);
  const width = Math.max(0, x1 - x0);
  const height = Math.max(0, y1 - y0);
  const area = width * height;
  if (width <= 0 || height <= 0 || area <= 0) return null;

  const centerX = x0 + width / 2;
  const centerY = y0 + height / 2;
  const normalizedArea = Math.min(1, area / Math.max(1, frameArea * 0.18));
  const normalizedHeight = Math.min(1, height / Math.max(1, frameHeight * 0.2));
  const ocrConfidence = normalizeConfidence(item.confidence);
  const centerDistanceX = Math.abs(centerX / frameWidth - 0.5);
  const centerDistanceY = Math.abs(centerY / frameHeight - 0.45);
  const centerBonus = Math.max(
    0,
    1 - Math.sqrt(centerDistanceX ** 2 + centerDistanceY ** 2) / 0.72,
  );
  const visualWeight =
    normalizedArea * 0.45 +
    normalizedHeight * 0.3 +
    ocrConfidence * 0.15 +
    centerBonus * 0.1;

  return {
    text,
    confidence: ocrConfidence,
    bbox: { x0, y0, x1, y1 },
    width,
    height,
    area,
    centerX,
    centerY,
    visualWeight,
  };
}

function unique(tokens: string[]) {
  return Array.from(new Set(tokens));
}

export function buildVisualOcrResult(data: unknown): VisualOcrResult {
  const ocrData = data as TesseractData;
  const rawText = compactOcrText(ocrData.text ?? "");
  const lineItems = asItems(ocrData.lines);
  const wordItems = asItems(ocrData.words);
  const sourceItems = lineItems.length > 0 ? lineItems : wordItems;
  const maxX = Math.max(
    1,
    ...sourceItems.map((item) => Number(item.bbox?.x1 ?? 0)),
  );
  const maxY = Math.max(
    1,
    ...sourceItems.map((item) => Number(item.bbox?.y1 ?? 0)),
  );
  const frameArea = maxX * maxY;
  const boxes = sourceItems
    .map((item) => toBox(item, maxX, maxY, frameArea))
    .filter((box): box is OcrBox => box !== null)
    .sort((a, b) => b.visualWeight - a.visualWeight);
  const heroBoxes = boxes.slice(0, 3);
  const heroText = heroBoxes.map((box) => box.text).join(" ");
  const secondaryText = boxes
    .slice(3, 12)
    .map((box) => box.text)
    .join(" ");
  const dominantTokens = unique(tokenizeProductSearchText(heroText));
  const secondaryTokens = unique(tokenizeProductSearchText(secondaryText));
  const prioritizedText =
    [heroText, secondaryText, rawText].filter(Boolean).join(" ") || rawText;

  return {
    rawText,
    prioritizedText: compactOcrText(prioritizedText, 260),
    heroText: compactOcrText(heroText, 120),
    secondaryText: compactOcrText(secondaryText, 160),
    dominantTokens,
    secondaryTokens,
    boxes,
  };
}
