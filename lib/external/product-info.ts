import type { Prisma, ProductExternalInfoSource } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeSearchText } from "@/lib/utils";

const STRONG_CONFIDENCE = 0.9;
const PROBABLE_CONFIDENCE = 0.7;

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
  confidence: number | null;
  matchReason: string | null;
  fetchedAt: Date | null;
};

type ExistingExternalInfo = ExternalProductInfo & {
  itemId: string;
};

type ExternalMatch = {
  source: ProductExternalInfoSource;
  externalName: string;
  productType?: string | null;
  activeIngredient?: string | null;
  components?: string | null;
  holder?: string | null;
  manufacturer?: string | null;
  pharmaceuticalForm?: string | null;
  concentration?: string | null;
  saleCondition?: string | null;
  sanitaryRegistry?: string | null;
  registryStatus?: string | null;
  sourceUrl?: string | null;
  rawPayload?: unknown;
  confidence: number;
  matchReason: string;
};

export type ExternalInfoSyncOptions = {
  limit?: number;
  force?: boolean;
  onlyMissing?: boolean;
  debug?: boolean;
};

export type ExternalInfoSyncResult = {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  status: "SUCCESS" | "FAILED" | "PARTIAL";
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  noMatch: number;
  errors: Array<{
    itemId: string;
    name: string;
    error: string;
  }>;
  message: string;
};

type ProviderResult = {
  source?: ProductExternalInfoSource;
  externalName?: string;
  name?: string;
  productType?: string | null;
  activeIngredient?: string | null;
  components?: string | null;
  holder?: string | null;
  manufacturer?: string | null;
  pharmaceuticalForm?: string | null;
  concentration?: string | null;
  saleCondition?: string | null;
  sanitaryRegistry?: string | null;
  registryStatus?: string | null;
  sourceUrl?: string | null;
  url?: string | null;
};

