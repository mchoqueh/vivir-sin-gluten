import type { Prisma, ProductExternalInfoSource } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeSearchText } from "@/lib/utils";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const MIN_CONFIDENCE_TO_SAVE = 0.7;
const DEFAULT_BACKFILL_LIMIT = 25;
const MAX_BACKFILL_LIMIT = 100;
const ALLOWED_DOMAINS = [
  "cruzverde.cl",
  "salcobrand.cl",
  "farmaciasahumada.cl",
  "drsimi.cl",
  "knoplaboratorios.cl",
  "laboratoriochile.cl",
  "mintlab.cl",
  "saval.cl",
  "bago.cl",
  "pasteur.cl",
  "medipharm.cl",
  "farmex.cl",
  "lider.cl",
  "jumbo.cl",
  "tottus.cl",
  "unimarc.cl",
  "paris.cl",
  "falabella.com",
];
const DISALLOWED_DOMAINS = [
  "amazon.",
  "ebay.",
  "mercadolibre.",
  "reddit.",
  "facebook.",
  "instagram.",
  "pinterest.",
  "x.com",
  "twitter.",
  "tiktok.",
];

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
  tavilyScore: number | null;
  dataConfidence: number | null;
  confidenceBreakdown: ConfidenceBreakdown | null;
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
  discardedResults?: TavilyResult[];
};

type ConfidenceCriterion = {
  key: string;
  label: string;
  score: number;
  weight: number;
  weighted: number;
  status: "OK" | "PARTIAL" | "FAIL";
  reason: string;
};

type ConfidenceBreakdown = {
  final: number;
  threshold: number;
  decision: "SAVED" | "NOT_SAVED";
  criteria: ConfidenceCriterion[];
  tavily: {
    bestScore: number | null;
    averageAcceptedScore: number | null;
    acceptedResults: number;
    discardedResults: number;
  };
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
  dataConfidence?: number;
  tavilyScore?: number | null;
  confidenceBreakdown?: ConfidenceBreakdown;
  matchReason?: string;
  fetchedAt?: string;
  rawPayload?: Prisma.JsonValue | null;
  error?: string;
  queriesUsed?: number;
  queriesSent?: string[];
  resultsFound?: number;
  usedDomains?: string[];
  allowedDomains?: string[];
  discardedDomains?: string[];
  sourcesUsed?: ExternalInfoSourceLink[];
  durationMs?: number;
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
    dataConfidence: info.dataConfidence,
    confidence: info.confidence,
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
  const kind = productSearchKind(item);
  const company = item.company ?? "";

  if (kind === "MEDICINE") {
    return [
      `${item.name} ${company} medicamento Chile`,
      `${item.name} principio activo laboratorio Chile`,
      `${item.name} prospecto Chile`,
      `${item.name} farmacia Chile`,
    ].map((query) => query.replace(/\s+/g, " ").trim());
  }

  if (kind === "SUPPLEMENT") {
    return [
      `${item.name} ${company} suplemento Chile`,
      `${item.name} ingredientes Chile`,
      `${item.name} informacion nutricional Chile`,
      `${item.name} ficha producto Chile`,
    ].map((query) => query.replace(/\s+/g, " ").trim());
  }

  return [
    `${item.name} ${company} alimento Chile`,
    `${item.name} ingredientes Chile`,
    `${item.name} informacion nutricional Chile`,
    `${item.name} ficha producto Chile`,
  ].map((query) => query.replace(/\s+/g, " ").trim());
}

function productSearchKind(item: ProductInfoItem) {
  const text = normalizeSearchText(
    [item.name, item.category, item.subcategory].filter(Boolean).join(" "),
  );

  if (item.sourceType === "MEDICINE") return "MEDICINE";
  if (/\bsuplement/.test(text)) return "SUPPLEMENT";

  return "FOOD";
}

