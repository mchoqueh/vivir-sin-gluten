"use client";

import { useEffect, useState } from "react";

const VERCEL_SYNC_TIMEOUT_SECONDS = 300;
const SOURCE_LABELS = {
  FOOD: "Alimentos",
  MEDICINE: "Medicamentos",
} as const;

type SyncAction = "official" | "external";

type SyncChangedItem = {
  id?: string;
  name: string;
  company?: string | null;
  category?: string | null;
  subcategory?: string | null;
};

type OfficialSourceResult = {
  sourceType: "FOOD" | "MEDICINE";
  status: string;
  itemCount?: number;
  added?: number;
  removed?: number;
  modified?: number;
  addedItems?: SyncChangedItem[];
  removedItems?: SyncChangedItem[];
  addedItemsTruncated?: boolean;
  removedItemsTruncated?: boolean;
};

type SyncResponse = {
  ok?: boolean;
  type?: string;
  startedAt?: string;
  finishedAt?: string;
  status?: string;
  processed?: number;
  created?: number;
  updated?: number;
  skipped?: number;
  noMatch?: number;
  errors?: unknown[];
  message?: string;
  results?: OfficialSourceResult[];
};

function previewText(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}

async function readSyncResponse(response: Response) {
  const url = response.url;
  const status = response.status;
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  const isJson = contentType.toLowerCase().includes("application/json");

  if (!isJson) {
    return {
      ok: false,
      error: "La respuesta del servidor no fue JSON.",
      details: {
        step: "SYNC_BUTTON_FETCH",
        url,
        status,
        contentType,
        bodyPreview: previewText(text),
      },
    };
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `No se pudo interpretar la respuesta JSON: ${error.message}`
          : "No se pudo interpretar la respuesta JSON.",
      details: {
        step: "SYNC_BUTTON_PARSE_JSON",
        url,
        status,
        contentType,
        bodyPreview: previewText(text),
      },
    };
  }
}

function isSyncResponse(value: unknown): value is SyncResponse {
  return typeof value === "object" && value !== null;
}

function itemLabel(item: SyncChangedItem) {
  return [item.name, item.company].filter(Boolean).join(" - ");
}

