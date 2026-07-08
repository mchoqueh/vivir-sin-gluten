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
  fetchedAt: string | null;
};

type DebugInfo = {
  provider?: string;
  confidence?: number;
  matchReason?: string;
  fetchedAt?: string;
  rawPayload?: unknown;
  error?: string;
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
        Buscando informacion adicional...
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
    ["Principio activo", externalInfo.activeIngredient],
    ["Componentes", externalInfo.components],
    ["Forma farmaceutica", externalInfo.pharmaceuticalForm],
    ["Concentracion", externalInfo.concentration],
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
        Esta informacion es referencial y no reemplaza la indicacion de un
        profesional de salud.
      </p>
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
        setMessage("Informacion adicional aun no disponible.");
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
        {message ?? "Informacion adicional aun no disponible."}
      </p>
      {debug && debugInfo ? (
        <pre className="mt-4 overflow-auto rounded-md bg-zinc-950 p-4 text-xs text-zinc-50">
          {JSON.stringify(debugInfo, null, 2)}
        </pre>
      ) : null}
    </section>
  );
}
