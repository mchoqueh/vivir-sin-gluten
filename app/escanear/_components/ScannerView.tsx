"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  areSearchTextsSimilar,
  hasUsefulOcrText,
  normalizeProductSearchText,
} from "@/lib/scan/normalize";
import {
  HIGH_CONFIDENCE_SCORE,
  MIN_STABLE_READS,
  OCR_BUFFER_SIZE,
  OCR_INTERVAL_MS,
  RESULT_REPLACE_MARGIN,
  SEARCH_DEBOUNCE_MS,
  SOFT_LOCK_SCORE,
} from "@/lib/scan/config";
import {
  buildOcrReading,
  countSimilarReadings,
  isReadingBetter,
  shouldSearchReading,
  type OcrReading,
} from "@/lib/scan/stability";
import { ProductTypeFilter, type ScannerProductType } from "./ProductTypeFilter";
import { ScannerResults, type ScannerResult } from "./ScannerResults";
import { useCameraScanner } from "../_hooks/useCameraScanner";
import { useOcrScanner } from "../_hooks/useOcrScanner";

type SearchState = "idle" | "searching" | "done" | "no_results" | "error";
type ScannerState =
  | "IDLE"
  | "SCANNING"
  | "DETECTING_TEXT"
  | "CONFIRMING"
  | "SEARCHING"
  | "PROBABLE_MATCH"
  | "FOUND"
  | "NO_RESULTS"
  | "ERROR";

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
  if (process.env.NODE_ENV !== "development") return;
  console.log(`[VSG scanner UI] ${message}`, data ?? "");
}

