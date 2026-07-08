export type SyncFailureDetails = {
  step: string;
  url: string;
  status?: number;
  contentType?: string;
  bodyPreview?: string;
};

export class SyncFetchError extends Error {
  details: SyncFailureDetails;

  constructor(message: string, details: SyncFailureDetails) {
    super(message);
    this.name = "SyncFetchError";
    this.details = details;
  }
}

function previewText(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}

function previewBuffer(buffer: ArrayBuffer) {
  return previewText(Buffer.from(buffer).toString("utf8"));
}

function isHtmlResponse(contentType: string, bodyPreview: string) {
  return (
    contentType.toLowerCase().includes("html") ||
    /^<!doctype\s+html/i.test(bodyPreview) ||
    /^<html[\s>]/i.test(bodyPreview)
  );
}

function isExpectedPdfContentType(contentType: string) {
  const clean = contentType.toLowerCase();

  return (
    !clean ||
    clean.includes("application/pdf") ||
    clean.includes("application/octet-stream") ||
    clean.includes("binary/octet-stream")
  );
}

function throwPdfFetchError(message: string, details: SyncFailureDetails): never {
  console.error("[sync] failed", details);
  throw new SyncFetchError(message, details);
}

export async function fetchPdfBuffer(url: string): Promise<Buffer> {
  const step = "DOWNLOAD_PDF";
  const response = await fetch(url, {
    headers: {
      Accept: "application/pdf",
    },
    cache: "no-store",
  });
  const status = response.status;
  const contentType = response.headers.get("content-type") ?? "";

  if (!response.ok) {
    const bodyPreview = previewText(await response.text().catch(() => ""));
    throwPdfFetchError("No se pudo descargar el PDF oficial.", {
      step,
      url,
      status,
      contentType,
      bodyPreview,
    });
  }

  if (!isExpectedPdfContentType(contentType)) {
    const bodyPreview = previewText(await response.text().catch(() => ""));
    const message = isHtmlResponse(contentType, bodyPreview)
      ? "La fuente oficial devolvio HTML en vez del PDF esperado."
      : "La fuente oficial devolvio un tipo de archivo inesperado.";

    throwPdfFetchError(message, {
      step,
      url,
      status,
      contentType,
      bodyPreview,
    });
  }

  const arrayBuffer = await response.arrayBuffer();
  const bodyPreview = previewBuffer(arrayBuffer);

  if (isHtmlResponse(contentType, bodyPreview)) {
    throwPdfFetchError("La fuente oficial devolvio HTML en vez del PDF esperado.", {
      step,
      url,
      status,
      contentType,
      bodyPreview,
    });
  }

  return Buffer.from(arrayBuffer);
}
