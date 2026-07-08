"use client";

import { useEffect, useMemo, useState } from "react";

const VERCEL_SYNC_TIMEOUT_SECONDS = 300;

function previewText(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}

async function readSyncResponse(response: Response) {
  const url = response.url || "/api/admin/sync-now";
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

export function SyncNowButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!loading) return;

    const startedAt = Date.now();

    const intervalId = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [loading]);

  const progress = useMemo(() => {
    if (!loading) return 0;

    return Math.min(
      95,
      Math.round((elapsedSeconds / VERCEL_SYNC_TIMEOUT_SECONDS) * 100),
    );
  }, [elapsedSeconds, loading]);

  const progressLabel = useMemo(() => {
    if (elapsedSeconds < 8) return "Conectando con el servidor...";
    if (elapsedSeconds < 25) return "Descargando listados oficiales...";
    if (elapsedSeconds < 70) return "Parseando PDFs y normalizando registros...";
    if (elapsedSeconds < 150) return "Guardando snapshots y detectando cambios...";
    if (elapsedSeconds < VERCEL_SYNC_TIMEOUT_SECONDS) {
      return "La sincronizacion sigue en curso. Vercel puede tardar varios minutos.";
    }

    return "Tiempo limite estimado alcanzado. Esperando respuesta final de Vercel...";
  }, [elapsedSeconds]);

  async function runSync() {
    setLoading(true);
    setResult(null);
    setElapsedSeconds(0);

    try {
      const response = await fetch("/api/admin/sync-now", { method: "POST" });
      const data = await readSyncResponse(response);
      setResult(data);
    } catch (error) {
      setResult({
        ok: false,
        error: error instanceof Error ? error.message : "Error desconocido",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={runSync}
        disabled={loading}
        className="rounded-md bg-emerald-700 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
      >
        {loading ? "Sincronizando..." : "Sincronizar ahora"}
      </button>

      {loading ? (
        <div className="mt-5 rounded-md border border-emerald-100 bg-emerald-50 p-4">
          <div className="flex items-center justify-between gap-3 text-sm">
            <p className="font-medium text-emerald-950">{progressLabel}</p>
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
          <p className="mt-3 text-xs text-emerald-900">
            Esta barra mide el tiempo de espera del request. La respuesta final
            confirma si la sincronizacion termino o si Vercel corto la funcion
            por timeout.
          </p>
        </div>
      ) : null}

      {result ? (
        <pre className="mt-8 overflow-auto rounded-md bg-zinc-950 p-4 text-sm text-zinc-50">
          {JSON.stringify(result, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
