"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  areSearchTextsSimilar,
  hasUsefulOcrText,
  normalizeProductSearchText,
  tokenizeProductSearchText,
} from "@/lib/scan/normalize";
import {
  EXTENDED_SCAN_DURATION_MS,
  GLOBAL_CONFIDENCE_LOCK,
  MAX_SCAN_DURATION_MS,
  MIN_STABLE_READS,
  OCR_BUFFER_SIZE,
  OCR_INTERVAL_MS,
  RESULT_REPLACE_MARGIN,
  SEARCH_DEBOUNCE_MS,
  SOFT_LOCK_SCORE,
} from "@/lib/scan/config";
import {
  calculateCandidatePersistence,
  calculateGlobalConfidence,
  calculateHeroStability,
  smoothGlobalConfidence,
  type CandidateReading,
} from "@/lib/scan/confidence";
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
import type { VisualOcrResult } from "@/lib/scan/visual";

type SearchState = "idle" | "searching" | "done" | "no_match" | "error";
type ScannerState =
  | "IDLE"
  | "SCANNING"
  | "DETECTING_TEXT"
  | "CONFIRMING"
  | "SEARCHING"
  | "PROBABLE_MATCH"
  | "FOUND"
  | "NO_MATCH"
  | "ERROR";

type HeroReading = {
  rawText: string;
  normalizedText: string;
  timestamp: number;
};

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
    case "NO_MATCH":
      return "No encontramos coincidencias";
    case "ERROR":
      return "Hay un problema con el escaner";
    case "SCANNING":
      return "Buscando texto...";
    case "IDLE":
    default:
      return "Camara pendiente de activacion";
  }
}

function buildHeroReading(heroText: string): HeroReading | null {
  const normalizedText = normalizeProductSearchText(heroText);
  if (normalizedText.length < 3) return null;

  return {
    rawText: heroText,
    normalizedText,
    timestamp: Date.now(),
  };
}

function countSimilarHeroReadings(readings: HeroReading[], heroText: string) {
  return readings.filter((reading) =>
    areSearchTextsSimilar(reading.rawText, heroText),
  ).length;
}