function ChangeList({
  title,
  items,
  truncated,
  tone,
}: {
  title: string;
  items: SyncChangedItem[] | undefined;
  truncated?: boolean;
  tone: "added" | "removed";
}) {
  const color =
    tone === "added"
      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
      : "border-amber-200 bg-amber-50 text-amber-950";

  return (
    <div className={`rounded-md border p-3 ${color}`}>
      <h4 className="text-sm font-semibold">{title}</h4>
      {items && items.length > 0 ? (
        <ul className="mt-2 space-y-1 text-sm">
          {items.map((item) => (
            <li key={`${item.id ?? item.name}-${item.company ?? ""}`}>
              <span className="font-medium">{itemLabel(item)}</span>
              {item.category || item.subcategory ? (
                <span className="text-xs opacity-80">
                  {" "}
                  ({[item.category, item.subcategory].filter(Boolean).join(" / ")})
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm opacity-80">Sin cambios.</p>
      )}
      {truncated ? (
        <p className="mt-2 text-xs opacity-80">
          Lista resumida. Revisa el JSON para el conteo completo.
        </p>
      ) : null}
    </div>
  );
}

function ProgressBox({
  elapsedSeconds,
  label,
}: {
  elapsedSeconds: number;
  label: string;
}) {
  const progress = Math.min(
    95,
    Math.round((elapsedSeconds / VERCEL_SYNC_TIMEOUT_SECONDS) * 100),
  );

  return (
    <div className="mt-5 rounded-md border border-emerald-100 bg-emerald-50 p-4">
      <div className="flex items-center justify-between gap-3 text-sm">
        <p className="font-medium text-emerald-950">{label}</p>
        <p className="shrink-0 tabular-nums text-emerald-800">
          {elapsedSeconds}s
        </p>
      </div>
      <div className="mt-3 h-3 overflow-hidden rounded-full bg-white">
        <div
          className="h-full rounded-full bg-emerald-600 transition-[width] duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-emerald-800">
        <span>Progreso estimado</span>
        <span>{progress}%</span>
      </div>
    </div>
  );
}

function OfficialResultSummary({ result }: { result: SyncResponse }) {
  if (!Array.isArray(result.results)) return null;

  return (
    <div className="mt-6 space-y-4">
      {result.results.map((sourceResult) => (
        <section
          key={sourceResult.sourceType}
          className="rounded-md border border-zinc-200 bg-white p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-zinc-950">
                {SOURCE_LABELS[sourceResult.sourceType]}
              </h3>
              <p className="text-sm text-zinc-600">
                Estado: {sourceResult.status} · Items:{" "}
                {sourceResult.itemCount ?? "-"}
              </p>
            </div>
            <div className="flex gap-2 text-xs font-semibold">
              <span className="rounded bg-emerald-100 px-2 py-1 text-emerald-800">
                +{sourceResult.added ?? 0}
              </span>
              <span className="rounded bg-amber-100 px-2 py-1 text-amber-900">
                -{sourceResult.removed ?? 0}
              </span>
              <span className="rounded bg-zinc-100 px-2 py-1 text-zinc-700">
                mod {sourceResult.modified ?? 0}
              </span>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <ChangeList
              title="Incorporados"
              items={sourceResult.addedItems}
              truncated={sourceResult.addedItemsTruncated}
              tone="added"
            />
            <ChangeList
              title="Removidos"
              items={sourceResult.removedItems}
              truncated={sourceResult.removedItemsTruncated}
              tone="removed"
            />
          </div>
        </section>
      ))}
    </div>
  );
}

function ExternalResultSummary({ result }: { result: SyncResponse }) {
  if (
    result.type !== "EXTERNAL_INFO_BACKFILL" &&
    result.type !== "EXTERNAL_PRODUCT_INFO"
  ) {
    return null;
  }

  return (
    <div className="mt-6 rounded-md border border-zinc-200 bg-white p-4">
      <h3 className="font-semibold text-zinc-950">
        Resumen de informacion adicional
      </h3>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="text-zinc-500">Procesados</dt>
          <dd className="font-semibold">{result.processed ?? 0}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Creados</dt>
          <dd className="font-semibold">{result.created ?? 0}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Actualizados</dt>
          <dd className="font-semibold">{result.updated ?? 0}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Sin match</dt>
          <dd className="font-semibold">{result.noMatch ?? 0}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Omitidos</dt>
          <dd className="font-semibold">{result.skipped ?? 0}</dd>
        </div>
        <div>
          <dt className="text-zinc-500">Errores</dt>
          <dd className="font-semibold">{result.errors?.length ?? 0}</dd>
        </div>
      </dl>
      {result.message ? (
        <p className="mt-4 text-sm text-zinc-600">{result.message}</p>
      ) : null}
    </div>
  );
}

function SyncResult({ result }: { result: unknown }) {
  if (!isSyncResponse(result)) {
    return (
      <pre className="mt-8 overflow-auto rounded-md bg-zinc-950 p-4 text-sm text-zinc-50">
        {JSON.stringify(result, null, 2)}
      </pre>
    );
  }

  return (
    <>
      <OfficialResultSummary result={result} />
      <ExternalResultSummary result={result} />
      <pre className="mt-8 overflow-auto rounded-md bg-zinc-950 p-4 text-sm text-zinc-50">
        {JSON.stringify(result, null, 2)}
      </pre>
    </>
  );
}

function progressLabel(action: SyncAction, elapsedSeconds: number) {
  if (action === "external") {
    if (elapsedSeconds < 8) return "Buscando fichas antiguas o faltantes...";
    if (elapsedSeconds < 35) return "Consultando Tavily para informacion adicional...";
    if (elapsedSeconds < 120) return "Guardando fichas encontradas...";
    return "La actualizacion sigue en curso.";
  }

  if (elapsedSeconds < 8) return "Conectando con el servidor...";
  if (elapsedSeconds < 25) return "Descargando listados oficiales...";
  if (elapsedSeconds < 70) return "Parseando PDFs y normalizando registros...";
  if (elapsedSeconds < 150) return "Guardando snapshots y detectando cambios...";
  return "La sincronizacion sigue en curso.";
}

export function SyncNowButton() {
  const [loading, setLoading] = useState<Record<SyncAction, boolean>>({
    official: false,
    external: false,
  });
  const [results, setResults] = useState<Record<SyncAction, unknown | null>>({
    official: null,
    external: null,
  });
  const [elapsedSeconds, setElapsedSeconds] = useState<Record<SyncAction, number>>({
    official: 0,
    external: 0,
  });

  useEffect(() => {
    if (!loading.official && !loading.external) return;

    const intervalId = window.setInterval(() => {
      setElapsedSeconds((current) => ({
        official: loading.official ? current.official + 1 : current.official,
        external: loading.external ? current.external + 1 : current.external,
      }));
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [loading]);

  async function runSync(action: SyncAction) {
    if (loading[action]) return;

    const endpoint =
      action === "official"
        ? "/api/admin/sync-official-pdfs"
        : "/api/admin/external-info/backfill";

    setLoading((current) => ({ ...current, [action]: true }));
    setElapsedSeconds((current) => ({ ...current, [action]: 0 }));
    setResults((current) => ({ ...current, [action]: null }));

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body:
          action === "external"
            ? JSON.stringify({ limit: 25, olderThanDays: 30 })
            : undefined,
      });
      const data = await readSyncResponse(response);
      setResults((current) => ({ ...current, [action]: data }));
    } catch (error) {
      setResults((current) => ({
        ...current,
        [action]: {
          ok: false,
          error: error instanceof Error ? error.message : "Error desconocido",
        },
      }));
    } finally {
      setLoading((current) => ({ ...current, [action]: false }));
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="rounded-md border border-zinc-200 bg-white p-5">
        <h2 className="text-lg font-semibold">Datos oficiales sin gluten</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-600">
          Actualiza alimentos y medicamentos desde los PDFs oficiales cargados
          como fuente principal.
        </p>
        <button
          type="button"
          onClick={() => runSync("official")}
          disabled={loading.official}
          className="mt-5 rounded-md bg-emerald-700 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
        >
          {loading.official
            ? "Sincronizando..."
            : "Sincronizar PDFs oficiales"}
        </button>
        {loading.official ? (
          <ProgressBox
            elapsedSeconds={elapsedSeconds.official}
            label={progressLabel("official", elapsedSeconds.official)}
          />
        ) : null}
        {results.official ? <SyncResult result={results.official} /> : null}
      </section>

      <section className="rounded-md border border-zinc-200 bg-white p-5">
        <h2 className="text-lg font-semibold">Informacion adicional</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-600">
          La informacion adicional se genera automaticamente la primera vez que
          un producto es consultado. Posteriormente queda almacenada en la base
          de datos.
        </p>
        <button
          type="button"
          onClick={() => runSync("external")}
          disabled={loading.external}
          className="mt-5 rounded-md bg-sky-700 px-5 py-3 text-sm font-semibold text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
        >
          {loading.external ? "Actualizando..." : "Actualizar fichas antiguas"}
        </button>
        {loading.external ? (
          <ProgressBox
            elapsedSeconds={elapsedSeconds.external}
            label={progressLabel("external", elapsedSeconds.external)}
          />
        ) : null}
        {results.external ? <SyncResult result={results.external} /> : null}
      </section>
    </div>
  );
}
