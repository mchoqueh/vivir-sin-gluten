import type { ProductExternalInfoSource } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeSearchText } from "@/lib/utils";

const HIGH_CONFIDENCE_MATCH = 90;
const MIN_EXTERNAL_MATCH_CONFIDENCE = 70;

export type ProductInfoItem = {
  id: string;
  sourceType: "FOOD" | "MEDICINE";
  name: string;
  company: string | null;
  category: string | null;
  subcategory: string | null;
};

export type ExternalProductInfo = {
  id: string;
  source: ProductExternalInfoSource;
  externalName: string;
  productType: string | null;
  activeIngredient: string | null;
  components: string | null;
  holder: string | null;
  manufacturer: string | null;
  pharmaceuticalForm: string | null;
  concentration: string | null;
  saleCondition: string | null;
  sanitaryRegistry: string | null;
  registryStatus: string | null;
  sourceUrl: string | null;
  fetchedAt: Date | null;
  matchScore: number;
  matchConfidence: number;
};

type CandidateExternalInfo = Omit<
  ExternalProductInfo,
  "matchScore" | "matchConfidence"
> & {
  itemId: string;
  matchScore: number | null;
  matchConfidence: number | null;
};

function isSupplementLike(item: ProductInfoItem) {
  const text = normalizeSearchText(
    [item.name, item.category, item.subcategory].filter(Boolean).join(" "),
  );

  return /\bsuplement/.test(text);
}

function shouldLookupExternalInfo(item: ProductInfoItem) {
  return item.sourceType === "MEDICINE" || isSupplementLike(item);
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function tokens(value: string) {
  return unique(
    normalizeSearchText(value)
      .split(" ")
      .filter((token) => token.length >= 3),
  );
}

function relevantProductTokens(item: ProductInfoItem) {
  const generic = new Set([
    "capsula",
    "capsulas",
    "comprimido",
    "comprimidos",
    "jarabe",
    "gotas",
    "solucion",
    "suspension",
    "tableta",
    "tabletas",
  ]);

  return tokens(item.name).filter((token) => !generic.has(token));
}

function scoreExternalInfo(item: ProductInfoItem, info: CandidateExternalInfo) {
  if (info.itemId === item.id) {
    return Math.max(info.matchScore ?? 0, 130);
  }

  const itemName = normalizeSearchText(item.name);
  const itemCompany = normalizeSearchText(item.company ?? "");
  const externalName = normalizeSearchText(info.externalName);
  const holder = normalizeSearchText(info.holder ?? "");
  const manufacturer = normalizeSearchText(info.manufacturer ?? "");
  const itemTokens = relevantProductTokens(item);
  let score = 0;

  if (externalName === itemName) score += 120;
  else if (externalName.startsWith(itemName) || itemName.startsWith(externalName)) {
    score += 95;
  } else if (externalName.includes(itemName) || itemName.includes(externalName)) {
    score += 76;
  }

  const matchedTokens = itemTokens.filter((token) => externalName.includes(token));
  score += matchedTokens.length * 14;
  score += (matchedTokens.length / Math.max(1, itemTokens.length)) * 24;

  if (
    itemCompany &&
    (holder.includes(itemCompany) ||
      manufacturer.includes(itemCompany) ||
      itemCompany.includes(holder) ||
      itemCompany.includes(manufacturer))
  ) {
    score += 22;
  }

  return Math.round(score);
}

function confidenceFromScore(score: number) {
  if (score >= 130) return 99;
  if (score >= 110) return 94;
  if (score >= 90) return 90;
  if (score >= 76) return 82;
  if (score >= 60) return 70;
  return Math.max(0, Math.round(score));
}

function toExternalProductInfo(
  candidate: CandidateExternalInfo,
  score: number,
): ExternalProductInfo {
  return {
    id: candidate.id,
    source: candidate.source,
    externalName: candidate.externalName,
    productType: candidate.productType,
    activeIngredient: candidate.activeIngredient,
    components: candidate.components,
    holder: candidate.holder,
    manufacturer: candidate.manufacturer,
    pharmaceuticalForm: candidate.pharmaceuticalForm,
    concentration: candidate.concentration,
    saleCondition: candidate.saleCondition,
    sanitaryRegistry: candidate.sanitaryRegistry,
    registryStatus: candidate.registryStatus,
    sourceUrl: candidate.sourceUrl,
    fetchedAt: candidate.fetchedAt,
    matchScore: score,
    matchConfidence: Math.max(
      candidate.matchConfidence ?? 0,
      confidenceFromScore(score),
    ),
  };
}

export async function getExternalInfoForItem(
  item: ProductInfoItem,
): Promise<ExternalProductInfo | null> {
  if (!shouldLookupExternalInfo(item)) return null;

  const nameTokens = relevantProductTokens(item).slice(0, 5);
  const candidates = await prisma.productExternalInfo.findMany({
    where: {
      OR: [
        { itemId: item.id },
        ...nameTokens.map((token) => ({
          externalName: { contains: token, mode: "insensitive" as const },
        })),
        ...(item.company
          ? [
              {
                holder: {
                  contains: item.company,
                  mode: "insensitive" as const,
                },
              },
              {
                manufacturer: {
                  contains: item.company,
                  mode: "insensitive" as const,
                },
              },
            ]
          : []),
      ],
    },
    orderBy: [{ matchConfidence: "desc" }, { fetchedAt: "desc" }],
    take: 40,
  });

  let best: ExternalProductInfo | null = null;

  for (const candidate of candidates) {
    const score = scoreExternalInfo(item, candidate);
    const match = toExternalProductInfo(candidate, score);

    if (
      !best ||
      match.matchConfidence > best.matchConfidence ||
      (match.matchConfidence === best.matchConfidence &&
        match.matchScore > best.matchScore)
    ) {
      best = match;
    }

    if (best.matchConfidence >= HIGH_CONFIDENCE_MATCH) break;
  }

  if (process.env.NODE_ENV === "development") {
    console.log("[external-info] lookup", {
      itemId: item.id,
      name: item.name,
      candidates: candidates.length,
      confidence: best?.matchConfidence ?? 0,
    });
  }

  if (!best || best.matchConfidence < MIN_EXTERNAL_MATCH_CONFIDENCE) {
    return null;
  }

  try {
    await prisma.productExternalInfo.update({
      where: { id: best.id },
      data: {
        matchScore: best.matchScore,
        matchConfidence: best.matchConfidence,
      },
    });
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error("[external-info] score persistence failed", {
        itemId: item.id,
        externalInfoId: best.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return best;
}
