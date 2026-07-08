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
import {
  getExternalInfoForItem,
  type ExternalProductInfo,
} from "@/lib/external/product-info";

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

type ProductPageSearchParams = {
  debug?: string | string[];
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

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isDebugMode(searchParams: ProductPageSearchParams | undefined) {
  return firstParam(searchParams?.debug) === "1";
}

function isSupplementLike(item: Pick<ProductDetail, "name" | "category" | "subcategory">) {
  return /suplement/i.test(
    [item.name, item.category, item.subcategory].filter(Boolean).join(" "),
  );
}

function productTypeLabel(
  item: Pick<ProductDetail, "sourceType" | "name" | "category" | "subcategory">,
  externalInfo: ExternalProductInfo | null,
) {
  if (/suplement/i.test(externalInfo?.productType ?? "")) return "Suplemento";
  if (isSupplementLike(item)) return "Suplemento";

  return sourceTypeLabel(item.sourceType);
}

function statusMeta(status: ProductDetail["certificationStatus"]) {
  if (status === "CERTIFIED_GLUTEN_FREE") {
    return {
      badge: "Certificado sin gluten",
      title: "Producto certificado sin gluten",
      text: "Este producto figura en el listado oficial vigente como certificado sin gluten.",
      badgeClass: "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200",
      cardClass: "border-emerald-200 bg-emerald-50 text-emerald-950",
    };
  }

  if (status === "NOT_RENEWED_ANALYSIS") {
    return {
      badge: "No ha renovado analisis",
      title: "Producto sin analisis renovado",
      text: "Este producto figura en el listado oficial, pero no cuenta con analisis renovado segun la fuente cargada.",
      badgeClass: "bg-amber-100 text-amber-950 ring-1 ring-amber-200",
      cardClass: "border-amber-200 bg-amber-50 text-amber-950",
    };
  }

  return {
    badge: "No certificado",
    title: "Estado de certificacion no confirmado",
    text: "Este producto no tiene un estado de certificacion confirmado en los datos oficiales cargados.",
    badgeClass: "bg-red-100 text-red-900 ring-1 ring-red-200",
    cardClass: "border-red-200 bg-red-50 text-red-950",
  };
}

function officialDocumentLabel(sourceType: ProductDetail["sourceType"]) {
  return sourceType === "FOOD"
    ? "Listado oficial de alimentos"
    : "Listado oficial de medicamentos";
}

function FieldRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;

  return (
    <div className="flex items-start justify-between gap-4 border-t border-zinc-100 py-3 first:border-t-0">
      <dt className="text-sm text-zinc-500">{label}</dt>
      <dd className="max-w-[65%] text-right text-sm font-medium text-zinc-950">
        {value}
      </dd>
    </div>
  );
}

