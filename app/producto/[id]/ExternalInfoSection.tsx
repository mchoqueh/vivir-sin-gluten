"use client";

import { useEffect, useState } from "react";

type ExternalInfoSourceLink = {
  title: string;
  url: string;
};

export type ExternalInfoViewModel = {
  id: string;
  source: string;
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
  dataConfidence?: number | null;
  confidence?: number | null;
  fetchedAt: string | null;
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

type DebugInfo = {
  provider?: string;
  confidence?: number;
  dataConfidence?: number;
  tavilyScore?: number | null;
  confidenceBreakdown?: ConfidenceBreakdown;
  matchReason?: string;
  fetchedAt?: string;
  rawPayload?: unknown;
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

type GenerateResponse = {
  ok?: boolean;
  externalInfo?: ExternalInfoViewModel | null;
  message?: string;
  debug?: DebugInfo;
};

function formatDate(value: string | null) {
  if (!value) return "Sin fecha";

  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
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

function ExternalInfoSkeleton() {
  return (
    <section className="rounded-md border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-zinc-950">
        Informacion adicional
      </h2>
      <p className="mt-2 text-sm text-zinc-600">
        Estamos generando informacion adicional para este producto.
      </p>
      <div className="mt-5 space-y-3">
        <div className="h-4 w-3/4 animate-pulse rounded bg-zinc-100" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-zinc-100" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-zinc-100" />
      </div>
    </section>
  );
}

function ExternalInfoCard({
  externalInfo,
}: {
  externalInfo: ExternalInfoViewModel;
}) {
  const rows = [
    ["Tipo de producto", externalInfo.productType],
    ["Principio activo", externalInfo.activeIngredient],
    ["Componentes", externalInfo.components],
    ["Formato", externalInfo.pharmaceuticalForm],
    ["Presentacion", externalInfo.concentration],
    ["Laboratorio", externalInfo.manufacturer ?? externalInfo.holder],
    ["Condicion de venta", externalInfo.saleCondition],
    ["Registro sanitario", externalInfo.sanitaryRegistry],
    ["Estado del registro", externalInfo.registryStatus],
  ] as const;

  return (
    <section className="rounded-md border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-semibold text-zinc-950">
          Informacion adicional
        </h2>
        <span className="rounded bg-sky-50 px-2 py-1 text-xs font-medium text-sky-800">
          Tavily
        </span>
        {externalInfo.productType ? (
          <span className="rounded bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700">
            {externalInfo.productType}
          </span>
        ) : null}
      </div>

      <p className="mt-2 text-sm leading-6 text-zinc-600">
        Resumen generado a partir de fuentes publicas consultadas el{" "}
        {formatDate(externalInfo.fetchedAt)}.
      </p>

      <dl className="mt-4">
        {rows.map(([label, value]) => (
          <FieldRow key={label} label={label} value={value} />
        ))}
      </dl>

      {externalInfo.summary ? (
        <div className="mt-4 rounded-md bg-zinc-50 p-4">
          <h3 className="text-sm font-semibold text-zinc-950">Resumen</h3>
          <p className="mt-2 text-sm leading-6 text-zinc-700">
            {externalInfo.summary}
          </p>
        </div>
      ) : null}

      {externalInfo.sources.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-zinc-950">
            Fuentes consultadas
          </h3>
          <ul className="mt-2 space-y-2 text-sm">
            {externalInfo.sources.map((source) => (
              <li key={source.url}>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-sky-700 hover:text-sky-900"
                >
                  {source.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-4 text-sm leading-6 text-zinc-600">
        Esta informacion fue generada automaticamente a partir de fuentes
        publicas consultadas en Chile.
      </p>
      <p className="mt-2 text-sm leading-6 text-zinc-600">
        Esta informacion es referencial y no reemplaza la indicacion de un
        profesional de salud.
      </p>
    </section>
  );
}

function ConfidenceBreakdownCard({ debugInfo }: { debugInfo: DebugInfo }) {
  const breakdown = debugInfo.confidenceBreakdown;
  if (!breakdown) return null;

  const decisionLabel =
    breakdown.decision === "SAVED" ? "Guardada" : "No guardada";

  return (
    <section className="rounded-md border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-zinc-950">
        Desglose de confianza
      </h2>
      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
        <div className="rounded-md bg-zinc-50 p-3">
          <p className="text-zinc-500">Confianza final</p>
          <p className="mt-1 font-semibold">{breakdown.final}</p>
        </div>
        <div className="rounded-md bg-zinc-50 p-3">
          <p className="text-zinc-500">Umbral</p>
          <p className="mt-1 font-semibold">{breakdown.threshold}</p>
        </div>
        <div className="rounded-md bg-zinc-50 p-3">
          <p className="text-zinc-500">Decision</p>
          <p className="mt-1 font-semibold">{decisionLabel}</p>
        </div>
        <div className="rounded-md bg-zinc-50 p-3">
          <p className="text-zinc-500">Score Tavily principal</p>
          <p className="mt-1 font-semibold">
            {breakdown.tavily.bestScore ?? "Sin dato"}
          </p>
        </div>
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
            <tr>
              <th className="py-2 pr-4">Criterio</th>
              <th className="py-2 pr-4">Peso</th>
              <th className="py-2 pr-4">Score</th>
              <th className="py-2 pr-4">Aporte</th>
              <th className="py-2 pr-4">Estado</th>
              <th className="py-2">Razon</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.criteria.map((criterion) => (
              <tr key={criterion.key} className="border-b border-zinc-100">
                <td className="py-3 pr-4 font-medium text-zinc-950">
                  {criterion.label}
                </td>
                <td className="py-3 pr-4">{criterion.weight}</td>
                <td className="py-3 pr-4">{criterion.score}</td>
                <td className="py-3 pr-4">{criterion.weighted}</td>
                <td className="py-3 pr-4">{criterion.status}</td>
                <td className="py-3 text-zinc-600">{criterion.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-sm text-zinc-600">
        Resultados aceptados: {breakdown.tavily.acceptedResults}. Resultados
        descartados: {breakdown.tavily.discardedResults}. Promedio Tavily
        aceptado: {breakdown.tavily.averageAcceptedScore ?? "Sin dato"}.
      </p>
      {debugInfo.discardedDomains && debugInfo.discardedDomains.length > 0 ? (
        <p className="mt-2 text-sm text-zinc-600">
          Dominios descartados: {debugInfo.discardedDomains.join(", ")}.
        </p>
      ) : null}
    </section>
  );
}

export function ExternalInfoSection({
  productId,
  initialExternalInfo,
  debug,
}: {
  productId: string;
  initialExternalInfo: ExternalInfoViewModel | null;
  debug: boolean;
}) {
  const [externalInfo, setExternalInfo] = useState(initialExternalInfo);
  const [loading, setLoading] = useState(!initialExternalInfo);
  const [message, setMessage] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);

  useEffect(() => {
    if (initialExternalInfo) return;

    const controller = new AbortController();

    async function generate() {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/products/${productId}/external-info/generate${
            debug ? "?debug=1" : ""
          }`,
          { method: "POST", signal: controller.signal },
        );
        const data = (await response.json()) as GenerateResponse;
        setExternalInfo(data.externalInfo ?? null);
        setMessage(data.message ?? null);
        setDebugInfo(data.debug ?? null);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setMessage("Estamos generando informacion adicional para este producto.");
        setDebugInfo(
          debug
            ? {
                provider: "TAVILY",
                error:
                  error instanceof Error ? error.message : "Error desconocido",
              }
            : null,
        );
      } finally {
        setLoading(false);
      }
    }

    void generate();

    return () => controller.abort();
  }, [debug, initialExternalInfo, productId]);

  if (externalInfo) {
    return (
      <>
        <ExternalInfoCard externalInfo={externalInfo} />
        {debug && debugInfo ? (
          <ConfidenceBreakdownCard debugInfo={debugInfo} />
        ) : null}
        {debug && debugInfo ? (
          <pre className="overflow-auto rounded-md bg-zinc-950 p-4 text-xs text-zinc-50">
            {JSON.stringify(debugInfo, null, 2)}
          </pre>
        ) : null}
      </>
    );
  }

  if (loading) return <ExternalInfoSkeleton />;

  return (
    <section className="rounded-md border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-zinc-950">
        Informacion adicional
      </h2>
      <p className="mt-2 text-sm leading-6 text-zinc-600">
        {message ?? "Estamos generando informacion adicional para este producto."}
      </p>
      {debug && debugInfo ? (
        <>
          <div className="mt-4">
            <ConfidenceBreakdownCard debugInfo={debugInfo} />
          </div>
          <pre className="mt-4 overflow-auto rounded-md bg-zinc-950 p-4 text-xs text-zinc-50">
            {JSON.stringify(debugInfo, null, 2)}
          </pre>
        </>
      ) : null}
    </section>
  );
}
