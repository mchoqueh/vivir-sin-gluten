import { createHash } from "crypto";
import type { ParsedConvivirRow } from "./parse-pdf";

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9ñ\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildRowHash(row: ParsedConvivirRow): string {
  const payload = [
    normalizeText(row.category ?? ""),
    normalizeText(row.subcategory ?? ""),
    normalizeText(row.name),
    normalizeText(row.company ?? ""),
    normalizeText(row.certificationStatus ?? "UNKNOWN"),
    normalizeText(row.brand ?? ""),
  ].join("|");

  return createHash("sha256").update(payload).digest("hex");
}

export function buildContentHash(rows: ParsedConvivirRow[]): string {
  const payload = rows
    .map((row) => {
      const normalizedName = normalizeText(row.name);

      if (!normalizedName) return null;

      return [
        normalizeText(row.category ?? ""),
        normalizeText(row.subcategory ?? ""),
        normalizedName,
        normalizeText(row.company ?? ""),
        normalizeText(row.certificationStatus ?? "UNKNOWN"),
        normalizeText(row.brand ?? ""),
      ].join("|");
    })
    .filter((row): row is string => row !== null)
    .sort((a, b) => a.localeCompare(b))
    .join("\n");

  return createHash("sha256").update(payload).digest("hex");
}
