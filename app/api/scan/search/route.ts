import { prisma } from "@/lib/db";
import {
  GENERIC_PRODUCT_TOKENS,
  hasUsefulOcrText,
  normalizeProductSearchText,
  tokenizeProductSearchText,
} from "@/lib/scan/normalize";
import { certificationStatusLabel, sourceTypeLabel } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ProductTypeFilter = "ALL" | "FOOD" | "MEDICINE";

type Candidate = {
  id: string;
  sourceType: "FOOD" | "MEDICINE";
  name: string;
  company: string | null;
  category: string | null;
  subcategory: string | null;
  certificationStatus: string;
  normalized: string;
};

type IndexedCandidate = Candidate & {
  nameTokens: string[];
  companyTokens: string[];
  categoryTokens: string[];
  subcategoryTokens: string[];
  typeTokens: string[];
  statusTokens: string[];
  aliases: string[];
  phraseTokens: string[];
  allTokens: string[];
};

type CandidateWithScore = Candidate & {
  score: number;
  confidence: number;
};

let cachedIndex:
  | {
      expiresAt: number;
      items: IndexedCandidate[];
    }
  | undefined;

function unique(tokens: string[]) {
  return Array.from(new Set(tokens));
}

function buildAliases(candidate: Candidate) {
  const normalizedName = normalizeProductSearchText(candidate.name);
  const normalizedCompany = normalizeProductSearchText(candidate.company ?? "");
  const aliases = new Set<string>([
    normalizedName,
    normalizedCompany,
    normalizedName.replace(/\s+/g, ""),
    normalizedCompany.replace(/\s+/g, ""),
  ]);

  for (const token of tokenizeProductSearchText(candidate.name)) {
    if (token.length >= 5) aliases.add(token);
  }

  return Array.from(aliases).filter((alias) => alias.length >= 3);
}

function indexCandidate(candidate: Candidate): IndexedCandidate {
  const nameTokens = tokenizeProductSearchText(candidate.name);
  const companyTokens = tokenizeProductSearchText(candidate.company ?? "");
  const categoryTokens = tokenizeProductSearchText(candidate.category ?? "");
  const subcategoryTokens = tokenizeProductSearchText(
    candidate.subcategory ?? "",
  );
  const typeTokens = tokenizeProductSearchText(sourceTypeLabel(candidate.sourceType));
  const statusTokens = tokenizeProductSearchText(
    certificationStatusLabel(candidate.certificationStatus),
  );
  const aliases = buildAliases(candidate);
  const phraseTokens = unique([
    ...tokenizeProductSearchText(`${candidate.name} ${candidate.company ?? ""}`),
    ...aliases.flatMap(tokenizeProductSearchText),
  ]);
  const allTokens = unique([
    ...nameTokens,
    ...companyTokens,
    ...categoryTokens,
    ...subcategoryTokens,
    ...typeTokens,
    ...statusTokens,
    ...phraseTokens,
  ]);

  return {
    ...candidate,
    nameTokens,
    companyTokens,
    categoryTokens,
    subcategoryTokens,
    typeTokens,
    statusTokens,
    aliases,
    phraseTokens,
    allTokens,
  };
}

async function getProductIndex() {
  const now = Date.now();
  if (cachedIndex && cachedIndex.expiresAt > now) {
    return cachedIndex.items;
  }

  const candidates: Candidate[] = await prisma.officialItem.findMany({
    where: { active: true },
    select: {
      id: true,
      sourceType: true,
      name: true,
      company: true,
      category: true,
      subcategory: true,
      certificationStatus: true,
      normalized: true,
    },
    orderBy: [{ sourceType: "asc" }, { name: "asc" }],
    take: 8000,
  });

  const items = candidates.map(indexCandidate);
  cachedIndex = {
    expiresAt: now + 5 * 60 * 1000,
    items,
  };

  return items;
}

function levenshteinDistance(a: string, b: string) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
    }

    for (let j = 0; j <= b.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[b.length];
}

function tokenSimilarity(a: string, b: string) {
  if (a === b) return 1;
  if (a.length < 3 || b.length < 3) return 0;
  if (a.includes(b) || b.includes(a)) {
    return Math.min(a.length, b.length) >= 4 ? 0.86 : 0.72;
  }
  if (a[0] !== b[0]) return 0;

  const distance = levenshteinDistance(a, b);
  return 1 - distance / Math.max(a.length, b.length);
}

function bestTokenMatch(token: string, targetTokens: string[]) {
  let best = 0;
  for (const target of targetTokens) {
    best = Math.max(best, tokenSimilarity(token, target));
  }

  return best;
}

function scoreTokenGroup(tokens: string[], targetTokens: string[], weight: number) {
  let score = 0;

  for (const token of tokens) {
    const similarity = bestTokenMatch(token, targetTokens);
    if (similarity >= 0.96) score += weight;
    else if (similarity >= 0.84) score += weight * 0.7;
    else if (similarity >= 0.72) score += weight * 0.45;
  }

  return score;
}