function scannerStateLabel(state: ScannerState) {
  switch (state) {
    case "FOUND":
      return "Producto encontrado";
    case "PROBABLE_MATCH":
      return "Coincidencia probable";
    case "SEARCHING":
      return "Buscando coincidencias...";
    case "CONFIRMING":
      return "Confirmando lectura...";
    case "DETECTING_TEXT":
      return "Detectando texto util...";
    case "NO_RESULTS":
      return "Sin coincidencias claras";
    case "ERROR":
      return "Hay un problema con el escaner";
    case "SCANNING":
      return "Buscando texto...";
    case "IDLE":
    default:
      return "Camara pendiente de activacion";
  }
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
  const [bestStableText, setBestStableText] = useState("");
  const [results, setResults] = useState<ScannerResult[]>([]);
  const [lockedResult, setLockedResult] = useState<ScannerResult | null>(null);
  const [lockedText, setLockedText] = useState("");
  const [searchState, setSearchState] = useState<SearchState>("idle");
  const [searchError, setSearchError] = useState<string | null>(null);
  const startingCameraRef = useRef(false);
  const ocrBufferRef = useRef<OcrReading[]>([]);
  const bestReadingRef = useRef<OcrReading | null>(null);
  const lastAcceptedTextRef = useRef("");
  const lastResultsTextRef = useRef("");
  const requestIdRef = useRef(0);
  const searchCacheRef = useRef(new Map<string, ScannerResult[]>());
  const scanningEnabled = isCameraReady && !paused;
  const showStartOverlay =
    cameraStatus === "idle" ||
    cameraStatus === "closed" ||
    cameraStatus === "error";

  const handleDetectedText = useCallback(
    (text: string) => {
      if (lockedResult) return;
      if (normalizeProductSearchText(text).length < 3) return;

      const reading = buildOcrReading(text, bestReadingRef.current?.rawText);
      const nextBuffer = [...ocrBufferRef.current, reading].slice(
        -OCR_BUFFER_SIZE,
      );
      ocrBufferRef.current = nextBuffer;
      setDetectedText(text);

      const similarReadCount = countSimilarReadings(nextBuffer, reading);
      const enoughEvidence =
        similarReadCount >= MIN_STABLE_READS ||
        shouldSearchReading(reading, similarReadCount);

      if (!enoughEvidence) {
        if (!hasUsefulOcrText(text)) setSearchState("idle");
        return;
      }

      if (!isReadingBetter(bestReadingRef.current, reading)) {
        return;
      }

      if (areSearchTextsSimilar(lastAcceptedTextRef.current, reading.rawText)) {
        bestReadingRef.current = reading;
        return;
      }

      bestReadingRef.current = reading;
      lastAcceptedTextRef.current = reading.rawText;
      setBestStableText(reading.rawText);
    },
    [lockedResult],
  );

  const { status: ocrStatus, error: ocrError } = useOcrScanner({
    videoRef,
    enabled: scanningEnabled,
    intervalMs: OCR_INTERVAL_MS,
    onText: handleDetectedText,
  });

  const manualHref = useMemo(
    () => manualSearchHref(bestStableText || detectedText, productType),
    [bestStableText, detectedText, productType],
  );
  const hasUsefulDetectedText = hasUsefulOcrText(detectedText);
  const scannerState: ScannerState = useMemo(() => {
    if (cameraError || ocrError || searchState === "error") return "ERROR";
    if (lockedResult) return "FOUND";
    if (searchState === "searching") return "SEARCHING";
    if (results.length > 0) return "PROBABLE_MATCH";
    if (searchState === "no_results") return "NO_RESULTS";
    if (detectedText && !hasUsefulDetectedText) return "DETECTING_TEXT";
    if (bestStableText) return "CONFIRMING";
    if (scanningEnabled) return "SCANNING";
    return "IDLE";
  }, [
    bestStableText,
    cameraError,
    detectedText,
    hasUsefulDetectedText,
    lockedResult,
    ocrError,
    results.length,
    scanningEnabled,
    searchState,
  ]);

  const applySearchResults = useCallback(
    (nextResults: ScannerResult[], stableText: string, requestId: number) => {
      if (requestId !== requestIdRef.current) return;
      if (lockedResult) return;

      const nextBest = nextResults[0];
      const currentBest = results[0];

      if (!nextBest) {
        if (currentBest && currentBest.score >= SOFT_LOCK_SCORE) {
          setSearchState("done");
          return;
        }

        setSearchState("no_results");
        return;
      }

      if (nextBest.score >= HIGH_CONFIDENCE_SCORE) {
        setResults(nextResults);
        setLockedResult(nextBest);
        setLockedText(stableText);
        setPaused(true);
        setSearchState("done");
        lastResultsTextRef.current = stableText;
        return;
      }

      const textChangedCompletely =
        lastResultsTextRef.current &&
        !areSearchTextsSimilar(lastResultsTextRef.current, stableText);
      const shouldReplace =
        !currentBest ||
        nextBest.score >= currentBest.score + RESULT_REPLACE_MARGIN ||
        (textChangedCompletely && nextBest.score >= SOFT_LOCK_SCORE);

      if (shouldReplace) {
        setResults(nextResults);
        lastResultsTextRef.current = stableText;
      }

      setSearchState("done");
    },
    [lockedResult, results],
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
    if (lockedResult) return;

    const normalized = normalizeProductSearchText(bestStableText);
    if (normalized.length < 3 || !hasUsefulOcrText(bestStableText)) {
      return;
    }

    const controller = new AbortController();
    const cacheKey = `${productType}:${normalized}`;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    const timeoutId = window.setTimeout(async () => {
      const cachedResults = searchCacheRef.current.get(cacheKey);
      if (cachedResults) {
        applySearchResults(cachedResults, bestStableText, requestId);
        return;
      }

      setSearchState("searching");
      setSearchError(null);

      try {
        const response = await fetch("/api/scan/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: bestStableText, type: productType }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("No se pudo buscar coincidencias.");
        }

        const payload = (await response.json()) as {
          results?: ScannerResult[];
        };

        const nextResults = payload.results ?? [];
        searchCacheRef.current.set(cacheKey, nextResults);
        applySearchResults(nextResults, bestStableText, requestId);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (requestId !== requestIdRef.current) return;

        setSearchState("error");
        setSearchError(
          error instanceof Error
            ? error.message
            : "No se pudo buscar coincidencias.",
        );
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [applySearchResults, bestStableText, lockedResult, productType]);

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
    setLockedResult(null);
    setLockedText("");
    setBestStableText("");
    setDetectedText("");
    setSearchState("idle");
    lastAcceptedTextRef.current = "";
    lastResultsTextRef.current = "";
    bestReadingRef.current = null;
    ocrBufferRef.current = [];
    if (!isCameraReady) void openCameraFromUserAction();
  }

  function continueScanning() {
    setPaused(false);
    setLockedResult(null);
    setLockedText("");
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
                    ? scannerStateLabel(scannerState)
                    : paused
                      ? "Escaneo pausado"
                      : isCameraReady
                        ? scannerStateLabel(scannerState)
                        : scannerStateLabel(scannerState)}
            </p>
          </div>

          <div className="absolute inset-x-3 bottom-3 rounded-xl bg-black/70 p-3 text-white">
            <p className="text-xs uppercase text-white/60">Texto detectado</p>
            <p className="mt-1 line-clamp-3 text-sm">
              {bestStableText || detectedText || "Aun no hay texto suficiente."}
            </p>
            <p className="mt-2 text-xs text-white/70">
              {lockedResult
                ? `Lectura bloqueada: ${lockedText}`
                : detectedText && !hasUsefulDetectedText
                  ? "Detectando texto util..."
                : searchState === "searching"
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
          detectedText={bestStableText || detectedText}
          productType={productType}
          scannerState={scannerState}
          lockedResult={lockedResult}
          lockedText={lockedText}
          onContinueScanning={continueScanning}
          onSearchAgain={retry}
        />
      </div>
    </div>
  );
}