function shouldHaveExternalInfo(item?: ProductInfoItem) {
  void item;

  return true;
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

function hostFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function isDisallowedUrl(url: string) {
  const host = hostFromUrl(url);

  return DISALLOWED_DOMAINS.some((domain) => host.includes(domain));
}

function isAllowedUrl(url: string) {
  const host = hostFromUrl(url);

  return ALLOWED_DOMAINS.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

function domainsFromResponses(responses: TavilyResponse[]) {
  return unique(
    responses.flatMap((response) =>
      (response.results ?? [])
        .map((result) => (result.url ? hostFromUrl(result.url) : ""))
        .filter(Boolean),
    ),
  );
}

function discardedDomainsFromResponses(responses: TavilyResponse[]) {
  return unique(
    responses.flatMap((response) =>
      (response.results ?? [])
        .filter((result) => result.url && isDisallowedUrl(result.url))
        .map((result) => hostFromUrl(result.url ?? "")),
    ),
  );
}

function sanitizeTavilyResponse(response: TavilyResponse): TavilyResponse {
  const results = response.results ?? [];

  return {
    results: results.filter((result) => result.url && !isDisallowedUrl(result.url)),
    discardedResults: results.filter(
      (result) => !result.url || isDisallowedUrl(result.url),
    ),
  };
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
      if (isDisallowedUrl(result.url)) continue;
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
        include_answer: false,
        include_raw_content: true,
        include_images: false,
        max_results: 3,
        topic: "general",
        exclude_domains: DISALLOWED_DOMAINS,
      }),
      cache: "no-store",
    });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`Tavily respondio ${response.status}: ${text.slice(0, 180)}`);
    }

    responses.push(sanitizeTavilyResponse(JSON.parse(text) as TavilyResponse));
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
      include_answer: false,
      include_raw_content: true,
      include_images: false,
      max_results: 3,
      topic: "general",
      exclude_domains: DISALLOWED_DOMAINS,
    }),
    cache: "no-store",
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Tavily respondio ${response.status}: ${text.slice(0, 180)}`);
  }

  return sanitizeTavilyResponse(JSON.parse(text) as TavilyResponse);
}

function generateTemplateSummary(
  item: ProductInfoItem,
  extracted: Omit<
    ExtractedProductInformation,
    "summary" | "rawPayload" | "searchText"
  >,
) {
  const type = extracted.productType?.toLowerCase() ?? "producto";
  const maker = extracted.manufacturer ?? extracted.holder ?? item.company;
  const sentences = [`${item.name} corresponde a un ${type}.`];

  if (maker) {
    sentences.push(
      `Segun las fuentes publicas consultadas, es un producto asociado a ${maker}.`,
    );
  }

  if (extracted.pharmaceuticalForm) {
    sentences.push(`Se presenta en formato ${extracted.pharmaceuticalForm}.`);
  }

  if (extracted.components ?? extracted.activeIngredient) {
    sentences.push(
      `Los componentes informados incluyen ${
        extracted.components ?? extracted.activeIngredient
      }.`,
    );
  }

  if (extracted.saleCondition) {
    sentences.push(`Su condicion de venta corresponde a ${extracted.saleCondition}.`);
  }

  return truncate(sentences.slice(0, 4).join(" "), 520);
}

export function extractProductInformation(
  item: ProductInfoItem,
  responses: TavilyResponse[],
): ExtractedProductInformation {
  const text = combinedSearchText(responses);
  const normalized = normalizeSearchText(text);
  const sources = parseSources(responses);
  const firstResult = responses.flatMap((response) => response.results ?? [])[0];
  const kind = productSearchKind(item);

  const productType =
    kind === "FOOD"
      ? "Alimento"
      : kind === "SUPPLEMENT" || /\bsuplement/.test(normalized)
        ? "Suplemento"
        : "Medicamento";

  const activeIngredient = firstMatch(text, [
    /principio activo[:\s]+([^\.\n]{3,180})/i,
    /componente(?:s)? activo(?:s)?[:\s]+([^\.\n]{3,180})/i,
    /contiene[:\s]+([^\.\n]{3,180})/i,
  ]);
  const components = firstMatch(text, [
    /ingredientes?[:\s]+([^\.\n]{3,260})/i,
    /componentes?[:\s]+([^\.\n]{3,220})/i,
    /composici\S*n[:\s]+([^\.\n]{3,220})/i,
  ]);
  const holder = firstMatch(text, [
    /titular[:\s]+([^\.\n]{3,180})/i,
    /laboratorio titular[:\s]+([^\.\n]{3,180})/i,
  ]);
  const manufacturer = firstMatch(text, [
    /laboratorio[:\s]+([^\.\n]{3,180})/i,
    /fabricante[:\s]+([^\.\n]{3,180})/i,
    /elaborado por[:\s]+([^\.\n]{3,180})/i,
  ]);
  const pharmaceuticalForm = firstMatch(text, [
    /forma farmac\S*utica[:\s]+([^\.\n]{3,120})/i,
    /formato[:\s]+([^\.\n]{3,120})/i,
    /tipo de producto[:\s]+([^\.\n]{3,120})/i,
    /\b(jarabe|comprimidos?|c\S*psulas?|gotas|soluci\S*n oral|suspensi\S*n)\b/i,
  ]);
  const concentration =
    firstMatch(text, [/concentraci\S*n[:\s]+([^\.\n]{3,120})/i]) ??
    firstMatch(text, [/presentaci\S*n[:\s]+([^\.\n]{3,140})/i]) ??
    firstMatch(text, [
      /\b(\d+(?:[,.]\d+)?\s*(?:mg|mcg|g|ml|ui|kg|cc)(?:\/\w+)?)\b/i,
    ]);
  const saleCondition = firstMatch(text, [
    /condici\S*n de venta[:\s]+([^\.\n]{3,160})/i,
    /(venta bajo receta[^\.\n]{0,80})/i,
    /(venta directa[^\.\n]{0,80})/i,
  ]);
  const sanitaryRegistry = firstMatch(text, [
    /registro sanitario[:\s#-]+([A-Z0-9 .-]{3,80})/i,
    /reg\.?\s*(?:isp|sanitario)[:\s#-]+([A-Z0-9 .-]{3,80})/i,
  ]);
  const registryStatus = firstMatch(text, [
    /estado(?: del registro)?[:\s]+([^\.\n]{3,80})/i,
  ]);
  const draft = {
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
    sources,
    sourceUrl: sources[0]?.url ?? null,
  };
  const summary = generateTemplateSummary(item, draft);

  return {
    ...draft,
    summary,
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
      extracted.sources.map((source) => source.url).join(" "),
    ]
      .filter(Boolean)
      .join(" "),
  );
  const itemName = normalizeProductName(item.name);
  const company = normalizeSearchText(item.company ?? "");
  const tokens = relevantTokens(item.name);
  const expectedType = productSearchKind(item).toLowerCase();
  const detectedType = normalizeSearchText(extracted.productType ?? "");
  const matchedTokens = tokens.filter((token) => haystack.includes(token));
  const allowedSources = extracted.sources.filter((source) =>
    isAllowedUrl(source.url),
  );
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
  const acceptedScores = extracted.rawPayload.flatMap((response) =>
    (response.results ?? [])
      .map((result) => result.score)
      .filter((score): score is number => typeof score === "number"),
  );
  const bestScore =
    acceptedScores.length > 0 ? Math.max(...acceptedScores) : null;
  const averageAcceptedScore =
    acceptedScores.length > 0
      ? acceptedScores.reduce((sum, score) => sum + score, 0) /
        acceptedScores.length
      : null;
  const discardedResults = extracted.rawPayload.reduce(
    (total, response) => total + (response.discardedResults?.length ?? 0),
    0,
  );

  function status(score: number): ConfidenceCriterion["status"] {
    if (score >= 0.8) return "OK";
    if (score >= 0.4) return "PARTIAL";
    return "FAIL";
  }

  function criterion(
    key: string,
    label: string,
    score: number,
    weight: number,
    reason: string,
  ): ConfidenceCriterion {
    const roundedScore = Number(score.toFixed(2));
    return {
      key,
      label,
      score: roundedScore,
      weight,
      weighted: Number((roundedScore * weight).toFixed(3)),
      status: status(roundedScore),
      reason,
    };
  }

  const nameScore = haystack.includes(itemName)
    ? 1
    : matchedTokens.length / Math.max(1, tokens.length) >= 0.65
      ? 0.7
      : matchedTokens.length > 0
        ? 0.4
        : 0;
  const companyScore =
    company && haystack.includes(company)
      ? 1
      : item.company && matchedTokens.length > 0
        ? 0.5
        : 0;
  const typeScore =
    expectedType === "medicine" && detectedType.includes("medicamento")
      ? 1
      : expectedType === "supplement" && detectedType.includes("suplemento")
        ? 1
        : expectedType === "food" && detectedType.includes("alimento")
          ? 1
          : detectedType
            ? 0
            : 0.5;
  const chileScore = extracted.sources.some((source) =>
    hostFromUrl(source.url).endsWith(".cl"),
  )
    ? 1
    : /\bchile\b/.test(haystack)
      ? 1
      : extracted.sources.length > 0
        ? 0.5
        : 0;
  const sourceScore =
    allowedSources.length > 0 ? 1 : extracted.sources.length > 0 ? 0.5 : 0;
  const fieldsScore =
    structuredFields >= 3 ? 1 : structuredFields === 2 ? 0.7 : structuredFields === 1 ? 0.4 : 0;
  const tavilyScore =
    averageAcceptedScore == null
      ? 0
      : Math.max(0, Math.min(1, averageAcceptedScore));

  const criteria = [
    criterion(
      "nameMatch",
      "Coincidencia de nombre",
      nameScore,
      0.35,
      nameScore === 1
        ? "El nombre del producto coincide con el resultado principal."
        : matchedTokens.length > 0
          ? `Coincidieron tokens del producto: ${matchedTokens.join(", ")}.`
          : "No se encontro coincidencia clara de nombre.",
    ),
    criterion(
      "companyMatch",
      "Coincidencia de empresa/laboratorio",
      companyScore,
      0.15,
      companyScore === 1
        ? "La empresa o laboratorio aparece en los resultados."
        : companyScore === 0.5
          ? "Hay senales parciales de marca, pero no empresa local clara."
          : "No se encontro coincidencia de empresa o laboratorio.",
    ),
    criterion(
      "productTypeMatch",
      "Coincidencia de tipo de producto",
      typeScore,
      0.15,
      typeScore === 1
        ? "El tipo detectado coincide con el producto oficial."
        : typeScore === 0.5
          ? "El tipo no se pudo confirmar con claridad."
          : "El tipo detectado contradice el producto oficial.",
    ),
    criterion(
      "chileSource",
      "Fuente chilena u orientada a Chile",
      chileScore,
      0.1,
      chileScore === 1
        ? "La fuente es chilena o el contenido esta orientado a Chile."
        : chileScore === 0.5
          ? "La fuente no es chilena, pero puede aportar contexto."
          : "No se encontraron fuentes chilenas u orientadas a Chile.",
    ),
    criterion(
      "sourceQuality",
      "Calidad de fuente",
      sourceScore,
      0.1,
      sourceScore === 1
        ? "La fuente corresponde a farmacia, laboratorio, retail chileno o sitio priorizado."
        : sourceScore === 0.5
          ? "La fuente es secundaria, pero no fue descartada."
          : "No hay fuentes confiables suficientes.",
    ),
    criterion(
      "structuredFields",
      "Campos estructurados",
      fieldsScore,
      0.1,
      structuredFields >= 3
        ? "Se encontraron tres o mas campos utiles."
        : structuredFields > 0
          ? `Se encontraron ${structuredFields} campos utiles.`
          : "No se encontraron campos estructurados suficientes.",
    ),
    criterion(
      "tavilyRelevance",
      "Relevancia Tavily",
      tavilyScore,
      0.05,
      averageAcceptedScore == null
        ? "Tavily no entrego score usable en resultados aceptados."
        : "Promedio de results[].score aceptados; solo influye parcialmente.",
    ),
  ];
  const confidence = Number(
    criteria.reduce((sum, item) => sum + item.weighted, 0).toFixed(2),
  );
  const decision = confidence >= MIN_CONFIDENCE_TO_SAVE ? "SAVED" : "NOT_SAVED";
  const failedLabels = criteria
    .filter((item) => item.status === "FAIL")
    .map((item) => item.label.toLowerCase());
  const matchReason =
    decision === "SAVED"
      ? `Se guardo ficha con confianza ${confidence} sobre el umbral ${MIN_CONFIDENCE_TO_SAVE}.`
      : `No se guardo ficha porque la confianza quedo en ${confidence} bajo el umbral ${MIN_CONFIDENCE_TO_SAVE}. Faltaron ${failedLabels.slice(0, 2).join(" y ") || "senales suficientes"}.`;
  const confidenceBreakdown: ConfidenceBreakdown = {
    final: confidence,
    threshold: MIN_CONFIDENCE_TO_SAVE,
    decision,
    criteria,
    tavily: {
      bestScore,
      averageAcceptedScore:
        averageAcceptedScore == null
          ? null
          : Number(averageAcceptedScore.toFixed(2)),
      acceptedResults: acceptedScores.length,
      discardedResults,
    },
  };

  return {
    confidence,
    dataConfidence: confidence,
    tavilyScore: bestScore,
    confidenceBreakdown,
    matchReason,
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

function parseConfidenceBreakdown(
  value: Prisma.JsonValue | null,
): ConfidenceBreakdown | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as unknown as ConfidenceBreakdown;
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
  tavilyScore: number | null;
  dataConfidence: number | null;
  confidenceBreakdown: Prisma.JsonValue | null;
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
    tavilyScore: info.tavilyScore,
    dataConfidence: info.dataConfidence,
    confidenceBreakdown: parseConfidenceBreakdown(info.confidenceBreakdown),
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
  tavilyScore: number | null,
  confidenceBreakdown: ConfidenceBreakdown,
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
      tavilyScore,
      dataConfidence: confidence,
      confidenceBreakdown: toPrismaJson(confidenceBreakdown),
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
      tavilyScore,
      dataConfidence: confidence,
      confidenceBreakdown: toPrismaJson(confidenceBreakdown),
      confidence,
      matchReason,
      rawPayload: toPrismaJson(extracted.rawPayload),
      fetchedAt: new Date(),
    },
  });

  return toExternalProductInfo(saved);
}

async function createExternalSearchLog({
  itemId,
  query,
  tavilyScore,
  dataConfidence,
  confidenceBreakdown,
  status,
  generated,
  error,
  durationMs,
  resultsCount,
}: {
  itemId: string;
  query: string;
  tavilyScore?: number | null;
  dataConfidence?: number | null;
  confidenceBreakdown?: ConfidenceBreakdown | null;
  status: string;
  generated: boolean;
  error?: string | null;
  durationMs?: number | null;
  resultsCount?: number | null;
}) {
  await prisma.externalSearchLog.create({
    data: {
      itemId,
      query,
      provider: "TAVILY",
      tavilyScore,
      dataConfidence,
      confidenceBreakdown: toPrismaJson(confidenceBreakdown),
      status,
      generated,
      error,
      durationMs,
      resultsCount,
    },
  });
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

  const startedAt = Date.now();
  const queries = buildSearchQueries(item);
  const responses: TavilyResponse[] = [];
  let best:
    | {
        extracted: ExtractedProductInformation;
        confidence: number;
        dataConfidence: number;
        tavilyScore: number | null;
        confidenceBreakdown: ConfidenceBreakdown;
        matchReason: string;
      }
    | null = null;
  let queriesUsed = 0;

  for (const query of queries) {
    queriesUsed += 1;
    try {
      responses.push(await searchSingleQuery(query));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Error desconocido en Tavily";
      await createExternalSearchLog({
        itemId: item.id,
        query,
        status: "ERROR",
        generated: false,
        error: message,
        durationMs: Date.now() - startedAt,
        resultsCount: 0,
      });
      throw error;
    }

    const extracted = extractProductInformation(item, responses);
    const {
      confidence,
      dataConfidence,
      tavilyScore,
      confidenceBreakdown,
      matchReason,
    } = calculateConfidence(item, extracted);
    if (!best || confidence > best.confidence) {
      best = {
        extracted,
        confidence,
        dataConfidence,
        tavilyScore,
        confidenceBreakdown,
        matchReason,
      };
    }
    const resultsCount = responses.reduce(
      (total, response) => total + (response.results?.length ?? 0),
      0,
    );

    await createExternalSearchLog({
      itemId: item.id,
      query,
      tavilyScore,
      dataConfidence,
      confidenceBreakdown,
      status: dataConfidence >= MIN_CONFIDENCE_TO_SAVE ? "SAVED" : "NOT_SAVED",
      generated: dataConfidence >= MIN_CONFIDENCE_TO_SAVE,
      durationMs: Date.now() - startedAt,
      resultsCount,
    });

    if (dataConfidence >= MIN_CONFIDENCE_TO_SAVE) {
      const info = await saveExtractedExternalInfo(
        item,
        extracted,
        dataConfidence,
        tavilyScore,
        confidenceBreakdown,
        matchReason,
      );

      return {
        info,
        debug: {
          provider: "TAVILY",
          confidence: dataConfidence,
          dataConfidence,
          tavilyScore,
          confidenceBreakdown,
          matchReason,
          fetchedAt: info.fetchedAt?.toISOString(),
          rawPayload: info.rawPayload,
          queriesUsed,
          resultsFound: responses.reduce(
            (total, response) => total + (response.results?.length ?? 0),
            0,
          ),
          queriesSent: queries.slice(0, queriesUsed),
          usedDomains: domainsFromResponses(responses),
          allowedDomains: ALLOWED_DOMAINS,
          discardedDomains: discardedDomainsFromResponses(responses),
          sourcesUsed: info.sources,
          durationMs: Date.now() - startedAt,
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
      dataConfidence: best?.dataConfidence,
      tavilyScore: best?.tavilyScore,
      confidenceBreakdown: best?.confidenceBreakdown,
      matchReason:
        best?.matchReason ??
        "Tavily no entrego resultados suficientes para este producto.",
      rawPayload: toPrismaJson(responses) as Prisma.JsonValue,
      error:
        "No se guardo ficha porque la confianza quedo bajo 0.70. No se inventan datos.",
      queriesUsed,
      queriesSent: queries.slice(0, queriesUsed),
      resultsFound,
      usedDomains: domainsFromResponses(responses),
      allowedDomains: ALLOWED_DOMAINS,
      discardedDomains: discardedDomainsFromResponses(responses),
      sourcesUsed: best?.extracted.sources ?? [],
      durationMs: Date.now() - startedAt,
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
        dataConfidence: existing.dataConfidence ?? existing.confidence ?? undefined,
        tavilyScore: existing.tavilyScore,
        confidenceBreakdown: existing.confidenceBreakdown ?? undefined,
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
    dataConfidence: info?.dataConfidence ?? info?.confidence ?? undefined,
    tavilyScore: info?.tavilyScore ?? undefined,
    confidenceBreakdown: info?.confidenceBreakdown ?? undefined,
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
      ...(options.force
        ? {}
        : {
            OR: [
              { externalInfo: null },
              { externalInfo: { fetchedAt: { lt: olderThan } } },
            ],
          }),
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