export function normalizeProductName(name: string) {
  return normalizeSearchText(name)
    .replace(/\b(comprimidos?|capsulas?|jarabe|gotas|solucion|suspension)\b/g, " ")
    .replace(/\b\d+\s*(mg|ml|mcg|g|ui)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isSupplementLike(item: ProductInfoItem) {
  return /\bsuplement/.test(
    normalizeSearchText(
      [item.name, item.category, item.subcategory].filter(Boolean).join(" "),
    ),
  );
}

function shouldSyncItem(item: ProductInfoItem) {
  return item.sourceType === "MEDICINE" || isSupplementLike(item);
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value == null) return undefined;

  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function relevantTokens(name: string) {
  const ignored = new Set([
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

  return unique(
    normalizeProductName(name)
      .split(" ")
      .filter((token) => token.length >= 3 && !ignored.has(token)),
  );
}

function calculateConfidence(item: ProductInfoItem, candidate: ProviderResult) {
  const itemName = normalizeProductName(item.name);
  const externalName = normalizeProductName(
    candidate.externalName ?? candidate.name ?? "",
  );
  const company = normalizeSearchText(item.company ?? "");
  const holder = normalizeSearchText(candidate.holder ?? "");
  const manufacturer = normalizeSearchText(candidate.manufacturer ?? "");
  const itemTokens = relevantTokens(item.name);
  let confidence = 0;
  const reasons: string[] = [];

  if (externalName && externalName === itemName) {
    confidence += 0.72;
    reasons.push("nombre exacto");
  } else if (
    externalName &&
    (externalName.startsWith(itemName) || itemName.startsWith(externalName))
  ) {
    confidence += 0.58;
    reasons.push("nombre normalizado compatible");
  } else if (
    externalName &&
    (externalName.includes(itemName) || itemName.includes(externalName))
  ) {
    confidence += 0.45;
    reasons.push("nombre contenido");
  }

  const matchedTokens = itemTokens.filter((token) => externalName.includes(token));
  if (matchedTokens.length > 0) {
    confidence += Math.min(0.22, matchedTokens.length * 0.07);
    confidence +=
      (matchedTokens.length / Math.max(1, itemTokens.length)) * 0.12;
    reasons.push(`tokens: ${matchedTokens.join(", ")}`);
  }

  if (
    company &&
    (holder.includes(company) ||
      manufacturer.includes(company) ||
      company.includes(holder) ||
      company.includes(manufacturer))
  ) {
    confidence += 0.12;
    reasons.push("empresa/laboratorio compatible");
  }

  return {
    confidence: Math.min(0.99, Number(confidence.toFixed(2))),
    matchReason: reasons.join("; ") || "sin coincidencia suficiente",
  };
}

function normalizeProviderResults(payload: unknown): ProviderResult[] {
  if (Array.isArray(payload)) return payload as ProviderResult[];
  if (
    typeof payload === "object" &&
    payload !== null &&
    Array.isArray((payload as { results?: unknown[] }).results)
  ) {
    return (payload as { results: ProviderResult[] }).results;
  }

  return [];
}

async function queryConfiguredExternalSource(
  item: ProductInfoItem,
): Promise<ProviderResult[]> {
  const endpoint = process.env.EXTERNAL_PRODUCT_INFO_ENDPOINT;
  if (!endpoint) return [];

  const url = new URL(endpoint);
  url.searchParams.set("q", item.name);
  if (item.company) url.searchParams.set("company", item.company);

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Fuente externa respondio ${response.status}`);
  }

  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("Fuente externa no devolvio JSON");
  }

  return normalizeProviderResults(JSON.parse(text));
}

function toExternalMatch(item: ProductInfoItem, candidate: ProviderResult): ExternalMatch {
  const { confidence, matchReason } = calculateConfidence(item, candidate);
  const productType =
    candidate.productType ??
    (isSupplementLike(item) ? "Suplemento alimenticio" : null);

  return {
    source: candidate.source ?? "ISP",
    externalName: candidate.externalName ?? candidate.name ?? item.name,
    productType,
    activeIngredient: candidate.activeIngredient ?? null,
    components: candidate.components ?? null,
    holder: candidate.holder ?? null,
    manufacturer: candidate.manufacturer ?? null,
    pharmaceuticalForm: candidate.pharmaceuticalForm ?? null,
    concentration: candidate.concentration ?? null,
    saleCondition: candidate.saleCondition ?? null,
    sanitaryRegistry: candidate.sanitaryRegistry ?? null,
    registryStatus: candidate.registryStatus ?? null,
    sourceUrl: candidate.sourceUrl ?? candidate.url ?? null,
    rawPayload: candidate,
    confidence,
    matchReason,
  };
}

export async function findBestExternalMatch(
  item: ProductInfoItem,
): Promise<ExternalMatch | null> {
  if (!shouldSyncItem(item)) return null;

  const providerResults = await queryConfiguredExternalSource(item);
  let best: ExternalMatch | null = null;

  for (const result of providerResults) {
    const match = toExternalMatch(item, result);
    if (!best || match.confidence > best.confidence) {
      best = match;
    }
    if (best.confidence >= STRONG_CONFIDENCE) break;
  }

  if (process.env.NODE_ENV === "development") {
    console.log("[external-info] external lookup", {
      itemId: item.id,
      name: item.name,
      candidates: providerResults.length,
      confidence: best?.confidence ?? 0,
    });
  }

  return best;
}

function toExternalProductInfo(info: ExistingExternalInfo): ExternalProductInfo {
  return {
    id: info.id,
    source: info.source,
    externalName: info.externalName,
    productType: info.productType,
    activeIngredient: info.activeIngredient,
    components: info.components,
    holder: info.holder,
    manufacturer: info.manufacturer,
    pharmaceuticalForm: info.pharmaceuticalForm,
    concentration: info.concentration,
    saleCondition: info.saleCondition,
    sanitaryRegistry: info.sanitaryRegistry,
    registryStatus: info.registryStatus,
    sourceUrl: info.sourceUrl,
    confidence: info.confidence,
    matchReason: info.matchReason,
    fetchedAt: info.fetchedAt,
  };
}

export async function getExternalInfoForItem(
  item: ProductInfoItem,
): Promise<ExternalProductInfo | null> {
  if (!shouldSyncItem(item)) return null;

  const existing = await prisma.productExternalInfo.findUnique({
    where: { itemId: item.id },
  });

  if (!existing) return null;

  return toExternalProductInfo(existing);
}

export async function syncExternalInfoForItems(
  options: ExternalInfoSyncOptions = {},
): Promise<ExternalInfoSyncResult> {
  const startedAt = new Date();
  const onlyMissing = options.onlyMissing ?? true;
  const limit = Math.max(1, Math.min(options.limit ?? 50, 500));
  const results: ExternalInfoSyncResult = {
    ok: true,
    startedAt: startedAt.toISOString(),
    finishedAt: startedAt.toISOString(),
    status: "SUCCESS",
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    noMatch: 0,
    errors: [],
    message: "Sincronizacion de fichas sanitarias finalizada.",
  };

  const items = await prisma.officialItem.findMany({
    where: {
      active: true,
      OR: [
        { sourceType: "MEDICINE" },
        { category: { contains: "suplement", mode: "insensitive" } },
        { subcategory: { contains: "suplement", mode: "insensitive" } },
        { name: { contains: "suplement", mode: "insensitive" } },
      ],
      ...(onlyMissing && !options.force ? { externalInfo: null } : {}),
    },
    select: {
      id: true,
      sourceType: true,
      name: true,
      company: true,
      category: true,
      subcategory: true,
      externalInfo: true,
    },
    take: limit,
    orderBy: { updatedAt: "desc" },
  });

  for (const item of items) {
    results.processed += 1;

    try {
      if (item.externalInfo?.source === "MANUAL") {
        results.skipped += 1;
        continue;
      }

      if (item.externalInfo && !options.force) {
        results.skipped += 1;
        continue;
      }

      const match = await findBestExternalMatch(item);

      if (!match || match.confidence < PROBABLE_CONFIDENCE) {
        results.noMatch += 1;
        continue;
      }

      if (
        item.externalInfo?.confidence != null &&
        item.externalInfo.confidence > match.confidence
      ) {
        results.skipped += 1;
        continue;
      }

      const data = {
        source: match.source,
        externalName: match.externalName,
        productType: match.productType,
        activeIngredient: match.activeIngredient,
        components: match.components,
        holder: match.holder,
        manufacturer: match.manufacturer,
        pharmaceuticalForm: match.pharmaceuticalForm,
        concentration: match.concentration,
        saleCondition: match.saleCondition,
        sanitaryRegistry: match.sanitaryRegistry,
        registryStatus: match.registryStatus,
        sourceUrl: match.sourceUrl,
        confidence: match.confidence,
        matchReason: match.matchReason,
        rawPayload: toPrismaJson(match.rawPayload),
        fetchedAt: new Date(),
      };

      if (item.externalInfo) {
        await prisma.productExternalInfo.update({
          where: { itemId: item.id },
          data,
        });
        results.updated += 1;
      } else {
        await prisma.productExternalInfo.create({
          data: {
            itemId: item.id,
            ...data,
          },
        });
        results.created += 1;
      }
    } catch (error) {
      results.errors.push({
        itemId: item.id,
        name: item.name,
        error: error instanceof Error ? error.message : "Error desconocido",
      });
      if (options.debug || process.env.NODE_ENV === "development") {
        console.error("[external-info] item sync failed", {
          itemId: item.id,
          name: item.name,
          error: error instanceof Error ? error.message : "Error desconocido",
        });
      }
    }
  }

  results.finishedAt = new Date().toISOString();
  if (results.errors.length > 0) {
    results.status = results.errors.length === results.processed ? "FAILED" : "PARTIAL";
    results.ok = results.status !== "FAILED";
  }

  if (!process.env.EXTERNAL_PRODUCT_INFO_ENDPOINT) {
    results.message =
      "No hay fuente externa configurada. Define EXTERNAL_PRODUCT_INFO_ENDPOINT o carga fichas manuales.";
  }

  return results;
}
