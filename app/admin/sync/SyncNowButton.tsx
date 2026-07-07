"use client";

import { useState } from "react";

export function SyncNowButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<unknown>(null);

  async function runSync() {
    setLoading(true);
    setResult(null);

    try {
      const response = await fetch("/api/admin/sync-now", { method: "POST" });
      const data = await response.json();
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
