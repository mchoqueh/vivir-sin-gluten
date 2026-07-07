import {
  getDocument,
  GlobalWorkerOptions,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import "pdfjs-dist/legacy/build/pdf.worker.mjs";

export type ConvivirCertificationStatus =
  | "CERTIFIED_GLUTEN_FREE"
  | "NOT_RENEWED_ANALYSIS"
  | "UNKNOWN";

export type ParsedConvivirRow = {
  name: string;
  brand?: string | null;
  company?: string | null;
  category?: string | null;
  subcategory?: string | null;
  certificationStatus?: ConvivirCertificationStatus;
  raw: string;
};

type PdfTextItem = {
  str: string;
  dir: string;
  transform: unknown[];
  width: number;
  height: number;
  fontName: string;
  hasEOL: boolean;
};

type DetectedPdfLine = {
  pageNumber: number;
  y: number;
  firstColumn: string;
  product: string;
  company: string;
  raw: string;
};

GlobalWorkerOptions.workerSrc = "";

const Y_TOLERANCE = 3;

const HEADER_PATTERNS = [
  /lista de alimentos/i,
  /lista de medicamentos/i,
  /fecha de actualizaci[oó]n/i,
  /^alimentos\s+producto\s+empresa$/i,
  /^medicamentos\s+producto\s+empresa$/i,
  /preparado por fundaci[oó]n convivir/i,
  /fundaci[oó]n convivir/i,
  /^producto$/i,
  /^empresa$/i,
  /^alimentos$/i,
  /^medicamentos$/i,
  /^p[aá]gina\s+\d+$/i,
  /^\d+$/,
];

function normalizeLine(line: string) {
  return line.replace(/\s+/g, " ").trim();
}

function appendText(base: string | null | undefined, next: string) {
  const cleanNext = normalizeLine(next);
  if (!cleanNext) return base ?? null;

  return normalizeLine([base, cleanNext].filter(Boolean).join(" "));
}

function hasLetters(value: string) {
  return /[a-záéíóúñ]/i.test(value);
}

function detectStatus(
  line: string,
): ConvivirCertificationStatus | undefined {
  const clean = normalizeLine(line);

  if (/certificados libres de gluten/i.test(clean)) {
    return "CERTIFIED_GLUTEN_FREE";
  }

  if (/no han renovado an[aá]lisis/i.test(clean)) {
    return "NOT_RENEWED_ANALYSIS";
  }

  return undefined;
}

function isIgnoredText(line: string) {
  const clean = normalizeLine(line);
  if (!clean) return true;
  if (clean.length < 2) return true;
  if (detectStatus(clean)) return true;

  return HEADER_PATTERNS.some((pattern) => pattern.test(clean));
}

function isDetectedLineUseful(line: DetectedPdfLine) {
  const clean = normalizeLine(line.raw);
  if (!clean) return false;
  if (!hasLetters(clean)) return false;

  return true;
}

function getTextItemY(item: PdfTextItem) {
  return Number(item.transform[5] ?? 0);
}

function getTextItemX(item: PdfTextItem) {
  return Number(item.transform[4] ?? 0);
}

function groupItemsByVisualLine(items: PdfTextItem[]) {
  const sortedItems = [...items]
    .filter((item) => normalizeLine(item.str).length > 0)
    .sort((a, b) => getTextItemY(b) - getTextItemY(a));
  const lineBuckets: PdfTextItem[][] = [];

  for (const item of sortedItems) {
    const y = getTextItemY(item);
    const existingLine = lineBuckets.find((bucket) => {
      const bucketY = getTextItemY(bucket[0]);

      return Math.abs(bucketY - y) <= Y_TOLERANCE;
    });

    if (existingLine) {
      existingLine.push(item);
    } else {
      lineBuckets.push([item]);
    }
  }

  return lineBuckets.map((lineItems) =>
    lineItems.sort((a, b) => getTextItemX(a) - getTextItemX(b)),
  );
}

function detectColumnsForLine(
  pageNumber: number,
  width: number,
  lineItems: PdfTextItem[],
): DetectedPdfLine {
  const firstColumnLimit = width * 0.28;
  const productLimit = width * 0.72;
  const firstColumnParts: string[] = [];
  const productParts: string[] = [];
  const companyParts: string[] = [];

  for (const item of lineItems) {
    const text = normalizeLine(item.str);
    if (!text) continue;

    const x = getTextItemX(item);
    if (x < firstColumnLimit) {
      firstColumnParts.push(text);
    } else if (x < productLimit) {
      productParts.push(text);
    } else {
      companyParts.push(text);
    }
  }

  const firstColumn = normalizeLine(firstColumnParts.join(" "));
  const product = normalizeLine(productParts.join(" "));
  const company = normalizeLine(companyParts.join(" "));

  return {
    pageNumber,
    y: Math.round(getTextItemY(lineItems[0])),
    firstColumn,
    product,
    company,
    raw: normalizeLine([firstColumn, product, company].filter(Boolean).join(" ")),
  };
}

function toRaw(row: ParsedConvivirRow) {
  return normalizeLine(
    [row.category, row.subcategory, row.name, row.company]
      .filter(Boolean)
      .join(" "),
  );
}

function pushUniqueRow(rows: ParsedConvivirRow[], row: ParsedConvivirRow) {
  const normalizedName = normalizeLine(row.name);
  const normalizedCompany = normalizeLine(row.company ?? "");
  if (!normalizedName || !normalizedCompany) return;

  const normalizedRow = {
    ...row,
    name: normalizedName,
    category: row.category ? normalizeLine(row.category) : null,
    subcategory: row.subcategory ? normalizeLine(row.subcategory) : null,
    company: normalizedCompany,
    brand: row.brand ?? null,
    certificationStatus: row.certificationStatus ?? "UNKNOWN",
  } satisfies ParsedConvivirRow;

  rows.push({
    ...normalizedRow,
    raw: toRaw(normalizedRow),
  });
}

function appendToLastRowName(rows: ParsedConvivirRow[], product: string) {
  const lastRow = rows.at(-1);
  if (!lastRow) return false;

  lastRow.name = appendText(lastRow.name, product) ?? lastRow.name;
  lastRow.raw = toRaw(lastRow);

  return true;
}

function appendToLastRowCompany(rows: ParsedConvivirRow[], company: string) {
  const lastRow = rows.at(-1);
  if (!lastRow) return false;

  lastRow.company = appendText(lastRow.company, company);
  lastRow.raw = toRaw(lastRow);

  return true;
}

function shouldAppendSubcategoryContinuation(
  previousSubcategory: string | null | undefined,
  nextSubcategory: string,
) {
  const previous = normalizeLine(previousSubcategory ?? "");
  const next = normalizeLine(nextSubcategory);

  if (!previous || !next) return false;
  if (previous.endsWith(",")) return true;
  if (/\b(DIA|DÍA|NOCHE):/i.test(previous)) return true;
  if (/^[a-záéíóúñ]/.test(next)) return true;

  return false;
}

function detectedLinesToRows(lines: DetectedPdfLine[]) {
  const rows: ParsedConvivirRow[] = [];
  let currentCategory: string | null = null;
  let currentStatus: ConvivirCertificationStatus = "CERTIFIED_GLUTEN_FREE";
  let pendingRow: ParsedConvivirRow | null = null;

  function flushPending() {
    if (!pendingRow) return;

    pushUniqueRow(rows, pendingRow);
    pendingRow = null;
  }

  for (const line of lines) {
    if (!isDetectedLineUseful(line)) continue;

    const status = detectStatus(line.raw);
    if (status) {
      flushPending();
      currentStatus = status;
      currentCategory = null;
      continue;
    }

    if (isIgnoredText(line.raw)) continue;

    const firstColumn = normalizeLine(line.firstColumn);
    const product = normalizeLine(line.product);
    const company = normalizeLine(line.company);
    const hasFirstColumn = firstColumn.length > 0;
    const hasProduct = product.length > 0;
    const hasCompany = company.length > 0;

    if (hasFirstColumn && !hasProduct && !hasCompany) {
      if (
        pendingRow &&
        shouldAppendSubcategoryContinuation(
          pendingRow.subcategory,
          firstColumn,
        )
      ) {
        pendingRow.subcategory = appendText(
          pendingRow.subcategory,
          firstColumn,
        );
      } else {
        flushPending();
        currentCategory = firstColumn;
      }
      continue;
    }

    if (!hasProduct && hasCompany) {
      if (pendingRow) {
        pendingRow.company = appendText(pendingRow.company, company);
      } else {
        appendToLastRowCompany(rows, company);
      }
      continue;
    }

    if (hasProduct && !hasFirstColumn && !hasCompany && !pendingRow) {
      if (appendToLastRowName(rows, product)) {
        continue;
      }
    }

    if (pendingRow && hasProduct && !hasFirstColumn) {
      pendingRow.name = appendText(pendingRow.name, product) ?? pendingRow.name;

      if (hasCompany) {
        pendingRow.company = appendText(pendingRow.company, company);
      }
      continue;
    }

    flushPending();

    if (!hasProduct) {
      continue;
    }

    pendingRow = {
      category: currentCategory || firstColumn || null,
      subcategory: firstColumn || null,
      name: product,
      company: company || null,
      brand: null,
      certificationStatus: currentStatus,
      raw: "",
    };
  }

  flushPending();

  return Array.from(
    new Map(
      rows.map((row) => [
        [
          normalizeLine(row.category ?? ""),
          normalizeLine(row.subcategory ?? ""),
          normalizeLine(row.name),
          normalizeLine(row.company ?? ""),
          row.certificationStatus ?? "UNKNOWN",
        ].join("|"),
        row,
      ]),
    ).values(),
  );
}

async function getDetectedPdfLines(buffer: Buffer) {
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    useWorkerFetch: false,
  });
  const pdf = await loadingTask.promise;
  const lines: DetectedPdfLine[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();
      const textItems = textContent.items.filter(
        (item): item is PdfTextItem => "str" in item && "transform" in item,
      );

      for (const lineItems of groupItemsByVisualLine(textItems)) {
        const line = detectColumnsForLine(
          pageNumber,
          viewport.width,
          lineItems,
        );

        if (isDetectedLineUseful(line)) {
          lines.push(line);
        }
      }

      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }

  return lines;
}

export async function debugParseConvivirPdf(buffer: Buffer) {
  return (await getDetectedPdfLines(buffer)).slice(0, 20);
}

export async function parseConvivirPdf(
  buffer: Buffer,
): Promise<ParsedConvivirRow[]> {
  const rows = detectedLinesToRows(await getDetectedPdfLines(buffer));

  if (process.env.NODE_ENV === "development") {
    console.log(`[parseConvivirPdf] rows parsed: ${rows.length}`);
  }

  return rows;
}
