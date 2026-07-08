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

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

type DomMatrixInit = number[] | DOMMatrixReadOnly | string;

class NodeDOMMatrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  m11 = 1;
  m12 = 0;
  m13 = 0;
  m14 = 0;
  m21 = 0;
  m22 = 1;
  m23 = 0;
  m24 = 0;
  m31 = 0;
  m32 = 0;
  m33 = 1;
  m34 = 0;
  m41 = 0;
  m42 = 0;
  m43 = 0;
  m44 = 1;
  is2D = true;
  isIdentity = true;

  constructor(init?: DomMatrixInit) {
    if (Array.isArray(init) && init.length >= 6) {
      this.a = Number(init[0] ?? 1);
      this.b = Number(init[1] ?? 0);
      this.c = Number(init[2] ?? 0);
      this.d = Number(init[3] ?? 1);
      this.e = Number(init[4] ?? 0);
      this.f = Number(init[5] ?? 0);
      this.m11 = this.a;
      this.m12 = this.b;
      this.m21 = this.c;
      this.m22 = this.d;
      this.m41 = this.e;
      this.m42 = this.f;
      this.isIdentity =
        this.a === 1 &&
        this.b === 0 &&
        this.c === 0 &&
        this.d === 1 &&
        this.e === 0 &&
        this.f === 0;
    }
  }

  multiply() {
    return this;
  }

  multiplySelf() {
    return this;
  }

  preMultiplySelf() {
    return this;
  }

  translateSelf() {
    return this;
  }

  scaleSelf() {
    return this;
  }

  rotateSelf() {
    return this;
  }

  invertSelf() {
    return this;
  }

  transformPoint(point: DOMPointInit = {}) {
    const x = Number(point.x ?? 0);
    const y = Number(point.y ?? 0);

    return {
      x: x * this.a + y * this.c + this.e,
      y: x * this.b + y * this.d + this.f,
      z: Number(point.z ?? 0),
      w: Number(point.w ?? 1),
    };
  }

  toFloat32Array() {
    return Float32Array.from(this.toFloat64Array());
  }

  toFloat64Array() {
    return Float64Array.from([
      this.m11,
      this.m12,
      this.m13,
      this.m14,
      this.m21,
      this.m22,
      this.m23,
      this.m24,
      this.m31,
      this.m32,
      this.m33,
      this.m34,
      this.m41,
      this.m42,
      this.m43,
      this.m44,
    ]);
  }
}

class NodeImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;

  constructor(dataOrWidth: Uint8ClampedArray | number, width: number, height?: number) {
    if (typeof dataOrWidth === "number") {
      this.width = dataOrWidth;
      this.height = width;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    } else {
      this.data = dataOrWidth;
      this.width = width;
      this.height = height ?? 0;
    }
  }
}

class NodePath2D {}

let pdfJsPromise: Promise<PdfJsModule> | null = null;

function installPdfJsNodePolyfills() {
  const globalScope = globalThis as typeof globalThis & {
    DOMMatrix?: typeof DOMMatrix;
    ImageData?: typeof ImageData;
    Path2D?: typeof Path2D;
  };

  globalScope.DOMMatrix ??= NodeDOMMatrix as unknown as typeof DOMMatrix;
  globalScope.ImageData ??= NodeImageData as unknown as typeof ImageData;
  globalScope.Path2D ??= NodePath2D as unknown as typeof Path2D;
}

async function getPdfJs() {
  installPdfJsNodePolyfills();

  pdfJsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = "";
    return pdfjs;
  });

  return pdfJsPromise;
}

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
  const { getDocument } = await getPdfJs();
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    useSystemFonts: true,
    useWorkerFetch: false,
  } as unknown as Parameters<typeof getDocument>[0]);
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
