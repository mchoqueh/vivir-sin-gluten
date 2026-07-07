"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type CameraStatus = "idle" | "starting" | "ready" | "closed" | "error";

function scannerLog(message: string, data?: unknown) {
  if (process.env.NODE_ENV !== "development") return;
  console.log(`[VSG scanner] ${message}`, data ?? "");
}

function waitForVideoFrame(video: HTMLVideoElement, timeoutMs = 2500) {
  scannerLog("waitForVideoFrame:start", {
    readyState: video.readyState,
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
  });

  if (video.videoWidth > 0 && video.videoHeight > 0) {
    scannerLog("waitForVideoFrame:already-ready", {
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
    });
    return Promise.resolve(true);
  }

  return new Promise<boolean>((resolve) => {
    const startedAt = Date.now();

    function checkFrame() {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        scannerLog("waitForVideoFrame:ready", {
          readyState: video.readyState,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
        });
        resolve(true);
        return;
      }

      if (Date.now() - startedAt > timeoutMs) {
        scannerLog("waitForVideoFrame:timeout", {
          readyState: video.readyState,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
        });
        resolve(false);
        return;
      }

      window.requestAnimationFrame(checkFrame);
    }

    window.requestAnimationFrame(checkFrame);
  });
}

async function requestCameraStream() {
  const attempts: MediaStreamConstraints[] = [
    {
      video: {
        facingMode: { exact: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    },
    {
      video: {
        facingMode: "environment",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    },
    {
      video: true,
      audio: false,
    },
  ];

  let lastError: unknown;

  for (const [index, constraints] of attempts.entries()) {
    try {
      scannerLog("getUserMedia:attempt", { index, constraints });
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      scannerLog("getUserMedia:attempt-failed", {
        index,
        name: error instanceof DOMException ? error.name : undefined,
        message: error instanceof Error ? error.message : String(error),
      });
      lastError = error;
    }
  }

  scannerLog("getUserMedia:all-attempts-failed", lastError);
  throw lastError;
}

export function useCameraScanner() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    scannerLog("stopCamera", {
      hasStream: Boolean(streamRef.current),
      tracks: streamRef.current?.getTracks().map((track) => ({
        kind: track.kind,
        label: track.label,
        readyState: track.readyState,
        enabled: track.enabled,
      })),
    });
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }

    setStatus("closed");
  }, []);

  const startCamera = useCallback(async () => {
    scannerLog("startCamera:called", {
      isSecureContext: window.isSecureContext,
      hasMediaDevices: Boolean(navigator.mediaDevices),
      hasGetUserMedia: Boolean(navigator.mediaDevices?.getUserMedia),
      userAgent: navigator.userAgent,
      href: window.location.href,
    });

    if (!window.isSecureContext) {
      scannerLog("startCamera:blocked-insecure-context");
      setError(
        "La camara del navegador requiere HTTPS o localhost para funcionar.",
      );
      setStatus("error");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      scannerLog("startCamera:blocked-no-getUserMedia");
      setError("Este navegador no permite abrir la camara desde la web.");
      setStatus("error");
      return;
    }

    setError(null);
    setStatus("starting");

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    try {
      const stream = await requestCameraStream();
      scannerLog("startCamera:stream-received", {
        id: stream.id,
        tracks: stream.getTracks().map((track) => ({
          kind: track.kind,
          label: track.label,
          readyState: track.readyState,
          enabled: track.enabled,
          settings:
            "getSettings" in track ? track.getSettings() : "no settings api",
        })),
      });

      const video = videoRef.current;
      if (!video) {
        scannerLog("startCamera:no-video-ref");
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("No se encontro el reproductor de camara.");
      }

      streamRef.current = stream;
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      video.setAttribute("muted", "true");
      video.setAttribute("playsinline", "true");
      video.setAttribute("webkit-playsinline", "true");
      video.srcObject = stream;
      scannerLog("startCamera:stream-assigned-to-video", {
        readyState: video.readyState,
        paused: video.paused,
        muted: video.muted,
        playsInline: video.playsInline,
      });

      try {
        scannerLog("video.play:start");
        await video.play();
        scannerLog("video.play:resolved", {
          readyState: video.readyState,
          paused: video.paused,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
        });
      } catch (playError) {
        scannerLog("video.play:failed", {
          name: playError instanceof DOMException ? playError.name : undefined,
          message:
            playError instanceof Error ? playError.message : String(playError),
        });
        if (playError instanceof DOMException && playError.name === "AbortError") {
          await new Promise((resolve) => window.setTimeout(resolve, 250));
          scannerLog("video.play:retry-after-abort");
          await video.play();
        } else {
          throw playError;
        }
      }

      const hasFrame = await waitForVideoFrame(video);
      scannerLog("startCamera:frame-result", {
        hasFrame,
        readyState: video.readyState,
        paused: video.paused,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
      });

      setStatus("ready");
      scannerLog("startCamera:ready");
    } catch (cameraError) {
      scannerLog("startCamera:error", {
        name: cameraError instanceof DOMException ? cameraError.name : undefined,
        message:
          cameraError instanceof Error
            ? cameraError.message
            : String(cameraError),
      });
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;

      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
      }

      setStatus("error");
      setError(
        cameraError instanceof DOMException
          ? cameraError.name === "NotAllowedError"
            ? "Permiso de camara denegado. Habilitalo en Ajustes de Safari o del sitio."
            : `Safari no pudo abrir la camara (${cameraError.name}). Prueba cerrar la pestana y volver a abrir.`
          : "No se pudo abrir la camara en este dispositivo. Prueba cerrar la pestana y volver a abrir.",
      );
    }
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  return {
    videoRef,
    status,
    error,
    startCamera,
    stopCamera,
    isCameraReady: status === "ready",
  };
}
