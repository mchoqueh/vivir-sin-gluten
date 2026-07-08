"use client";

import { useState } from "react";

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

  async function runSync() {
    setLoading(true);
    setResult(null);

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
      {result ? (
        <pre className="mt-8 overflow-auto rounded-md bg-zinc-950 p-4 text-sm text-zinc-50">
          {JSON.stringify(result, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