function ExternalProductInfoCard({
  externalInfo,
}: {
  externalInfo: ExternalProductInfo;
}) {
  const rows = [
    ["Principio activo", externalInfo.activeIngredient],
    ["Componentes", externalInfo.components],
    ["Forma farmaceutica", externalInfo.pharmaceuticalForm],
    ["Concentracion", externalInfo.concentration],
    ["Registro sanitario", externalInfo.sanitaryRegistry],
    ["Condicion de venta", externalInfo.saleCondition],
    ["Titular", externalInfo.holder],
    ["Fabricante", externalInfo.manufacturer],
    ["Fecha de consulta", externalInfo.fetchedAt ? formatDate(externalInfo.fetchedAt) : null],
  ] as const;

  return (
    <section className="rounded-md border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-semibold text-zinc-950">
          Informacion adicional
        </h2>
        <span className="rounded bg-sky-50 px-2 py-1 text-xs font-medium text-sky-800">
          {externalInfo.source === "ISP" ? "ISP/ANAMED" : externalInfo.source}
        </span>
        {externalInfo.productType ? (
          <span className="rounded bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700">
            {externalInfo.productType}
          </span>
        ) : null}
      </div>

      <dl className="mt-4">
        {rows.map(([label, value]) => (
          <FieldRow key={label} label={label} value={value} />
        ))}
      </dl>

      {externalInfo.sourceUrl ? (
        <a
          href={externalInfo.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
        >
          Ver fuente externa
        </a>
      ) : null}

      <p className="mt-4 text-sm leading-6 text-zinc-600">
        Informacion sanitaria/comercial obtenida desde fuentes externas. No
        reemplaza la indicacion de un profesional de salud.
      </p>
    </section>
  );
}

function DebugSection({ item }: { item: ProductDetail }) {
  return (
    <section className="rounded-md border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold">Debug interno</h2>

      <div className="mt-5 grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">
            Ultimos snapshots
          </h3>
          <div className="mt-3 grid gap-3">
            {item.snapshots.map((snapshot) => (
              <div
                key={snapshot.id}
                className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm"
              >
                <p className="font-medium">{snapshot.rawName}</p>
                <p className="mt-1 text-zinc-600">
                  {snapshot.rawCategory ?? "Sin categoria"} /{" "}
                  {snapshot.rawSubcategory ?? "Sin subcategoria"} /{" "}
                  {snapshot.rawCompany ?? "Sin empresa"}
                </p>
                <p className="mt-1 text-zinc-600">
                  {certificationStatusLabel(snapshot.certificationStatus)} /{" "}
                  {snapshot.sync.status} / {formatDate(snapshot.createdAt)}
                </p>
              </div>
            ))}
            {item.snapshots.length === 0 ? (
              <p className="text-sm text-zinc-600">Aun no hay snapshots.</p>
            ) : null}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-zinc-900">
            Ultimos cambios
          </h3>
          <div className="mt-3 grid gap-3">
            {item.changes.map((change) => (
              <div
                key={change.id}
                className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm"
              >
                <p className="font-medium">
                  {change.type}: {change.title}
                </p>
                <p className="mt-1 text-zinc-600">
                  {formatDate(change.createdAt)}
                </p>
              </div>
            ))}
            {item.changes.length === 0 ? (
              <p className="text-sm text-zinc-600">
                Aun no hay cambios asociados.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

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

  const description = `${item.name} - ${item.company ?? "Sin empresa"} - ${
    item.category ?? "Sin categoria"
  } - ${certificationStatusLabel(item.certificationStatus)}.`;

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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<ProductPageSearchParams>;
}) {
  const [{ id }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams,
  ]);
  const item = await getProduct(id);

  if (!item) notFound();

  const externalInfo = await getExternalInfoForItem(item);
  const latestSnapshot = item.snapshots[0];
  const latestSync = latestSnapshot?.sync;
  const status = statusMeta(item.certificationStatus);
  const typeLabel = productTypeLabel(item, externalInfo);
  const debug = isDebugMode(resolvedSearchParams);
  const categoryAddsContext =
    item.category &&
    item.category.toLowerCase() !== item.sourceType.toLowerCase();
  const subcategoryAddsContext =
    item.subcategory &&
    item.subcategory.toLowerCase() !== (item.category ?? "").toLowerCase();

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-7 sm:px-6 sm:py-10">
      <Link href="/buscar" className="text-sm font-medium text-emerald-700">
        Volver a busqueda
      </Link>

      <header className="mt-7 rounded-md border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap gap-2">
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${status.badgeClass}`}
          >
            {status.badge}
          </span>
          <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-700">
            {typeLabel}
          </span>
          {!item.active ? (
            <span className="rounded-full bg-zinc-200 px-3 py-1 text-xs font-semibold text-zinc-700">
              Inactivo
            </span>
          ) : null}
        </div>

        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-950 sm:text-4xl">
          {item.name}
        </h1>
        <p className="mt-2 text-base text-zinc-600">
          {item.company ?? "Empresa o laboratorio no informado"}
        </p>
      </header>

      <div className="mt-5 grid gap-5">
        <section
          className={`rounded-md border p-5 shadow-sm ${status.cardClass}`}
        >
          <h2 className="text-xl font-semibold">{status.title}</h2>
          <p className="mt-2 text-sm leading-6">{status.text}</p>
        </section>

        <section className="rounded-md border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-950">
            Informacion del producto
          </h2>
          <dl className="mt-4">
            <FieldRow label="Laboratorio o empresa" value={item.company} />
            {categoryAddsContext ? (
              <FieldRow label="Categoria" value={item.category} />
            ) : null}
            {subcategoryAddsContext ? (
              <FieldRow label="Subcategoria" value={item.subcategory} />
            ) : null}
            <FieldRow label="Tipo de producto" value={typeLabel} />
          </dl>
        </section>

        <section className="rounded-md border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-950">Trazabilidad</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            Informacion obtenida
            {latestSync ? ` el ${formatDate(latestSync.createdAt)}` : ""} a
            partir del PDF/listado oficial publicado por Fundacion Convivir.
          </p>
          <dl className="mt-4">
            <FieldRow label="Fuente" value="Fundacion Convivir" />
            <FieldRow
              label="Documento"
              value={officialDocumentLabel(item.sourceType)}
            />
            <FieldRow
              label="Fecha de sincronizacion"
              value={latestSync ? formatDate(latestSync.createdAt) : "Sin dato"}
            />
            {debug ? (
              <FieldRow label="Estado de carga" value={latestSync?.status} />
            ) : null}
          </dl>
        </section>

        {externalInfo ? (
          <ExternalProductInfoCard externalInfo={externalInfo} />
        ) : null}

        <section className="rounded-md border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-950">
            Aviso importante
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            La ausencia de un producto en este buscador no significa
            necesariamente que contenga gluten. Solo indica que no figura en los
            datos oficiales cargados en esta plataforma.
          </p>
        </section>

        {debug ? <DebugSection item={item} /> : null}
      </div>
    </main>
  );
}
