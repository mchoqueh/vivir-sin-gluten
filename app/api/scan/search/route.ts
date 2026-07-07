import { prisma } from "@/lib/db";
import {
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

function scoreCandidate(candidate: Candidate, tokens: string[]) {
  if (tokens.length === 0) return 0;

  const fields = {
    name: normalizeProductSearchText(candidate.name),
    company: normalizeProductSearchText(candidate.company ?? ""),
    category: normalizeProductSearchText(candidate.category ?? ""),
    subcategory: normalizeProductSearchText(candidate.subcategory ?? ""),
    type: normalizeProductSearchText(sourceTypeLabel(candidate.sourceType)),
    status: normalizeProductSearchText(
      certificationStatusLabel(candidate.certificationStatus),
    ),
  };

  let score = 0;

  for (const token of tokens) {
    if (fields.name.includes(token)) score += 5;
    if (fields.company.includes(token)) score += 4;
    if (fields.subcategory.includes(token)) score += 3;
    if (fields.category.includes(token)) score += 2;
    if (fields.type.includes(token)) score += 1;
    if (fields.status.includes(token)) score += 1;
  }

  const exactName = fields.name && tokens.some((token) => fields.name === token);
  const coverage = tokens.filter((token) =>
    candidate.normalized.includes(token),
  ).length;
  const coverageBonus = (coverage / tokens.length) * 20;

  return Math.round(score + coverageBonus + (exactName ? 10 : 0));
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    text?: unknown;
    type?: unknown;
  } | null;
  const text = typeof body?.text === "string" ? body.text : "";
  const type = body?.type;
  const sourceType: ProductTypeFilter =
    type === "FOOD" || type === "MEDICINE" ? type : "ALL";
  const tokens = tokenizeProductSearchText(text).slice(0, 12);

  if (tokens.length === 0) {
    return Response.json({
      ok: true,
      query: normalizeProductSearchText(text),
      tokens,
      results: [],
    });
  }

  const candidates: Candidate[] = await prisma.officialItem.findMany({
    where: {
      active: true,
      ...(sourceType === "ALL" ? {} : { sourceType }),
      OR: tokens.map((token) => ({
        normalized: { contains: token },
      })),
    },
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
    take: 80,
  });

  const results = candidates
    .map((candidate) => ({
      ...candidate,
      score: scoreCandidate(candidate, tokens),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((candidate) => ({
      id: candidate.id,
      sourceType: candidate.sourceType,
      name: candidate.name,
      company: candidate.company,
      category: candidate.category,
      subcategory: candidate.subcategory,
      certificationStatus: candidate.certificationStatus,
      score: candidate.score,
      confidence: Math.min(99, Math.round(candidate.score * 1.8)),
    }));

  return Response.json({
    ok: true,
    query: normalizeProductSearchText(text),
    tokens,
    results,
  });
}
