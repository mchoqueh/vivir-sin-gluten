import type { Prisma, ProductExternalInfoSource } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeSearchText } from "@/lib/utils";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const MIN_CONFIDENCE_TO_SAVE = 0.7;
const DEFAULT_BACKFILL_LIMIT = 25;
const MAX_BACKFILL_LIMIT = 100;

const inFlightByItemId = new Map<
  string,
  Promise<ExternalInfoGenerationResult>
>();

export type ProductInfoItem = {
  id: string;
  sourceType: "FOOD" | "MEDICINE";
  name: string;
  company: string | null;
  category: string | null;
  subcategory: string | null;
};

export type ExternalInfoSourceLink = {
  title: string;
  url: string;
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
  summary: string | null;
  sources: ExternalInfoSourceLink[];
  sourceUrl: string | null;
  confidence: number | null;
  matchReason: string | null;
  rawPayload?: Prisma.JsonValue | null;
  fetchedAt: Date | null;
};

type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
  raw_content?: string | null;
  score?: number;
};

type TavilyResponse = {
  answer?: string | null;
  results?: TavilyResult[];
};

type ExtractedProductInformation = {
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
  summary: string | null;
  sources: ExternalInfoSourceLink[];
  sourceUrl: string | null;
  rawPayload: TavilyResponse[];
  searchText: string;
};

export type ExternalInfoDebug = {
  provider: "TAVILY";
  confidence?: number;
  matchReason?: string;
  fetchedAt?: string;
  rawPayload?: Prisma.JsonValue | null;
  error?: string;
  queriesUsed?: number;
  resultsFound?: number;
  saved?: boolean;
};

type ExternalInfoGenerationResult = {
  info: ExternalProductInfo | null;
  debug: ExternalInfoDebug;
};

export function externalInfoPublicPayload(info: ExternalProductInfo | null) {
  if (!info) return null;

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
    summary: info.summary,
    sources: info.sources,
    sourceUrl: info.sourceUrl,
    fetchedAt: info.fetchedAt?.toISOString() ?? null,
  };
}

export function externalInfoGenerationPublicPayload(
  result: ExternalInfoGenerationResult,
) {
  return {
    externalInfo: externalInfoPublicPayload(result.info),
    debug: result.debug,
  };
}

export type BackfillExternalInfoOptions = {
  olderThanDays?: number;
  limit?: number;
  force?: boolean;
  debug?: boolean;
};

export type BackfillExternalInfoResult = {
  ok: boolean;
  type: "EXTERNAL_INFO_BACKFILL";
  startedAt: string;
  finishedAt: string;
  status: "SUCCESS" | "FAILED" | "PARTIAL";
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  noMatch: number;
  errors: Array<{ itemId: string; name: string; error: string }>;
  message: string;
};

export function normalizeProductName(name: string) {
  return normalizeSearchText(name)
    .replace(/\b(comprimidos?|capsulas?|jarabe|gotas|solucion|suspension)\b/g, " ")
    .replace(/\b\d+\s*(mg|ml|mcg|g|ui)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildSearchQueries(item: ProductInfoItem) {
  return [
    `${item.name} ${item.company ?? ""} medicamento Chile`,
    `${item.name} principio activo laboratorio Chile`,
    `${item.name} prospecto`,
    `${item.name} farmacia Chile`,
  ].map((query) => query.replace(/\s+/g, " ").trim());
}

function shouldHaveExternalInfo(item: ProductInfoItem) {
  const text = normalizeSearchText(
    [item.name, item.category, item.subcategory].filter(Boolean).join(" "),
  );

  return item.sourceType === "MEDICINE" || /\bsuplement/.test(text);
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function relevantTokens(value: string) {
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
    "medicamento",
    "chile",
  ]);

  return unique(
    normalizeProductName(value)
      .split(" ")
      .filter((token) => token.length >= 3 && !ignored.has(token)),
  );
}

function cleanText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() || null;
}

function truncate(value: string | null, maxLength: number) {
  if (!value) return null;
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function firstMatch(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = cleanText(match?.[1]);
    if (value) return truncate(value.replace(/[;|]+$/g, ""), 180);
  }

  return null;
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value == null) return undefined;

  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function parseSources(responses: TavilyResponse[]) {
  const sources = new Map<string, ExternalInfoSourceLink>();

  for (const response of responses) {
    for (const result of response.results ?? []) {
      if (!result.url) continue;
      sources.set(result.url, {
        title: cleanText(result.title) ?? result.url,
        url: result.url,
      });
    }
  }

  return Array.from(sources.values()).slice(0, 6);
}

