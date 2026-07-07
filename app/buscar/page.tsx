import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { prisma } from "@/lib/db";
import {
  certificationStatusLabel,
  normalizeSearchText,
  sourceTypeLabel,
} from "@/lib/utils";

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

type SearchItem = {
  id: string;
  sourceType: "FOOD" | "MEDICINE";
  name: string;
  company: string | null;
  category: string | null;
  subcategory: string | null;
  certificationStatus:
    | "CERTIFIED_GLUTEN_FREE"
    | "NOT_RENEWED_ANALYSIS"
    | "UNKNOWN";
};

type CategoryOption = {
  category: string | null;
};

type CompanyOption = {
  company: string | null;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function buildHref(params: {
  q?: string;
  type?: string;
  status?: string;
  category?: string;
  company?: string;
}) {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }

  const query = search.toString();
  return query ? `/buscar?${query}` : "/buscar";
}

export default async function BuscarPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const q = firstParam(params.q)?.replace(/\s+/g, " ").trim() ?? "";
  const type = firstParam(params.type);
  const status = firstParam(params.status);
  const category = firstParam(params.category)?.trim() ?? "";
  const company = firstParam(params.company)?.trim() ?? "";
  const sourceType = type === "FOOD" || type === "MEDICINE" ? type : undefined;
  const certificationStatus =
    status === "CERTIFIED_GLUTEN_FREE" ||
    status === "NOT_RENEWED_ANALYSIS" ||
    status === "UNKNOWN"
      ? status
      : undefined;
  const normalizedQuery = normalizeSearchText(q);

  const baseWhere = {
    active: true,
    ...(sourceType ? { sourceType } : {}),
    ...(certificationStatus ? { certificationStatus } : {}),
    ...(category ? { category } : {}),
    ...(company ? { company } : {}),
  } satisfies Prisma.OfficialItemWhereInput;

  const [items, categories, companies]: [
    SearchItem[],
    CategoryOption[],
    CompanyOption[],
  ] = await Promise.all([
    prisma.officialItem.findMany({
      where: {
        ...baseWhere,
        ...(normalizedQuery
          ? { normalized: { contains: normalizedQuery } }
          : {}),
      },
      select: {
        id: true,
        sourceType: true,
        name: true,
        company: true,
        category: true,
        subcategory: true,
        certificationStatus: true,
      },
      orderBy: [{ sourceType: "asc" }, { name: "asc" }],
      take: 80,
    }),
    prisma.officialItem.findMany({
      where: {
        active: true,
        ...(sourceType ? { sourceType } : {}),
        ...(certificationStatus ? { certificationStatus } : {}),
      },
      select: { category: true },
      distinct: ["category"],
      orderBy: { category: "asc" },
    }),
    prisma.officialItem.findMany({
      where: {
        active: true,
        ...(sourceType ? { sourceType } : {}),
        ...(certificationStatus ? { certificationStatus } : {}),
        ...(category ? { category } : {}),
      },
      select: { company: true },
      distinct: ["company"],
      orderBy: { company: "asc" },
    }),
  ]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl overflow-x-hidden px-4 py-8 sm:px-6 sm:py-10">
      <Link href="/" className="text-sm font-medium text-emerald-700">
        Volver al inicio
      </Link>

      <div className="mt-8 grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="min-w-0">
          <h1 className="break-words text-3xl font-semibold tracking-tight">
            Buscar productos
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600 sm:text-base">
            Busca por producto, empresa, categoria o tipo. La busqueda ignora
            mayusculas, tildes y espacios repetidos.
          </p>
        </div>
      </div>

      <form className="mt-8 grid min-w-0 gap-4 rounded-md border border-zinc-200 bg-white p-3 sm:p-4">
        <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <input
            name="q"
            defaultValue={q}
            placeholder="Ej: bago, mani, levocetirizina"
            className="h-11 min-w-0 rounded-md border border-zinc-300 bg-white px-3 text-sm outline-none ring-emerald-600 focus:ring-2"
          />
          <button className="h-11 rounded-md bg-emerald-700 px-5 text-sm font-semibold text-white hover:bg-emerald-800">
            Buscar
          </button>
        </div>

        <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="grid min-w-0 gap-1 text-sm">
            <span className="font-medium text-zinc-700">Estado</span>
            <select
              name="status"
              defaultValue={certificationStatus ?? ""}
              className="h-10 min-w-0 max-w-full rounded-md border border-zinc-300 bg-white px-3"
            >
              <option value="">Todos</option>
              <option value="CERTIFIED_GLUTEN_FREE">
                Certificado sin gluten
              </option>
              <option value="NOT_RENEWED_ANALYSIS">
                No ha renovado analisis
              </option>
            </select>
          </label>

          <label className="grid min-w-0 gap-1 text-sm">
            <span className="font-medium text-zinc-700">Categoria</span>
            <select
              name="category"
              defaultValue={category}
              className="h-10 min-w-0 max-w-full rounded-md border border-zinc-300 bg-white px-3"
            >
              <option value="">Todas</option>
              {categories
                .filter((item) => item.category)
                .map((item) => (
                  <option key={item.category} value={item.category ?? ""}>
                    {item.category}
                  </option>
                ))}
            </select>
          </label>

          <label className="grid min-w-0 gap-1 text-sm">
            <span className="font-medium text-zinc-700">Empresa</span>
            <select
              name="company"
              defaultValue={company}
              className="h-10 min-w-0 max-w-full rounded-md border border-zinc-300 bg-white px-3"
            >
              <option value="">Todas</option>
              {companies
                .filter((item) => item.company)
                .map((item) => (
                  <option key={item.company} value={item.company ?? ""}>
                    {item.company}
                  </option>
                ))}
            </select>
          </label>
        </div>

        <div className="flex min-w-0 flex-wrap gap-2">
          {[
            ["", "Todos"],
            ["FOOD", "Alimentos"],
            ["MEDICINE", "Medicamentos"],
          ].map(([value, label]) => (
            <Link
              key={value}
              href={buildHref({
                q,
                type: value,
                status: certificationStatus,
                category,
                company,
              })}
              className={`rounded-md border px-3 py-2 text-sm ${
                (value || undefined) === sourceType
                  ? "border-emerald-700 bg-emerald-50 text-emerald-800"
                  : "border-zinc-300 bg-white text-zinc-700"
              }`}
            >
              {label}
            </Link>
          ))}
          <Link
            href="/buscar"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            Limpiar filtros
          </Link>
        </div>
      </form>

      <p className="mt-5 text-sm text-zinc-600">
        {items.length} resultado{items.length === 1 ? "" : "s"} mostrado
        {items.length === 80 ? "s (maximo 80)" : ""}.
      </p>

      <section className="mt-4 grid min-w-0 gap-3">
        {items.map((item) => (
          <Link
            key={item.id}
            href={`/producto/${item.id}`}
            className="block min-w-0 rounded-md border border-zinc-200 bg-white p-4 transition hover:border-emerald-300"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="max-w-full break-words rounded bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800">
                {sourceTypeLabel(item.sourceType)}
              </span>
              <span
                className={`max-w-full break-words rounded px-2 py-1 text-xs font-medium ${
                  item.certificationStatus === "NOT_RENEWED_ANALYSIS"
                    ? "bg-amber-100 text-amber-900"
                    : "bg-zinc-100 text-zinc-700"
                }`}
              >
                {item.certificationStatus === "NOT_RENEWED_ANALYSIS"
                  ? "No ha renovado analisis"
                  : certificationStatusLabel(item.certificationStatus)}
              </span>
            </div>

            <h2 className="mt-3 min-w-0 break-words text-lg font-semibold leading-6">
              {item.name}
            </h2>

            <dl className="mt-3 grid min-w-0 gap-3 text-sm text-zinc-600 sm:grid-cols-2 lg:grid-cols-4">
              <div className="min-w-0">
                <dt className="text-xs uppercase text-zinc-500">Empresa</dt>
                <dd className="break-words">{item.company ?? "Sin dato"}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs uppercase text-zinc-500">Tipo</dt>
                <dd className="break-words">
                  {sourceTypeLabel(item.sourceType)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs uppercase text-zinc-500">Categoria</dt>
                <dd className="break-words">{item.category ?? "Sin dato"}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs uppercase text-zinc-500">
                  Subcategoria
                </dt>
                <dd className="break-words">
                  {item.subcategory ?? "Sin dato"}
                </dd>
              </div>
            </dl>
          </Link>
        ))}

        {items.length === 0 ? (
          <div className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-600 sm:p-8 sm:text-base">
            No hay resultados para esta busqueda.
          </div>
        ) : null}
      </section>
    </main>
  );
}
