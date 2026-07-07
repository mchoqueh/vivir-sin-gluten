const STOP_WORDS = new Set([
  "a",
  "al",
  "con",
  "de",
  "del",
  "el",
  "en",
  "la",
  "las",
  "lo",
  "los",
  "o",
  "para",
  "por",
  "sin",
  "un",
  "una",
  "unas",
  "unos",
  "y",
  "and",
  "the",
  "of",
  "producto",
  "productos",
  "marca",
  "contenido",
  "neto",
  "ingrediente",
  "ingredientes",
  "informacion",
  "nutricional",
  "elaborado",
  "fabricado",
  "distribuido",
  "gluten",
  "libre",
  "libres",
  "certificado",
]);

export const GENERIC_PRODUCT_TOKENS = new Set([
  "alimentario",
  "alimentarios",
  "alimento",
  "alimentos",
  "bebida",
  "bebidas",
  "capsula",
  "capsulas",
  "comprimido",
  "comprimidos",
  "envase",
  "mg",
  "ml",
  "original",
  "polvo",
  "producto",
  "sabor",
  "sin",
  "tableta",
  "tabletas",
  "unidad",
  "unidades",
]);

export function normalizeProductSearchText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘`´]/g, "'")
    .replace(/['"]/g, "")
    .replace(/&/g, " y ")
    .replace(/[-_/.,;:()[\]{}+*|\\]/g, " ")
    .replace(/[^a-z0-9ñ\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function singularize(token: string) {
  if (token.endsWith("es") && token.length > 5) return token.slice(0, -2);
  if (token.endsWith("s") && token.length > 4) return token.slice(0, -1);
  return token;
}

function tokenAliases(token: string) {
  const aliases = new Set<string>([token]);
  const singular = singularize(token);
  aliases.add(singular);

  if (/^[a-z]+\d+$/.test(token)) {
    aliases.add(token.replace(/(\D+)(\d+)/, "$1 $2"));
  }

  if (token === "caps") aliases.add("capsulas");
  if (token === "cap") aliases.add("capsula");
  if (token === "vitamina") aliases.add("vit");
  if (token === "vitaminas") aliases.add("vit");
  if (token === "suplementos") aliases.add("suplemento");
  if (token === "alimentarios") aliases.add("alimentario");

  return aliases;
}

export function tokenizeProductSearchText(value: string) {
  const normalized = normalizeProductSearchText(value);
  const seen = new Set<string>();
  const tokens: string[] = [];

  for (const token of normalized.split(" ")) {
    if (token.length < 3) continue;
    if (/^\d+$/.test(token)) continue;
    if (STOP_WORDS.has(token)) continue;

    for (const alias of tokenAliases(token)) {
      for (const aliasToken of alias.split(" ")) {
        if (aliasToken.length < 3) continue;
        if (STOP_WORDS.has(aliasToken)) continue;
        if (seen.has(aliasToken)) continue;

        seen.add(aliasToken);
        tokens.push(aliasToken);
      }
    }
  }

  return tokens;
}

export function uniqueUsefulTokens(value: string) {
  return tokenizeProductSearchText(value).filter(
    (token) => !GENERIC_PRODUCT_TOKENS.has(token),
  );
}

export function hasUsefulOcrText(value: string) {
  const tokens = uniqueUsefulTokens(value);
  if (tokens.length >= 2) return true;

  return tokens.some((token) => token.length >= 5);
}

export function areSearchTextsSimilar(previous: string, next: string) {
  const previousTokens = new Set(uniqueUsefulTokens(previous));
  const nextTokens = new Set(uniqueUsefulTokens(next));

  if (previousTokens.size === 0 || nextTokens.size === 0) return false;

  let shared = 0;
  for (const token of nextTokens) {
    if (previousTokens.has(token)) shared += 1;
  }

  const ratio = shared / Math.max(previousTokens.size, nextTokens.size);
  return ratio >= 0.85;
}

export function compactOcrText(value: string, maxLength = 220) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) return normalized;

  return `${normalized.slice(0, maxLength).trim()}...`;
}
