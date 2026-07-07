"use client";

import Link from "next/link";
import { certificationStatusLabel, sourceTypeLabel } from "@/lib/utils";

export type ScannerResult = {
  id: string;
  sourceType: "FOOD" | "MEDICINE";
  name: string;
  company: string | null;
  category: string | null;
  subcategory: string | null;
  certificationStatus: string;
  score: number;
  confidence: number;
};

type ScannerResultsProps = {
  results: ScannerResult[];
  detectedText: string;
  productType: "ALL" | "FOOD" | "MEDICINE";
};

function manualSearchHref(
  detectedText: string,
  productType: "ALL" | "FOOD" | "MEDICINE",
) {
  const params = new URLSearchParams();
  if (detectedText.trim()) params.set("q", detectedText.trim());
  if (productType !== "ALL") params.set("type", productType);

  const query = params.toString();
  return query ? `/buscar?${query}` : "/buscar";
}

export function ScannerResults({
  results,
  detectedText,
  productType,
}: ScannerResultsProps) {
  const best = results[0];
  const hasHighConfidence = best && best.confidence >= 65;
  const listResults = hasHighConfidence ? results.slice(1) : results;

  return (
    <section className="rounded-t-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Coincidencias probables</h2>
          <p className="text-sm text-zinc-600">
            {results.length > 0
              ? `${results.length} resultado${results.length === 1 ? "" : "s"}`
              : "Sin coincidencias todavía"}
          </p>
        </div>
        <Link
          href={manualSearchHref(detectedText, productType)}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800"
        >
          Buscar manualmente
        </Link>
      </div>

      {hasHighConfidence ? (
        <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-xs font-medium uppercase text-emerald-800">
            Coincidencia principal
          </p>
          <ResultCard result={best} highlighted />
        </div>
      ) : null}

      <div className="mt-4 grid gap-3">
        {listResults.map((result) => (
          <ResultCard key={result.id} result={result} />
        ))}
        {results.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-300 p-4 text-sm text-zinc-600">
            Apunta al frente del producto o usa la búsqueda manual con el texto
            detectado.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function ResultCard({
  result,
  highlighted = false,
}: {
  result: ScannerResult;
  highlighted?: boolean;
}) {
  return (
    <Link
      href={`/producto/${result.id}`}
      className={`block rounded-md border p-3 ${
        highlighted
          ? "border-emerald-200 bg-white"
          : "border-zinc-200 bg-white hover:border-emerald-300"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800">
          {sourceTypeLabel(result.sourceType)}
        </span>
        <span
          className={`rounded px-2 py-1 text-xs font-medium ${
            result.certificationStatus === "NOT_RENEWED_ANALYSIS"
              ? "bg-amber-100 text-amber-900"
              : "bg-zinc-100 text-zinc-700"
          }`}
        >
          {result.certificationStatus === "NOT_RENEWED_ANALYSIS"
            ? "⚠️ No ha renovado análisis"
            : certificationStatusLabel(result.certificationStatus)}
        </span>
        {result.confidence >= 55 ? (
          <span className="text-xs text-zinc-500">
            Confianza {result.confidence}%
          </span>
        ) : null}
      </div>
      <h3 className="mt-2 font-semibold text-zinc-950">{result.name}</h3>
      <dl className="mt-2 grid gap-1 text-sm text-zinc-600">
        <div>
          <dt className="inline font-medium">Empresa: </dt>
          <dd className="inline">{result.company ?? "Sin dato"}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Categoría: </dt>
          <dd className="inline">{result.category ?? "Sin dato"}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Subcategoría: </dt>
          <dd className="inline">{result.subcategory ?? "Sin dato"}</dd>
        </div>
      </dl>
    </Link>
  );
}
