"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeProductSearchText } from "@/lib/scan/normalize";
import { ProductTypeFilter, type ScannerProductType } from "./ProductTypeFilter";
import { ScannerResults, type ScannerResult } from "./ScannerResults";
import { useCameraScanner } from "../_hooks/useCameraScanner";
import { useOcrScanner } from "../_hooks/useOcrScanner";

type SearchState = "idle" | "searching" | "done" | "error";

function manualSearchHref(text: string, productType: ScannerProductType) {
  const params = new URLSearchParams();
  if (text.trim()) params.set("q", text.trim());
  if (productType !== "ALL") params.set("type", productType);

  const query = params.toString();
  return query ? `/buscar?${query}` : "/buscar";
}

function isIOSWebKit() {
  const userAgent = window.navigator.userAgent;
  const platform = window.navigator.platform;
  const isAppleTouchDevice =
    /iPad|iPhone|iPod/.test(userAgent) ||
    (platform === "MacIntel" && window.navigator.maxTouchPoints > 1);

  return isAppleTouchDevice && /WebKit/i.test(userAgent);
}

function scannerUiLog(message: string, data?: unknown) {
  console.log(`[VSG scanner UI] ${message}`, data ?? "");
}

export function ScannerView() {
  const {
    videoRef,
    status: cameraStatus,
    error: cameraError,
    startCamera,
    stopCamera,
    isCameraReady,
  } = useCameraScanner();
  const [productType, setProductType] = useState<ScannerProductType>("ALL");
  const [paused, setPaused] = useState(false);
  const [detectedText, setDetectedText] = useState("");
  const [results, setResults] = useState<ScannerResult[]>([]);
  const [searchState, setSearchState] = useState<SearchState>("idle");
  const [searchError, setSearchError] = useState<string | null>(null);
  const startingCameraRef = useRef(false);
  const scanningEnabled = isCameraReady && !paused;
  const showStartOverlay =
    cameraStatus === "idle" ||
    cameraStatus === "closed" ||
    cameraStatus === "error";

  const handleDetectedText = useCallback((text: string) => {
    if (normalizeProductSearchText(text).length < 3) return;
    setDetectedText(text);
  }, []);

  const { status: ocrStatus, error: ocrError } = useOcrScanner({
    videoRef,
    enabled: scanningEnabled,
    intervalMs: 1400,
    onText: handleDetectedText,
  });

  const manualHref = useMemo(
    () => manualSearchHref(detectedText, productType),
    [detectedText, productType],
  );

  useEffect(() => {
    scannerUiLog("mount", {
      isIOSWebKit: isIOSWebKit(),
      userAgent: window.navigator.userAgent,
      href: window.location.href,
    });

    if (isIOSWebKit()) {
      scannerUiLog("auto-start skipped for iOS WebKit");
      return;
    }

    scannerUiLog("auto-start camera");
    void startCamera();
  }, [startCamera]);

  useEffect(() => {
    const normalized = normalizeProductSearchText(detectedText);
    if (normalized.length < 3) {
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setSearchState("searching");
      setSearchError(null);

      try {
        const response = await fetch("/api/scan/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: detectedText, type: productType }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("No se pudo buscar coincidencias.");
        }

        const payload = (await response.json()) as {
          results?: ScannerResult[];
        };

        setResults(payload.results ?? []);
        setSearchState("done");
      } catch (error) {
        if (controller.signal.aborted) return;

        setSearchState("error");
        setSearchError(
          error instanceof Error
            ? error.message
            : "No se pudo buscar coincidencias.",
        );
      }
    }, 350);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [detectedText, productType]);

  async function openCameraFromUserAction() {
    scannerUiLog("openCameraFromUserAction:called", {
      alreadyStarting: startingCameraRef.current,
      cameraStatus,
      isCameraReady,
    });

    if (startingCameraRef.current) return;

    startingCameraRef.current = true;
    setPaused(false);

    try {
      scannerUiLog("openCameraFromUserAction:startCamera");
      await startCamera();
      scannerUiLog("openCameraFromUserAction:startCamera-resolved");
    } finally {
      startingCameraRef.current = false;
      scannerUiLog("openCameraFromUserAction:finished");
    }
  }

  function retry() {
    scannerUiLog("retry:called", { cameraStatus, isCameraReady });
    setPaused(false);
    setResults([]);
    setDetectedText("");
    if (!isCameraReady) void openCameraFromUserAction();
  }

  function closeCamera() {
    scannerUiLog("closeCamera:called");
    setPaused(true);
    stopCamera();
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col bg-stone-50">
      <header className="px-4 pb-3 pt-5">
        <Link href="/" className="text-sm font-medium text-emerald-700">
          Volver al inicio
        </Link>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">
          Escanear producto
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          Apunta al frente del producto. El OCR se ejecuta localmente en tu
          navegador cada pocos segundos.
        </p>
      </header>

      <div className="px-4">
        <ProductTypeFilter value={productType} onChange={setProductType} />
      </div>

      <section className="mt-4 px-4">
        <div className="relative aspect-[3/4] max-h-[62vh] overflow-hidden rounded-2xl border border-zinc-900 bg-zinc-950 shadow-sm sm:aspect-video">
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            controls={false}
            className="pointer-events-none h-full w-full object-cover"
          />

          <div className="pointer-events-none absolute inset-6 rounded-xl border-2 border-white/70" />

          {showStartOverlay ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 p-5 text-center text-white">
              <div className="max-w-xs">
                <p className="text-lg font-semibold">Activar camara</p>
                <p className="mt-2 text-sm text-white/80">
                  En iPhone y iPad Safari necesita que abras la camara con un toque.
                </p>
                {cameraError ? (
                  <p className="mt-3 rounded-md bg-amber-400/20 p-2 text-xs text-amber-100">
                    {cameraError}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    scannerUiLog("activate-button:click");
                    void openCameraFromUserAction();
                  }}
                  onPointerUp={() => {
                    scannerUiLog("activate-button:pointerup");
                    void openCameraFromUserAction();
                  }}
                  onTouchEnd={() => {
                    scannerUiLog("activate-button:touchend");
                    void openCameraFromUserAction();
                  }}
                  className="mt-5 w-full touch-manipulation rounded-md bg-emerald-600 px-4 py-3 text-sm font-semibold text-white"
                >
                  Activar camara
                </button>
              </div>
            </div>
          ) : null}

          <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent p-4 text-white">
            <p className="text-lg font-semibold">Apunta al frente del producto</p>
            <p className="mt-1 text-sm text-white/80">
              {cameraStatus === "starting"
                ? "Solicitando permiso de camara..."
                : ocrStatus === "loading"
                  ? "Cargando OCR local..."
                  : ocrStatus === "scanning"
                    ? "Buscando texto..."
                    : paused
                      ? "Escaneo pausado"
                      : isCameraReady
                        ? "Buscando texto..."
                        : "Camara pendiente de activacion"}
            </p>
          </div>

          <div className="absolute inset-x-3 bottom-3 rounded-xl bg-black/70 p-3 text-white">
            <p className="text-xs uppercase text-white/60">Texto detectado</p>
            <p className="mt-1 line-clamp-3 text-sm">
              {detectedText || "Aun no hay texto suficiente."}
            </p>
            <p className="mt-2 text-xs text-white/70">
              {searchState === "searching"
                ? "Buscando coincidencias..."
                : searchState === "error"
                  ? searchError
                  : "Buscando coincidencias en la base oficial."}
            </p>
          </div>
        </div>

        {cameraError || ocrError ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {cameraError ?? ocrError}
          </div>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setPaused((value) => !value)}
            disabled={!isCameraReady}
            className="rounded-md border border-zinc-300 bg-white px-4 py-3 text-sm font-semibold text-zinc-900 disabled:cursor-not-allowed disabled:text-zinc-400"
          >
            {paused ? "Reintentar" : "Pausar"}
          </button>
          <button
            type="button"
            onClick={closeCamera}
            className="rounded-md border border-zinc-300 bg-white px-4 py-3 text-sm font-semibold text-zinc-900"
          >
            Cerrar camara
          </button>
          <button
            type="button"
            onClick={retry}
            onPointerUp={retry}
            onTouchEnd={retry}
            className="touch-manipulation rounded-md bg-emerald-700 px-4 py-3 text-sm font-semibold text-white"
          >
            {cameraStatus === "starting" ? "Abriendo..." : "Abrir camara"}
          </button>
          <Link
            href={manualHref}
            className="rounded-md border border-zinc-300 bg-white px-4 py-3 text-center text-sm font-semibold text-zinc-900"
          >
            Buscar manualmente
          </Link>
        </div>
      </section>

      <div className="mt-5 flex-1">
        <ScannerResults
          results={results}
          detectedText={detectedText}
          productType={productType}
        />
      </div>
    </div>
  );
}
