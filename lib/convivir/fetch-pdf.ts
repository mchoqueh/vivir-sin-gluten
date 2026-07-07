export async function fetchPdfBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/pdf",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`No se pudo descargar el PDF (${response.status})`);
  }

  const contentType = response.headers.get("content-type");
  if (contentType && !contentType.toLowerCase().includes("pdf")) {
    throw new Error(`La respuesta no parece ser PDF: ${contentType}`);
  }

  return Buffer.from(await response.arrayBuffer());
}