function combinedSearchText(responses: TavilyResponse[]) {
  return responses
    .flatMap((response) => [
      response.answer ?? "",
      ...(response.results ?? []).flatMap((result) => [
        result.title ?? "",
        result.content ?? "",
        result.raw_content ?? "",
      ]),
    ])
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

export async function searchProductInformation(
  item: ProductInfoItem,
): Promise<{ responses: TavilyResponse[]; missingApiKey: boolean }> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return { responses: [], missingApiKey: true };

  const responses: TavilyResponse[] = [];

  for (const query of buildSearchQueries(item)) {
    const response = await fetch(TAVILY_SEARCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        include_answer: true,
        include_raw_content: true,
        include_images: false,
        max_results: 3,
        topic: "general",
      }),
      cache: "no-store",
    });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`Tavily respondio ${response.status}: ${text.slice(0, 180)}`);
    }

    responses.push(JSON.parse(text) as TavilyResponse);
  }

  return { responses, missingApiKey: false };
}

async function searchSingleQuery(query: string): Promise<TavilyResponse> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY no configurada.");
  }

  const response = await fetch(TAVILY_SEARCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      search_depth: "basic",
      include_answer: true,
      include_raw_content: true,
      include_images: false,
      max_results: 3,
      topic: "general",
    }),
    cache: "no-store",
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Tavily respondio ${response.status}: ${text.slice(0, 180)}`);
  }

  return JSON.parse(text) as TavilyResponse;
}

export function extractProductInformation(
  item: ProductInfoItem,
  responses: TavilyResponse[],
): ExtractedProductInformation {
  const text = combinedSearchText(responses);
  const normalized = normalizeSearchText(text);
  const sources = parseSources(responses);
  const firstResult = responses.flatMap((response) => response.results ?? [])[0];

  const productType = /\bsuplement/.test(normalized)
    ? "Suplemento"
    : /\b(medicamento|farmaceutic|jarabe|comprimido|capsula|gotas)\b/.test(
          normalized,
        )
      ? "Medicamento"
      : null;

  const activeIngredient = firstMatch(text, [
    /principio activo[:\s]+([^.\n]{3,180})/i,
    /componente(?:s)? activo(?:s)?[:\s]+([^.\n]{3,180})/i,
    /contiene[:\s]+([^.\n]{3,180})/i,
  ]);
  const components = firstMatch(text, [
    /componentes?[:\s]+([^.\n]{3,220})/i,
    /composici[oó]n[:\s]+([^.\n]{3,220})/i,
  ]);
  const holder = firstMatch(text, [
    /titular[:\s]+([^.\n]{3,180})/i,
    /laboratorio titular[:\s]+([^.\n]{3,180})/i,
  ]);
  const manufacturer = firstMatch(text, [
    /laboratorio[:\s]+([^.\n]{3,180})/i,
    /fabricante[:\s]+([^.\n]{3,180})/i,
  ]);
  const pharmaceuticalForm = firstMatch(text, [
    /forma farmac[eé]utica[:\s]+([^.\n]{3,120})/i,
    /\b(jarabe|comprimidos?|c[aá]psulas?|gotas|soluci[oó]n oral|suspensi[oó]n)\b/i,
  ]);
  const concentration =
    firstMatch(text, [/concentraci[oó]n[:\s]+([^.\n]{3,120})/i]) ??
    firstMatch(text, [/\b(\d+(?:[,.]\d+)?\s*(?:mg|mcg|g|ml|ui)(?:\/\w+)?)\b/i]);
  const saleCondition = firstMatch(text, [
    /condici[oó]n de venta[:\s]+([^.\n]{3,160})/i,
    /(venta bajo receta[^.\n]{0,80})/i,
    /(venta directa[^.\n]{0,80})/i,
  ]);
  const sanitaryRegistry = firstMatch(text, [
    /registro sanitario[:\s#-]+([A-Z0-9 .-]{3,80})/i,
    /reg\.?\s*(?:isp|sanitario)[:\s#-]+([A-Z0-9 .-]{3,80})/i,
  ]);
  const registryStatus = firstMatch(text, [
    /estado(?: del registro)?[:\s]+([^.\n]{3,80})/i,
  ]);
  const summary =
    truncate(cleanText(responses.find((response) => response.answer)?.answer ?? null), 380) ??
    truncate(cleanText(firstResult?.content), 380);

  return {
    externalName: cleanText(firstResult?.title) ?? item.name,
    productType,
    activeIngredient,
    components,
    holder,
    manufacturer: manufacturer ?? item.company,
    pharmaceuticalForm,
    concentration,
    saleCondition,
    sanitaryRegistry,
    registryStatus,
    summary,
    sources,
    sourceUrl: sources[0]?.url ?? null,
    rawPayload: responses,
    searchText: text,
  };
}

export function calculateConfidence(
  item: ProductInfoItem,
  extracted: ExtractedProductInformation,
) {
  const haystack = normalizeSearchText(
    [
      extracted.externalName,
      extracted.summary,
      extracted.holder,
      extracted.manufacturer,
      extracted.activeIngredient,
      extracted.components,
      extracted.searchText,
      extracted.sources.map((source) => source.title).join(" "),
    ]
      .filter(Boolean)
      .join(" "),
  );
  const itemName = normalizeProductName(item.name);
  const company = normalizeSearchText(item.company ?? "");
  const tokens = relevantTokens(item.name);
  let confidence = 0;
  const reasons: string[] = [];

  if (haystack.includes(itemName)) {
    confidence += 0.38;
    reasons.push("nombre normalizado encontrado");
  }

  const matchedTokens = tokens.filter((token) => haystack.includes(token));
  if (matchedTokens.length > 0) {
    confidence += Math.min(0.26, matchedTokens.length * 0.08);
    confidence +=
      (matchedTokens.length / Math.max(1, tokens.length)) * 0.12;
    reasons.push(`tokens del producto: ${matchedTokens.join(", ")}`);
  }

  if (company && haystack.includes(company)) {
    confidence += 0.12;
    reasons.push("empresa/laboratorio encontrado");
  }

  const structuredFields = [
    extracted.activeIngredient,
    extracted.components,
    extracted.holder,
    extracted.manufacturer,
    extracted.pharmaceuticalForm,
    extracted.concentration,
    extracted.saleCondition,
    extracted.sanitaryRegistry,
  ].filter(Boolean).length;

  if (structuredFields > 0) {
    confidence += Math.min(0.14, structuredFields * 0.025);
    reasons.push(`${structuredFields} campos estructurados`);
  }

  if (extracted.sources.length > 0) {
    confidence += 0.06;
    reasons.push("fuentes publicas disponibles");
  }

  return {
    confidence: Math.min(0.99, Number(confidence.toFixed(2))),
    matchReason: reasons.join("; ") || "sin coincidencia suficiente",
  };
}

function parseSourcesJson(value: Prisma.JsonValue | null): ExternalInfoSourceLink[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((source) => {
      if (typeof source !== "object" || source === null) return null;
      const maybeSource = source as { title?: unknown; url?: unknown };
      if (typeof maybeSource.url !== "string") return null;

      return {
        title:
          typeof maybeSource.title === "string" && maybeSource.title.trim()
            ? maybeSource.title
            : maybeSource.url,
        url: maybeSource.url,
      };
    })
    .filter((source): source is ExternalInfoSourceLink => source !== null);
}

function toExternalProductInfo(info: {
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
  summary: string | null;
  sources: Prisma.JsonValue | null;
  sourceUrl: string | null;
  confidence: number | null;
  matchReason: string | null;
  rawPayload: Prisma.JsonValue | null;
  fetchedAt: Date | null;
}): ExternalProductInfo {
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
    summary: info.summary,
    sources: parseSourcesJson(info.sources),
    sourceUrl: info.sourceUrl,
    confidence: info.confidence,
    matchReason: info.matchReason,
    rawPayload: info.rawPayload,
    fetchedAt: info.fetchedAt,
  };
}

async function readExistingExternalInfo(itemId: string) {
  const existing = await prisma.productExternalInfo.findUnique({
    where: { itemId },
  });

  return existing ? toExternalProductInfo(existing) : null;
}

function emptyGenerationResult(error: string): ExternalInfoGenerationResult {
  return {
    info: null,
    debug: {
      provider: "TAVILY",
      error,
      saved: false,
    },
  };
}

async function saveExtractedExternalInfo(
  item: ProductInfoItem,
  extracted: ExtractedProductInformation,
  confidence: number,
  matchReason: string,
) {
  const saved = await prisma.productExternalInfo.upsert({
    where: { itemId: item.id },
    update: {
      source: "TAVILY",
      externalName: extracted.externalName,
      productType: extracted.productType,
      activeIngredient: extracted.activeIngredient,
      components: extracted.components,
      holder: extracted.holder,
      manufacturer: extracted.manufacturer,
      pharmaceuticalForm: extracted.pharmaceuticalForm,
      concentration: extracted.concentration,
      saleCondition: extracted.saleCondition,
      sanitaryRegistry: extracted.sanitaryRegistry,
      registryStatus: extracted.registryStatus,
      summary: extracted.summary,
      sources: toPrismaJson(extracted.sources),
      sourceUrl: extracted.sourceUrl,
      confidence,
      matchReason,
      rawPayload: toPrismaJson(extracted.rawPayload),
      fetchedAt: new Date(),
    },
    create: {
      itemId: item.id,
      source: "TAVILY",
      externalName: extracted.externalName,
      productType: extracted.productType,
      activeIngredient: extracted.activeIngredient,
      components: extracted.components,
      holder: extracted.holder,
      manufacturer: extracted.manufacturer,
      pharmaceuticalForm: extracted.pharmaceuticalForm,
      concentration: extracted.concentration,
      saleCondition: extracted.saleCondition,
      sanitaryRegistry: extracted.sanitaryRegistry,
      registryStatus: extracted.registryStatus,
      summary: extracted.summary,
      sources: toPrismaJson(extracted.sources),
      sourceUrl: extracted.sourceUrl,
      confidence,
      matchReason,
      rawPayload: toPrismaJson(extracted.rawPayload),
      fetchedAt: new Date(),
    },
  });

  return toExternalProductInfo(saved);
}

async function generateExternalInfo(
  item: ProductInfoItem,
): Promise<ExternalInfoGenerationResult> {
  if (!shouldHaveExternalInfo(item)) {
    return emptyGenerationResult("Producto fuera del alcance de informacion adicional.");
  }

  if (!process.env.TAVILY_API_KEY) {
    return emptyGenerationResult("TAVILY_API_KEY no configurada.");
  }

  const responses: TavilyResponse[] = [];
  let best:
    | {
        extracted: ExtractedProductInformation;
        confidence: number;
        matchReason: string;
      }
    | null = null;
  let queriesUsed = 0;

  for (const query of buildSearchQueries(item)) {
    queriesUsed += 1;
    responses.push(await searchSingleQuery(query));

    const extracted = extractProductInformation(item, responses);
    const { confidence, matchReason } = calculateConfidence(item, extracted);
    if (!best || confidence > best.confidence) {
      best = { extracted, confidence, matchReason };
    }

    if (confidence >= MIN_CONFIDENCE_TO_SAVE) {
      const info = await saveExtractedExternalInfo(
        item,
        extracted,
        confidence,
        matchReason,
      );

      return {
        info,
        debug: {
          provider: "TAVILY",
          confidence,
          matchReason,
          fetchedAt: info.fetchedAt?.toISOString(),
          rawPayload: info.rawPayload,
          queriesUsed,
          resultsFound: responses.reduce(
            (total, response) => total + (response.results?.length ?? 0),
            0,
          ),
          saved: true,
        },
      };
    }
  }

  const resultsFound = responses.reduce(
    (total, response) => total + (response.results?.length ?? 0),
    0,
  );

  return {
    info: null,
    debug: {
      provider: "TAVILY",
      confidence: best?.confidence,
      matchReason:
        best?.matchReason ??
        "Tavily no entrego resultados suficientes para este producto.",
      rawPayload: toPrismaJson(responses) as Prisma.JsonValue,
      error:
        "No se guardo ficha porque la confianza quedo bajo 0.70. No se inventan datos.",
      queriesUsed,
      resultsFound,
      saved: false,
    },
  };
}

export async function getOrCreateExternalInfo(
  item: ProductInfoItem,
): Promise<ExternalProductInfo | null> {
  if (!shouldHaveExternalInfo(item)) return null;

  const existing = await readExistingExternalInfo(item.id);
  if (existing) return existing;

  const current = inFlightByItemId.get(item.id);
  if (current) return (await current).info;

  const promise = generateExternalInfo(item).finally(() => {
    inFlightByItemId.delete(item.id);
  });
  inFlightByItemId.set(item.id, promise);

  return (await promise).info;
}

export async function getOrCreateExternalInfoWithDebug(
  item: ProductInfoItem,
): Promise<ExternalInfoGenerationResult> {
  if (!shouldHaveExternalInfo(item)) {
    return emptyGenerationResult("Producto fuera del alcance de informacion adicional.");
  }

  const existing = await readExistingExternalInfo(item.id);
  if (existing) {
    return {
      info: existing,
      debug: {
        provider: "TAVILY",
        confidence: existing.confidence ?? undefined,
        matchReason: existing.matchReason ?? undefined,
        fetchedAt: existing.fetchedAt?.toISOString(),
        rawPayload: existing.rawPayload ?? undefined,
        saved: true,
        queriesUsed: 0,
      },
    };
  }

  const current = inFlightByItemId.get(item.id);
  if (current) return current;

  const promise = generateExternalInfo(item).finally(() => {
    inFlightByItemId.delete(item.id);
  });
  inFlightByItemId.set(item.id, promise);

  return promise;
}

export async function refreshExternalInfo(
  item: ProductInfoItem,
): Promise<ExternalProductInfo | null> {
  if (!shouldHaveExternalInfo(item)) return null;

  const existing = await prisma.productExternalInfo.findUnique({
    where: { itemId: item.id },
    select: { source: true },
  });

  if (existing?.source === "MANUAL") {
    return readExistingExternalInfo(item.id);
  }

  const current = inFlightByItemId.get(item.id);
  if (current) return (await current).info;

  const promise = generateExternalInfo(item).finally(() => {
    inFlightByItemId.delete(item.id);
  });
  inFlightByItemId.set(item.id, promise);

  return (await promise).info;
}

export async function getExistingExternalInfo(item: ProductInfoItem) {
  if (!shouldHaveExternalInfo(item)) return null;

  return readExistingExternalInfo(item.id);
}

export function externalInfoDebug(
  info: ExternalProductInfo | null,
  error?: string,
): ExternalInfoDebug {
  return {
    provider: "TAVILY",
    confidence: info?.confidence ?? undefined,
    matchReason: info?.matchReason ?? undefined,
    fetchedAt: info?.fetchedAt?.toISOString(),
    rawPayload: info?.rawPayload ?? undefined,
    error,
  };
}

export async function backfillExternalInfo(
  options: BackfillExternalInfoOptions = {},
): Promise<BackfillExternalInfoResult> {
  const startedAt = new Date();
  const limit = Math.max(
    1,
    Math.min(Math.floor(options.limit ?? DEFAULT_BACKFILL_LIMIT), MAX_BACKFILL_LIMIT),
  );
  const olderThanDays = Math.max(1, Math.floor(options.olderThanDays ?? 30));
  const olderThan = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const result: BackfillExternalInfoResult = {
    ok: true,
    type: "EXTERNAL_INFO_BACKFILL",
    startedAt: startedAt.toISOString(),
    finishedAt: startedAt.toISOString(),
    status: "SUCCESS",
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    noMatch: 0,
    errors: [],
    message: "Backfill de informacion adicional finalizado.",
  };

  if (!process.env.TAVILY_API_KEY) {
    result.message = "TAVILY_API_KEY no configurada. No se consulto Tavily.";
    result.finishedAt = new Date().toISOString();
    return result;
  }

  const items = await prisma.officialItem.findMany({
    where: {
      active: true,
      AND: [
        {
          OR: [
            { sourceType: "MEDICINE" },
            { category: { contains: "suplement", mode: "insensitive" } },
            { subcategory: { contains: "suplement", mode: "insensitive" } },
            { name: { contains: "suplement", mode: "insensitive" } },
          ],
        },
        ...(options.force
          ? []
          : [
              {
                OR: [
                  { externalInfo: null },
                  { externalInfo: { fetchedAt: { lt: olderThan } } },
                ],
              },
            ]),
      ],
    },
    select: {
      id: true,
      sourceType: true,
      name: true,
      company: true,
      category: true,
      subcategory: true,
      externalInfo: {
        select: {
          id: true,
          source: true,
          confidence: true,
        },
      },
    },
    take: limit,
    orderBy: { updatedAt: "desc" },
  });

  for (const item of items) {
    result.processed += 1;

    try {
      if (item.externalInfo?.source === "MANUAL") {
        result.skipped += 1;
        continue;
      }

      const before = item.externalInfo;
      const info = options.force
        ? await refreshExternalInfo(item)
        : await getOrCreateExternalInfo(item);

      if (!info) {
        result.noMatch += 1;
      } else if (before) {
        result.updated += 1;
      } else {
        result.created += 1;
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Error desconocido";
      result.errors.push({ itemId: item.id, name: item.name, error: message });

      if (options.debug || process.env.NODE_ENV === "development") {
        console.error("[tavily] backfill item failed", {
          itemId: item.id,
          name: item.name,
          error: message,
        });
      }
    }
  }

  result.finishedAt = new Date().toISOString();
  if (result.errors.length > 0) {
    result.status = result.errors.length === result.processed ? "FAILED" : "PARTIAL";
    result.ok = result.status !== "FAILED";
  }

  return result;
}