function findPersistentDifferentHero(
  readings: HeroReading[],
  stableHeroText: string,
) {
  for (const reading of readings) {
    if (areSearchTextsSimilar(reading.rawText, stableHeroText)) continue;

    const similarCount = countSimilarHeroReadings(readings, reading.rawText);
    if (similarCount >= 3) return reading.rawText;
  }

  return "";
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
  const [heroText, setHeroText] = useState("");
  const [stableHeroText, setStableHeroText] = useState("");
  const [heroPersistenceCount, setHeroPersistenceCount] = useState(0);
  const [secondaryText, setSecondaryText] = useState("");
  const [results, setResults] = useState<ScannerResult[]>([]);
  const [lockedResult, setLockedResult] = useState<ScannerResult | null>(null);
  const [lockedText, setLockedText] = useState("");
  const [searchState, setSearchState] = useState<SearchState>("idle");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [remainingMs, setRemainingMs] = useState(MAX_SCAN_DURATION_MS);
  const [isExtendingSession, setIsExtendingSession] = useState(false);
  const [confidenceMetrics, setConfidenceMetrics] = useState({
    searchScore: 0,
    heroStability: 0,
    qualityScore: 0,
    candidatePersistence: 0,
    globalConfidence: 0,
  });
  const startingCameraRef = useRef(false);
  const ocrBufferRef = useRef<OcrReading[]>([]);
  const heroBufferRef = useRef<HeroReading[]>([]);
  const stableHeroTextRef = useRef("");
  const bestReadingRef = useRef<OcrReading | null>(null);
  const lastAcceptedTextRef = useRef("");
  const lastResultsTextRef = useRef("");
  const stableDominantTokensRef = useRef<string[]>([]);
  const stableSecondaryTokensRef = useRef<string[]>([]);
  const candidateBufferRef = useRef<CandidateReading[]>([]);
  const globalConfidenceRef = useRef(0);
  const requestIdRef = useRef(0);
  const sessionDeadlineRef = useRef(0);
  const sessionExtendedRef = useRef(false);
  const scanExpiredRef = useRef(false);
  const pendingSearchRef = useRef(false);
  const searchCacheRef = useRef(new Map<string, ScannerResult[]>());
  const scanningEnabled =
    isCameraReady &&
    !paused &&
    !lockedResult &&
    searchState !== "no_match";
  const showStartOverlay =
    cameraStatus === "idle" ||
    cameraStatus === "closed" ||
    cameraStatus === "error";

  const hasStrongEvidence = useCallback(() => {
    const currentBest = results[0];
    const latestQuality = bestReadingRef.current?.qualityScore ?? 0;
    const previousQuality =
      ocrBufferRef.current.at(-2)?.qualityScore ?? latestQuality;

    return Boolean(
      stableHeroTextRef.current ||
        (currentBest && currentBest.score >= SOFT_LOCK_SCORE) ||
        countSimilarReadings(
          ocrBufferRef.current,
          bestReadingRef.current ?? {
            rawText: "",
            normalizedText: "",
            usefulTokens: [],
            heroText: "",
            secondaryText: "",
            dominantTokens: [],
            secondaryTokens: [],
            timestamp: Date.now(),
            qualityScore: 0,
          },
        ) >= MIN_STABLE_READS ||
        latestQuality > previousQuality + 8,
    );
  }, [results]);

  const finalizeNoMatch = useCallback(() => {
    if (lockedResult) return;

    scanExpiredRef.current = true;
    setPaused(true);
    setSearchState("no_match");
  }, [lockedResult]);

  const startSession = useCallback(() => {
    const now = Date.now();
    sessionDeadlineRef.current = now + MAX_SCAN_DURATION_MS;
    sessionExtendedRef.current = false;
    scanExpiredRef.current = false;
    pendingSearchRef.current = false;
    requestIdRef.current += 1;
    setRemainingMs(MAX_SCAN_DURATION_MS);
    setIsExtendingSession(false);
    setSearchState("idle");
  }, []);

  const handleDetectedText = useCallback(
    (ocrResult: VisualOcrResult) => {
      if (lockedResult) return;
      if (scanExpiredRef.current || searchState === "no_match") return;
      const heroReading = buildHeroReading(ocrResult.heroText);
      let nextStableHeroText = stableHeroTextRef.current;

      if (heroReading) {
        const nextHeroBuffer = [...heroBufferRef.current, heroReading].slice(-4);
        heroBufferRef.current = nextHeroBuffer;

        const similarHeroCount = countSimilarHeroReadings(
          nextHeroBuffer,
          heroReading.rawText,
        );
        setHeroPersistenceCount(similarHeroCount);

        if (!nextStableHeroText && similarHeroCount >= 2) {
          nextStableHeroText = heroReading.rawText;
          stableHeroTextRef.current = nextStableHeroText;
          setStableHeroText(nextStableHeroText);
        } else if (nextStableHeroText) {
          const stableCount = countSimilarHeroReadings(
            nextHeroBuffer,
            nextStableHeroText,
          );
          setHeroPersistenceCount(stableCount);

          const replacementHero = findPersistentDifferentHero(
            nextHeroBuffer,
            nextStableHeroText,
          );
          if (replacementHero) {
            nextStableHeroText = replacementHero;
            stableHeroTextRef.current = replacementHero;
            setStableHeroText(replacementHero);
            setHeroPersistenceCount(
              countSimilarHeroReadings(nextHeroBuffer, replacementHero),
            );
          }
        }
      }

      const text = nextStableHeroText
        ? `${nextStableHeroText} ${ocrResult.secondaryText} ${ocrResult.rawText}`
        : ocrResult.prioritizedText || ocrResult.rawText;
      if (normalizeProductSearchText(text).length < 3) return;
      const dominantTokens = nextStableHeroText
        ? tokenizeProductSearchText(
            `${nextStableHeroText} ${ocrResult.heroText}`,
          )
        : ocrResult.dominantTokens;

      const reading = buildOcrReading(
        text,
        bestReadingRef.current?.rawText,
        Date.now(),
        {
          heroText: nextStableHeroText || ocrResult.heroText,
          secondaryText: ocrResult.secondaryText,
          dominantTokens,
          secondaryTokens: ocrResult.secondaryTokens,
        },
      );
      const nextBuffer = [...ocrBufferRef.current, reading].slice(
        -OCR_BUFFER_SIZE,
      );
      ocrBufferRef.current = nextBuffer;
      setDetectedText(text);
      setHeroText(ocrResult.heroText);
      setSecondaryText(ocrResult.secondaryText);

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
      stableDominantTokensRef.current = nextStableHeroText
        ? tokenizeProductSearchText(nextStableHeroText)
        : reading.dominantTokens;
      stableSecondaryTokensRef.current = reading.secondaryTokens;
      setBestStableText(reading.rawText);
    },
    [lockedResult, searchState],
  );

  const { status: ocrStatus, error: ocrError } = useOcrScanner({
    videoRef,
    enabled: scanningEnabled,
    intervalMs: OCR_INTERVAL_MS,
    onText: handleDetectedText,
  });

  const manualHref = useMemo(
    () =>
      manualSearchHref(
        stableHeroText || bestStableText || detectedText,
        productType,
      ),
    [bestStableText, detectedText, productType, stableHeroText],
  );
  const hasUsefulDetectedText = hasUsefulOcrText(detectedText);
  const scannerState: ScannerState = useMemo(() => {
    if (cameraError || ocrError || searchState === "error") return "ERROR";
    if (lockedResult) return "FOUND";
    if (searchState === "no_match") return "NO_MATCH";
    if (searchState === "searching") return "SEARCHING";
    if (results.length > 0) return "PROBABLE_MATCH";
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
      if (searchState === "no_match") return;
      pendingSearchRef.current = false;

      const nextBest = nextResults[0];
      const currentBest = results[0];

      if (!nextBest) {
        if (scanExpiredRef.current) {
          finalizeNoMatch();
          return;
        }

        if (currentBest && currentBest.score >= SOFT_LOCK_SCORE) {
          setSearchState("done");
          return;
        }

        setSearchState("no_match");
        return;
      }

      const nextCandidateBuffer = [
        ...candidateBufferRef.current,
        {
          productId: nextBest.id,
          score: nextBest.score,
          timestamp: Date.now(),
        },
      ].slice(-5);
      candidateBufferRef.current = nextCandidateBuffer;

      const heroStability = calculateHeroStability(
        heroBufferRef.current.map((reading) => reading.rawText),
        stableHeroTextRef.current,
      );
      const qualityScore = Math.min(
        100,
        Math.max(0, bestReadingRef.current?.qualityScore ?? 0),
      );
      const candidatePersistence = calculateCandidatePersistence(
        nextCandidateBuffer,
        nextBest.id,
      );
      const rawGlobalConfidence = calculateGlobalConfidence({
        searchScore: nextBest.score,
        heroStability,
        qualityScore,
        candidatePersistence,
      });
      const nextGlobalConfidence = smoothGlobalConfidence(
        globalConfidenceRef.current,
        rawGlobalConfidence,
      );
      globalConfidenceRef.current = nextGlobalConfidence;
      setConfidenceMetrics({
        searchScore: nextBest.score,
        heroStability,
        qualityScore,
        candidatePersistence,
        globalConfidence: nextGlobalConfidence,
      });

      if (nextGlobalConfidence >= GLOBAL_CONFIDENCE_LOCK) {
        setResults(nextResults);
        setLockedResult(nextBest);
        setLockedText(stableText);
        setPaused(true);
        setSearchState("done");
        scanExpiredRef.current = true;
        lastResultsTextRef.current = stableText;
        return;
      }

      if (scanExpiredRef.current) {
        finalizeNoMatch();
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
    [finalizeNoMatch, lockedResult, results, searchState],
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
    if (!isCameraReady) return;
    if (sessionDeadlineRef.current > 0) return;

    startSession();
  }, [isCameraReady, startSession]);

  useEffect(() => {
    if (!isCameraReady || lockedResult || searchState === "no_match") return;
    if (paused && !isExtendingSession) return;

    const intervalId = window.setInterval(() => {
      const now = Date.now();
      const deadline = sessionDeadlineRef.current;
      if (!deadline) return;

      const nextRemainingMs = Math.max(0, deadline - now);
      setRemainingMs(nextRemainingMs);

      if (nextRemainingMs > 0) return;

      if (!sessionExtendedRef.current && hasStrongEvidence()) {
        sessionExtendedRef.current = true;
        sessionDeadlineRef.current = now + EXTENDED_SCAN_DURATION_MS;
        setRemainingMs(EXTENDED_SCAN_DURATION_MS);
        setIsExtendingSession(true);
        setSearchState((current) =>
          current === "searching" ? current : "done",
        );
        return;
      }

      scanExpiredRef.current = true;
      setPaused(true);

      if (!pendingSearchRef.current) {
        finalizeNoMatch();
      }
    }, 250);

    return () => window.clearInterval(intervalId);
  }, [
    finalizeNoMatch,
    hasStrongEvidence,
    isCameraReady,
    isExtendingSession,
    lockedResult,
    paused,
    searchState,
  ]);

  useEffect(() => {
    if (lockedResult) return;
    if (searchState === "no_match") return;
    if (scanExpiredRef.current) return;

    const searchText = stableHeroText
      ? `${stableHeroText} ${bestStableText}`
      : bestStableText;
    const normalized = normalizeProductSearchText(searchText);
    if (normalized.length < 3 || !hasUsefulOcrText(searchText)) {
      return;
    }

    const controller = new AbortController();
    const dominantCachePart = stableDominantTokensRef.current.join(",");
    const secondaryCachePart = stableSecondaryTokensRef.current.join(",");
    const cacheKey = `${productType}:${normalized}:${dominantCachePart}:${secondaryCachePart}`;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    const timeoutId = window.setTimeout(async () => {
      if (scanExpiredRef.current) {
        if (!pendingSearchRef.current) finalizeNoMatch();
        return;
      }

      const cachedResults = searchCacheRef.current.get(cacheKey);
      if (cachedResults) {
        applySearchResults(cachedResults, searchText, requestId);
        return;
      }

      pendingSearchRef.current = true;
      setSearchState("searching");
      setSearchError(null);

      try {
        const response = await fetch("/api/scan/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: searchText,
            type: productType,
            dominantTokens: stableDominantTokensRef.current,
            secondaryTokens: stableSecondaryTokensRef.current,
          }),
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
        applySearchResults(nextResults, searchText, requestId);
      } catch (error) {
        pendingSearchRef.current = false;
        if (controller.signal.aborted) return;
        if (requestId !== requestIdRef.current) return;
        if (scanExpiredRef.current) {
          finalizeNoMatch();
          return;
        }

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
  }, [
    applySearchResults,
    bestStableText,
    finalizeNoMatch,
    lockedResult,
    productType,
    searchState,
    stableHeroText,
  ]);

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
    setHeroText("");
    setStableHeroText("");
    setHeroPersistenceCount(0);
    setSecondaryText("");
    setDetectedText("");
    setSearchState("idle");
    lastAcceptedTextRef.current = "";
    lastResultsTextRef.current = "";
    stableHeroTextRef.current = "";
    heroBufferRef.current = [];
    stableDominantTokensRef.current = [];
    stableSecondaryTokensRef.current = [];
    candidateBufferRef.current = [];
    globalConfidenceRef.current = 0;
    bestReadingRef.current = null;
    ocrBufferRef.current = [];
    searchCacheRef.current.clear();
    setConfidenceMetrics({
      searchScore: 0,
      heroStability: 0,
      qualityScore: 0,
      candidatePersistence: 0,
      globalConfidence: 0,
    });
    startSession();
    if (!isCameraReady) void openCameraFromUserAction();
  }

  function continueScanning() {
    retry();
  }

  function closeCamera() {
    scannerUiLog("closeCamera:called");
    setPaused(true);
    stopCamera();
  }

  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const progressTotalMs = isExtendingSession
    ? EXTENDED_SCAN_DURATION_MS
    : MAX_SCAN_DURATION_MS;
  const progressPercent = Math.max(
    0,
    Math.min(100, 100 - (remainingMs / progressTotalMs) * 100),
  );

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
            {!lockedResult && searchState !== "no_match" ? (
              <div className="mb-3">
                <div className="flex items-center justify-between text-xs text-white/70">
                  <span>
                    {isExtendingSession
                      ? "Verificando coincidencia..."
                      : "Buscando producto..."}
                  </span>
                  <span>{remainingSeconds} s restantes</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/20">
                  <div
                    className="h-full rounded-full bg-emerald-400 transition-all"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            ) : null}
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

        {process.env.NODE_ENV === "development" &&
        (heroText || stableHeroText || secondaryText) ? (
          <div className="mt-3 rounded-md border border-zinc-200 bg-white p-3 text-xs text-zinc-600">
            {heroText ? (
              <p>
                <span className="font-semibold">heroText actual:</span>{" "}
                {heroText}
              </p>
            ) : null}
            {stableHeroText ? (
              <p className="mt-1">
                <span className="font-semibold">stableHeroText:</span>{" "}
                {stableHeroText}
              </p>
            ) : null}
            <p className="mt-1">
              <span className="font-semibold">persistencia:</span>{" "}
              {heroPersistenceCount}
            </p>
            {secondaryText ? (
              <p className="mt-1">
                <span className="font-semibold">Texto secundario:</span>{" "}
                {secondaryText}
              </p>
            ) : null}
            <div className="mt-2 border-t border-zinc-200 pt-2">
              <p>
                <span className="font-semibold">Search Score:</span>{" "}
                {confidenceMetrics.searchScore}
              </p>
              <p>
                <span className="font-semibold">Hero Stability:</span>{" "}
                {confidenceMetrics.heroStability}
              </p>
              <p>
                <span className="font-semibold">OCR Quality:</span>{" "}
                {confidenceMetrics.qualityScore}
              </p>
              <p>
                <span className="font-semibold">Candidate Persistence:</span>{" "}
                {confidenceMetrics.candidatePersistence}
              </p>
              <p>
                <span className="font-semibold">Global Confidence:</span>{" "}
                {confidenceMetrics.globalConfidence}
              </p>
            </div>
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
