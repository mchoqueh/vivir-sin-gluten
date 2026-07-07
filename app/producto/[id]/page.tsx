import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { prisma } from "@/lib/db";
import {
  certificationStatusLabel,
  formatDate,
  sourceTypeLabel,
} from "@/lib/utils";

export const dynamic = "force-dynamic";

type ProductDetail = {
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
  active: boolean;
  snapshots: Array<{
    id: string;
    rawName: string;
    rawCategory: string | null;
    rawSubcategory: string | null;
    rawCompany: string | null;
    certificationStatus:
      | "CERTIFIED_GLUTEN_FREE"
      | "NOT_RENEWED_ANALYSIS"
      | "UNKNOWN";
    createdAt: Date;
    sync: {
      status: "SUCCESS" | "FAILED" | "SKIPPED_NO_CHANGE";
      createdAt: Date;
    };
  }>;
  changes: Array<{
    id: string;
    type: "ADDED" | "REMOVED" | "MODIFIED";
    title: string;
    createdAt: Date;
  }>;
};

const getProduct = cache(async (id: string): Promise<ProductDetail | null> =>
  prisma.officialItem.findUnique({
    where: { id },
    select: {
      id: true,
      sourceType: true,
      name: true,
      company: true,
      category: true,
      subcategory: true,
      certificationStatus: true,
      active: true,
      snapshots: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          rawName: true,
          rawCategory: true,
          rawSubcategory: true,
          rawCompany: true,
          certificationStatus: true,
          createdAt: true,
          sync: {
            select: {
              status: true,
              createdAt: true,
            },
          },
        },
      },
      changes: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          type: true,
          title: true,
          createdAt: true,
        },
      },
    },
  }),
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const item = await getProduct(id);

  if (!item) {
    return {
      title: "Producto no encontrado | Vivir Sin Gluten",
    };
  }

  const description = `${item.name} · ${item.company ?? "Sin empresa"} · ${
    item.category ?? "Sin categoría"
  } · ${certificationStatusLabel(item.certificationStatus)}.`;

  return {
    title: `${item.name} | Vivir Sin Gluten`,
    description,
    openGraph: {
      title: `${item.name} | Vivir Sin Gluten`,
      description,
      type: "article",
    },
  };
}

export default async function ProductoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const item = await getProduct(id);

  if (!item) notFound();

  const latestSnapshot = item.snapshots[0];
  const latestSync = latestSnapshot?.sync;
  const officialSource =
    item.sourceType === "FOOD"
      ? "Listado oficial de alimentos de Fundación Convivir"
      : "Listado oficial de medicamentos de Fundación Convivir";

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-10">
      <Link href="/buscar" className="text-sm font-medium text-emerald-700">
        Volver a búsqueda
      </Link>
      <section className="mt-8 rounded-md border border-zinc-200 bg-white p-6">
        <div className="flex flex-wrap gap-2">
          <span className="rounded bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800">
            {sourceTypeLabel(item.sourceType)}
          </span>
          <span className="rounded bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700">
            {item.active ? "Activo" : "Inactivo"}
          </span>
          <span
            className={`rounded px-2 py-1 text-xs font-medium ${
              item.certificationStatus === "NOT_RENEWED_ANALYSIS"
                ? "bg-amber-100 text-amber-900"
                : "bg-zinc-100 text-zinc-700"
            }`}
          >
            {item.certificationStatus === "NOT_RENEWED_ANALYSIS"
              ? "⚠️ No ha renovado análisis"
              : certificationStatusLabel(item.certificationStatus)}
          </span>
        </div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">
          {item.name}
        </h1>

        <div
          className={`mt-5 rounded-md border px-4 py-3 text-sm ${
            item.certificationStatus === "NOT_RENEWED_ANALYSIS"
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : "border-emerald-200 bg-emerald-50 text-emerald-900"
          }`}
        >
          {item.certificationStatus === "NOT_RENEWED_ANALYSIS"
            ? "Este producto aparece en la sección de alimentos que no han renovado análisis. Se recomienda revisar la información más reciente antes de consumirlo."
            : "Este producto figura en el listado oficial vigente de Fundación Convivir como producto certificado sin gluten."}
        </div>

        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase text-zinc-500">Nombre</dt>
            <dd className="mt-1 text-sm font-medium">{item.name}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-zinc-500">Empresa</dt>
            <dd className="mt-1 text-sm font-medium">
              {item.company ?? "Sin dato"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-zinc-500">Tipo</dt>
            <dd className="mt-1 text-sm font-medium">
              {sourceTypeLabel(item.sourceType)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-zinc-500">Estado</dt>
            <dd className="mt-1 text-sm font-medium">
              {certificationStatusLabel(item.certificationStatus)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-zinc-500">Categoría</dt>
            <dd className="mt-1 text-sm font-medium">
              {item.category ?? "Sin dato"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-zinc-500">Subcategoría</dt>
            <dd className="mt-1 text-sm font-medium">
              {item.subcategory ?? "Sin dato"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-zinc-500">Fuente del dato</dt>
            <dd className="mt-1 text-sm font-medium">{officialSource}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-zinc-500">
              Última sincronización
            </dt>
            <dd className="mt-1 text-sm font-medium">
              {latestSync ? formatDate(latestSync.createdAt) : "Sin dato"}
            </dd>
          </div>
        </dl>

        <p className="mt-6 border-l-4 border-zinc-300 pl-4 text-sm leading-6 text-zinc-600">
          La ausencia de un producto en este buscador no significa
          necesariamente que contenga gluten. Solo indica que no figura en los
          datos oficiales cargados en esta plataforma.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">Últimos snapshots</h2>
        <div className="mt-3 grid gap-3">
          {item.snapshots.map((snapshot) => (
            <div
              key={snapshot.id}
              className="rounded-md border border-zinc-200 bg-white p-4 text-sm"
            >
              <p className="font-medium">{snapshot.rawName}</p>
              <p className="mt-1 text-zinc-600">
                {snapshot.rawCategory ?? "Sin categoría"} ·{" "}
                {snapshot.rawSubcategory ?? "Sin subcategoría"} ·{" "}
                {snapshot.rawCompany ?? "Sin empresa"}
              </p>
              <p className="mt-1 text-zinc-600">
                {certificationStatusLabel(snapshot.certificationStatus)} · Sync{" "}
                {snapshot.sync.status} · {formatDate(snapshot.createdAt)}
              </p>
            </div>
          ))}
          {item.snapshots.length === 0 ? (
            <p className="text-sm text-zinc-600">Aún no hay snapshots.</p>
          ) : null}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">Últimos cambios</h2>
        <div className="mt-3 grid gap-3">
          {item.changes.map((change) => (
            <div
              key={change.id}
              className="rounded-md border border-zinc-200 bg-white p-4 text-sm"
            >
              <p className="font-medium">
                {change.type}: {change.title}
              </p>
              <p className="mt-1 text-zinc-600">{formatDate(change.createdAt)}</p>
            </div>
          ))}
          {item.changes.length === 0 ? (
            <p className="text-sm text-zinc-600">Aún no hay cambios asociados.</p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
