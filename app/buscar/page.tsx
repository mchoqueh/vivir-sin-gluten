import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { SearchExperience, type SearchInitialState } from "./SearchExperience";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Buscar alimentos y medicamentos sin gluten | Vivir Sin Gluten",
  description:
    "Busca productos, empresas, categorias y medicamentos desde los listados oficiales cargados de Fundacion Convivir.",
};

type SearchParams = {
  q?: string | string[];
  type?: string | string[];
  status?: string | string[];
  category?: string | string[];
  company?: string | string[];
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function BuscarPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const type = firstParam(params.type);
  const status = firstParam(params.status);
  const initialState: SearchInitialState = {
    q: firstParam(params.q)?.replace(/\s+/g, " ").trim() ?? "",
    type: type === "FOOD" || type === "MEDICINE" ? type : undefined,
    status:
      status === "CERTIFIED_GLUTEN_FREE" ||
      status === "NOT_RENEWED_ANALYSIS" ||
      status === "UNKNOWN"
        ? status
        : undefined,
    category: firstParam(params.category)?.trim() ?? "",
    company: firstParam(params.company)?.trim() ?? "",
  };

  const items = await prisma.officialItem.findMany({
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
      _count: {
        select: { externalInfos: true },
      },
    },
    orderBy: [{ sourceType: "asc" }, { name: "asc" }],
    take: 10000,
  });

  return (
    <SearchExperience
      items={items.map((item) => ({
        id: item.id,
        sourceType: item.sourceType,
        name: item.name,
        company: item.company,
        category: item.category,
        subcategory: item.subcategory,
        certificationStatus: item.certificationStatus,
        normalized: item.normalized,
        hasExternalInfo: item._count.externalInfos > 0,
      }))}
      initialState={initialState}
    />
  );
}
