import {
  GENERIC_PRODUCT_TOKENS,
  normalizeProductSearchText,
  tokenizeProductSearchText,
} from "./normalize";

export type ScanSourceType = "FOOD" | "MEDICINE";

export type ScanContextDictionaries = {
  companyTokens?: string[];
  categoryTokens?: string[];
  subcategoryTokens?: string[];
};

export type ScanContext = {
  probableType: ScanSourceType | null;
  probableCategories: string[];
  probableSubcategories: string[];
  brandTokens: string[];
  productTokens: string[];
  genericTokens: string[];
  confidence: number;
  matchedAliases: string[];
};

type AliasGroup = {
  aliases: string[];
  type: ScanSourceType;
  categories: string[];
  subcategories: string[];
};

const INTERNAL_BRAND_TOKENS = new Set([
  "carozzi",
  "coca",
  "cocacola",
  "lays",
  "nestle",
  "pepsi",
  "soprole",
]);

const CONTEXT_ALIAS_GROUPS: AliasGroup[] = [
  {
    aliases: [
      "bebida",
      "bebidas",
      "gaseosa",
      "gaseosas",
      "cola",
      "zero",
      "light",
      "sin azucar",
      "jugo",
      "nectar",
      "agua",
      "mineral",
      "isotonica",
      "energetica",
    ],
    type: "FOOD",
    categories: ["bebida", "bebidas"],
    subcategories: [
      "analcoholica",
      "analcoholicas",
      "bebida",
      "bebidas",
      "cola",
      "gaseosa",
      "gaseosas",
      "jugo",
      "nectar",
    ],
  },
  {
    aliases: [
      "comprimidos",
      "capsulas",
      "jarabe",
      "gotas",
      "suspension",
      "mg",
      "pharma",
      "laboratorio",
    ],
    type: "MEDICINE",
    categories: ["medicamento", "medicamentos"],
    subcategories: ["capsulas", "comprimidos", "gotas", "jarabe", "suspension"],
  },
  {
    aliases: ["leche", "yogurt", "yogur", "queso", "crema"],
    type: "FOOD",
    categories: ["lacteos", "lacteo"],
    subcategories: ["crema", "leche", "queso", "yogur", "yogurt"],
  },
  {
    aliases: ["papas", "fritas", "snack", "chips"],
    type: "FOOD",
    categories: ["snack", "snacks"],
    subcategories: ["chips", "papas", "papas fritas"],
  },
  {
    aliases: ["pasta", "spaghetti", "tallarines", "fideos"],
    type: "FOOD",
    categories: ["pastas", "pasta"],
    subcategories: ["fideos", "spaghetti", "tallarines"],
  },
];

function unique(tokens: string[]) {
  return Array.from(new Set(tokens.filter(Boolean)));
}

function aliasMatches(alias: string, tokenSet: Set<string>, fullText: string) {
  const normalizedAlias = normalizeProductSearchText(alias);
  const aliasTokens = tokenizeProductSearchText(normalizedAlias);

  if (normalizedAlias.includes(" ")) {
    return fullText.includes(normalizedAlias);
  }

  return (
    tokenSet.has(normalizedAlias) ||
    aliasTokens.some((token) => tokenSet.has(token))
  );
}

export function inferScanContext(
  tokens: string[],
  fullText: string,
  dictionaries: ScanContextDictionaries = {},
): ScanContext {
  const normalizedFullText = normalizeProductSearchText(fullText);
  const allTokens = unique([
    ...tokens.flatMap(tokenizeProductSearchText),
    ...tokenizeProductSearchText(fullText),
  ]);
  const tokenSet = new Set(allTokens);
  const companyTokenSet = new Set(dictionaries.companyTokens ?? []);
  const categoryTokenSet = new Set(dictionaries.categoryTokens ?? []);
  const subcategoryTokenSet = new Set(dictionaries.subcategoryTokens ?? []);
  const matchedAliases = new Set<string>();
  const probableCategories = new Set<string>();
  const probableSubcategories = new Set<string>();
  const typeHits = new Map<ScanSourceType, number>([
    ["FOOD", 0],
    ["MEDICINE", 0],
  ]);

  for (const group of CONTEXT_ALIAS_GROUPS) {
    for (const alias of group.aliases) {
      if (!aliasMatches(alias, tokenSet, normalizedFullText)) continue;

      matchedAliases.add(normalizeProductSearchText(alias));
      typeHits.set(group.type, (typeHits.get(group.type) ?? 0) + 1);
      group.categories.forEach((category) =>
        probableCategories.add(normalizeProductSearchText(category)),
      );
      group.subcategories.forEach((subcategory) =>
        probableSubcategories.add(normalizeProductSearchText(subcategory)),
      );
    }
  }

  const brandTokens = allTokens.filter(
    (token) => companyTokenSet.has(token) || INTERNAL_BRAND_TOKENS.has(token),
  );
  const genericTokens = allTokens.filter(
    (token) =>
      GENERIC_PRODUCT_TOKENS.has(token) ||
      categoryTokenSet.has(token) ||
      subcategoryTokenSet.has(token),
  );
  const productTokens = allTokens.filter(
    (token) =>
      !brandTokens.includes(token) &&
      !genericTokens.includes(token) &&
      !GENERIC_PRODUCT_TOKENS.has(token),
  );
  const foodHits = typeHits.get("FOOD") ?? 0;
  const medicineHits = typeHits.get("MEDICINE") ?? 0;
  const probableType =
    foodHits === medicineHits
      ? null
      : foodHits > medicineHits
        ? "FOOD"
        : "MEDICINE";
  const confidence = Math.min(
    100,
    brandTokens.length * 24 +
      productTokens.length * 8 +
      matchedAliases.size * 12 +
      Math.max(foodHits, medicineHits) * 10,
  );

  return {
    probableType,
    probableCategories: unique(Array.from(probableCategories)),
    probableSubcategories: unique(Array.from(probableSubcategories)),
    brandTokens: unique(brandTokens),
    productTokens: unique(productTokens),
    genericTokens: unique(genericTokens),
    confidence,
    matchedAliases: unique(Array.from(matchedAliases)),
  };
}
