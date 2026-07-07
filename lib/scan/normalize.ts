const STOP_WORDS = new Set([
  "de",
  "del",
  "la",
  "las",
  "el",
  "los",
  "y",
  "en",
  "con",
  "sin",
  "por",
  "para",
  "un",
  "una",
  "unos",
  "unas",
  "producto",
  "productos",
  "contenido",
  "neto",
  "ingredientes",
  "informacion",
  "nutricional",
  "marca",
  "gluten",
  "libre",
]);

export function normalizeProductSearchText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘`´]/g, "'")
    .replace(/['"]/g, "")
    .replace(/&/g, " y ")
    .replace(/[-_/]/g, " ")
    .replace(/[^a-z0-9ñ\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeProductSearchText(value: string) {
  const normalized = normalizeProductSearchText(value);
  const seen = new Set<string>();
  const tokens: string[] = [];

  for (const token of normalized.split(" ")) {
    if (token.length < 3) continue;
    if (STOP_WORDS.has(token)) continue;
    if (seen.has(token)) continue;

    seen.add(token);
    tokens.push(token);
  }

  return tokens;
}

export function compactOcrText(value: string, maxLength = 220) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) return normalized;

  return `${normalized.slice(0, maxLength).trim()}...`;
}