function scoreCandidate(
  candidate: IndexedCandidate,
  tokens: string[],
  dominantTokens: string[],
  secondaryTokens: string[],
) {
  if (tokens.length === 0 && dominantTokens.length === 0) return 0;

  const usefulTokens = tokens.filter((token) => !GENERIC_PRODUCT_TOKENS.has(token));
  const scoringTokens = usefulTokens.length > 0 ? usefulTokens : tokens;
  const usefulDominantTokens = dominantTokens.filter(
    (token) => !GENERIC_PRODUCT_TOKENS.has(token),
  );
  const usefulSecondaryTokens = secondaryTokens.filter(
    (token) => !GENERIC_PRODUCT_TOKENS.has(token),
  );
  let score = 0;

  score += scoreTokenGroup(usefulDominantTokens, candidate.companyTokens, 35);
  score += scoreTokenGroup(usefulDominantTokens, candidate.nameTokens, 30);
  score += scoreTokenGroup(usefulDominantTokens, candidate.subcategoryTokens, 9);
  score += scoreTokenGroup(usefulDominantTokens, candidate.categoryTokens, 5);
  score += scoreTokenGroup(usefulSecondaryTokens, candidate.companyTokens, 18);
  score += scoreTokenGroup(usefulSecondaryTokens, candidate.nameTokens, 14);
  score += scoreTokenGroup(usefulSecondaryTokens, candidate.subcategoryTokens, 5);
  score += scoreTokenGroup(usefulSecondaryTokens, candidate.categoryTokens, 2);
  score += scoreTokenGroup(scoringTokens, candidate.companyTokens, 8);
  score += scoreTokenGroup(scoringTokens, candidate.nameTokens, 7);
  score += scoreTokenGroup(scoringTokens, candidate.subcategoryTokens, 3);
  score += scoreTokenGroup(scoringTokens, candidate.categoryTokens, 1.5);
  score += scoreTokenGroup(scoringTokens, candidate.typeTokens, 1);
  score += scoreTokenGroup(scoringTokens, candidate.statusTokens, 1);

  const compactQuery = [...usefulDominantTokens, ...scoringTokens].join("");
  if (compactQuery.length >= 5) {
    for (const alias of candidate.aliases) {
      const compactAlias = alias.replace(/\s+/g, "");
      const similarity = tokenSimilarity(compactQuery, compactAlias);
      if (similarity >= 0.86) score += usefulDominantTokens.length > 0 ? 28 : 16;
      else if (compactAlias.includes(compactQuery)) score += 12;
    }
  }

  const coverageTokens = unique([...usefulDominantTokens, ...scoringTokens]);
  const coverage = coverageTokens.filter((token) =>
    candidate.allTokens.some((target) => tokenSimilarity(token, target) >= 0.84),
  ).length;
  score += (coverage / Math.max(1, coverageTokens.length)) * 18;

  const genericMatches = tokens.filter((token) =>
    GENERIC_PRODUCT_TOKENS.has(token),
  ).length;
  const hasDominantNameOrCompanyMatch = usefulDominantTokens.some(
    (token) =>
      bestTokenMatch(token, candidate.nameTokens) >= 0.84 ||
      bestTokenMatch(token, candidate.companyTokens) >= 0.84,
  );

  if (!hasDominantNameOrCompanyMatch && usefulDominantTokens.length > 0) {
    score *= 0.82;
  }

  if (genericMatches > 0 && usefulTokens.length === 0) score *= 0.35;
  else score -= genericMatches * 1.5;

  return Math.max(0, Math.round(score));
}

function confidenceFromScore(score: number) {
  if (score < 12) return 0;
  return Math.min(99, Math.round(35 + score * 1.15));
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    text?: unknown;
    type?: unknown;
    dominantTokens?: unknown;
    secondaryTokens?: unknown;
  } | null;
  const text = typeof body?.text === "string" ? body.text : "";
  const type = body?.type;
  const sourceType: ProductTypeFilter =
    type === "FOOD" || type === "MEDICINE" ? type : "ALL";
  const normalizedQuery = normalizeProductSearchText(text);
  const tokens = tokenizeProductSearchText(text).slice(0, 14);
  const dominantTokens = Array.isArray(body?.dominantTokens)
    ? body.dominantTokens
        .filter((token): token is string => typeof token === "string")
        .flatMap(tokenizeProductSearchText)
        .slice(0, 8)
    : [];
  const secondaryTokens = Array.isArray(body?.secondaryTokens)
    ? body.secondaryTokens
        .filter((token): token is string => typeof token === "string")
        .flatMap(tokenizeProductSearchText)
        .slice(0, 12)
    : [];

  if (!hasUsefulOcrText(text) && dominantTokens.length === 0) {
    return Response.json({
      ok: true,
      query: normalizedQuery,
      tokens,
      results: [],
      reason: "LOW_SIGNAL_OCR",
    });
  }

  const index = await getProductIndex();
  const filteredIndex = index.filter((candidate) =>
    sourceType === "ALL" ? true : candidate.sourceType === sourceType,
  );

  const scored = filteredIndex
    .map((candidate): CandidateWithScore => {
      const score = scoreCandidate(
        candidate,
        tokens,
        dominantTokens,
        secondaryTokens,
      );
      return {
        id: candidate.id,
        sourceType: candidate.sourceType,
        name: candidate.name,
        company: candidate.company,
        category: candidate.category,
        subcategory: candidate.subcategory,
        certificationStatus: candidate.certificationStatus,
        normalized: candidate.normalized,
        score,
        confidence: confidenceFromScore(score),
      };
    })
    .filter((candidate) => candidate.score >= 10)
    .sort((a, b) => b.score - a.score);

  const deduped = new Map<string, CandidateWithScore>();
  for (const candidate of scored) {
    if (!deduped.has(candidate.id)) {
      deduped.set(candidate.id, candidate);
    }
    if (deduped.size >= 5) break;
  }

  const results = Array.from(deduped.values()).map((candidate) => ({
    id: candidate.id,
    sourceType: candidate.sourceType,
    name: candidate.name,
    company: candidate.company,
    category: candidate.category,
    subcategory: candidate.subcategory,
    certificationStatus: candidate.certificationStatus,
    score: candidate.score,
    confidence: candidate.confidence,
  }));

  return Response.json({
    ok: true,
    query: normalizedQuery,
    tokens,
    dominantTokens,
    secondaryTokens,
    results,
  });
}
