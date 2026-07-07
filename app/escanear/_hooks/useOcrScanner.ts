"use client";

import { useEffect, useRef, useState } from "react";
import { compactOcrText } from "@/lib/scan/normalize";

type OcrStatus = "idle" | "loading" | "scanning" | "paused" | "error";

type UseOcrScannerOptions = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  enabled: boolean;
  intervalMs?: number;
  onText: (text: string) => void;
};

type TesseractWorker = Awaited<
  ReturnType<typeof import("tesseract.js").createWorker>
>;

export function useOcrScanner({
  videoRef,
  enabled,
  intervalMs = 1400,
  onText,
}: UseOcrScannerOptions) {
  const workerRef = useRef<TesseractWorker | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const processingRef = useRef(false);
  const [status, setStatus] = useState<OcrStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;
    let intervalId: number | null = null;

    async function getWorker() {
      if (workerRef.current) return workerRef.current;

      setStatus("loading");

      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker(["spa", "eng"], 1, {
        workerPath: "/tesseract/worker.min.js",
        corePath: "/tesseract/tesseract-core.wasm.js",
        langPath: "/tesseract/lang",
        gzip: true,
        logger: () => undefined,
      });

      await worker.setParameters({
        preserve_interword_spaces: "1",
        tessedit_pageseg_mode: "6" as never,
      });

      workerRef.current = worker;
      return worker;
    }

    function captureFrame() {
      const video = videoRef.current;
      if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        return null;
      }

      const sourceWidth = video.videoWidth;
      const sourceHeight = video.videoHeight;
      if (!sourceWidth || !sourceHeight) return null;

      const cropWidth = Math.round(sourceWidth * 0.86);
      const cropHeight = Math.round(sourceHeight * 0.48);
      const cropX = Math.round((sourceWidth - cropWidth) / 2);
      const cropY = Math.round(sourceHeight * 0.24);
      const maxWidth = 720;
      const scale = Math.min(1, maxWidth / cropWidth);
      const width = Math.round(cropWidth * scale);
      const height = Math.round(cropHeight * scale);
      const canvas = canvasRef.current ?? document.createElement("canvas");
      canvasRef.current = canvas;
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return null;

      context.drawImage(
        video,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
        0,
        0,
        width,
        height,
      );

      const imageData = context.getImageData(0, 0, width, height);
      const data = imageData.data;
      const contrast = 1.22;
      const midpoint = 128;

      for (let index = 0; index < data.length; index += 4) {
        const gray =
          data[index] * 0.299 +
          data[index + 1] * 0.587 +
          data[index + 2] * 0.114;
        const contrasted = Math.max(
          0,
          Math.min(255, (gray - midpoint) * contrast + midpoint),
        );

        data[index] = contrasted;
        data[index + 1] = contrasted;
        data[index + 2] = contrasted;
      }

      context.putImageData(imageData, 0, 0);
      return canvas;
    }

    async function scanFrame() {
      if (processingRef.current || cancelled) return;

      const frame = captureFrame();
      if (!frame) return;

      processingRef.current = true;
      setStatus("scanning");

      try {
        const worker = await getWorker();
        const {
          data: { text },
        } = await worker.recognize(frame);

        if (!cancelled) {
          onText(compactOcrText(text));
        }
      } catch (ocrError) {
        if (!cancelled) {
          setStatus("error");
          setError(
            ocrError instanceof Error
              ? ocrError.message
              : "No se pudo ejecutar OCR en este navegador.",
          );
        }
      } finally {
        processingRef.current = false;
      }
    }

    void getWorker()
      .then(() => {
        if (cancelled) return;
        void scanFrame();
        intervalId = window.setInterval(scanFrame, intervalMs);
      })
      .catch((workerError) => {
        if (!cancelled) {
          setStatus("error");
          setError(
            workerError instanceof Error
              ? workerError.message
              : "No se pudo cargar el motor OCR.",
          );
        }
      });

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [enabled, intervalMs, onText, videoRef]);

  useEffect(
    () => () => {
      void workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  return {
    status: !enabled && status !== "idle" ? "paused" : status,
    error,
  };
}
