"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FormEvent,
  KeyboardEvent,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { normalizeSearchText, sourceTypeLabel } from "@/lib/utils";

type SourceType = "FOOD" | "MEDICINE";
type CertificationStatus =
  | "CERTIFIED_GLUTEN_FREE"
  | "NOT_RENEWED_ANALYSIS"
  | "UNKNOWN";

export type SearchItem = {
  id: string;
  sourceType: SourceType;
  name: string;
  company: string | null;
  category: string | null;
  subcategory: string | null;
  certificationStatus: CertificationStatus;
  normalized: string;
};

export type SearchInitialState = {
  q: string;
  type?: SourceType;
  status?: CertificationStatus;
  category: string;
  company: string;
};

type IndexedSearchItem = SearchItem & {
  searchText: string;
  nameNormalized: string;
  companyNormalized: string;
  categoryNormalized: string;
  subcategoryNormalized: string;
  aliases: string[];
  tokens: string[];
};

type Suggestion = {
  value: string;
  label: string;
  source: string;
  score: number;
};

const SEARCH_DEBOUNCE_MS = 250;
const MAX_RESULTS = 80;
const BEST_MATCH_THRESHOLD = 90;

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function compactText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function tokenize(value: string) {
  return unique(normalizeSearchText(value).split(" ").filter((token) => token.length >= 2));
}

function compactAlias(value: string) {
  return normalizeSearchText(value).replace(/\s+/g, "");
}

function buildIndexItem(item: SearchItem): IndexedSearchItem {
  const nameNormalized = normalizeSearchText(item.name);
  const companyNormalized = normalizeSearchText(item.company ?? "");
  const categoryNormalized = normalizeSearchText(item.category ?? "");
  const subcategoryNormalized = normalizeSearchText(item.subcategory ?? "");
  const aliases = unique([
    nameNormalized,
    companyNormalized,
    categoryNormalized,
    subcategoryNormalized,
    compactAlias(item.name),
    compactAlias(item.company ?? ""),
    ...tokenize(item.name).filter((token) => token.length >= 4),
  ]);
  const tokens = unique([
    ...tokenize(item.name),
    ...tokenize(item.company ?? ""),
    ...tokenize(item.category ?? ""),
    ...tokenize(item.subcategory ?? ""),
    ...tokenize(item.normalized),
  ]);

  return {
    ...item,
    nameNormalized,
    companyNormalized,
    categoryNormalized,
    subcategoryNormalized,
    aliases,
    tokens,
    searchText: unique([
      nameNormalized,
      companyNormalized,
      categoryNormalized,
      subcategoryNormalized,
      item.normalized,
      aliases.join(" "),
      tokens.join(" "),
    ]).join(" "),
  };
}

function statusMeta(status: CertificationStatus) {
  if (status === "CERTIFIED_GLUTEN_FREE") {
    return {
      label: "✔ Certificado sin gluten",
      className: "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200",
    };
  }

  if (status === "NOT_RENEWED_ANALYSIS") {
    return {
      label: "⚠ No ha renovado análisis",
      className: "bg-amber-100 text-amber-950 ring-1 ring-amber-200",
    };
  }

  return {
    label: "✖ No certificado",
    className: "bg-red-100 text-red-900 ring-1 ring-red-200",
  };
}

function buildHref(params: SearchInitialState) {
  const search = new URLSearchParams();

  if (params.q.trim()) search.set("q", params.q.trim());
  if (params.type) search.set("type", params.type);
  if (params.status) search.set("status", params.status);
  if (params.category) search.set("category", params.category);
  if (params.company) search.set("company", params.company);

  const query = search.toString();
  return query ? `/buscar?${query}` : "/buscar";
}

function scoreItem(item: IndexedSearchItem, normalizedQuery: string, queryTokens: string[]) {
  if (!normalizedQuery) return 10;

  let score = 0;
  const compactQuery = compactAlias(normalizedQuery);

  if (item.nameNormalized === normalizedQuery) score += 140;
  if (item.nameNormalized.startsWith(normalizedQuery)) score += 115;
  if (item.aliases.some((alias) => alias === normalizedQuery || alias === compactQuery)) {
    score += 105;
  }
  if (item.nameNormalized.includes(normalizedQuery)) score += 88;
  if (item.companyNormalized === normalizedQuery) score += 72;
  if (item.companyNormalized.startsWith(normalizedQuery)) score += 64;
  if (item.companyNormalized.includes(normalizedQuery)) score += 52;
  if (item.categoryNormalized.includes(normalizedQuery)) score += 34;
  if (item.subcategoryNormalized.includes(normalizedQuery)) score += 28;
  if (item.searchText.includes(normalizedQuery)) score += 22;

  const matchedTokens = queryTokens.filter((token) =>
    item.tokens.some((target) => target === token || target.startsWith(token)),
  );
  score += matchedTokens.length * 16;
  score += (matchedTokens.length / Math.max(1, queryTokens.length)) * 24;

  if (queryTokens.length > 0 && matchedTokens.length === 0) return 0;

  return Math.round(score);
}

function scoreToConfidence(score: number) {
  if (score >= 140) return 99;
  if (score >= 115) return 95;
  if (score >= 95) return 91;
  if (score >= 70) return 84;
  if (score >= 45) return 72;
  if (score >= 24) return 60;
  return 0;
}

function filterByControls(
  item: IndexedSearchItem,
  filters: Omit<SearchInitialState, "q">,
) {
  if (filters.type && item.sourceType !== filters.type) return false;
  if (filters.status && item.certificationStatus !== filters.status) return false;
  if (filters.category && item.category !== filters.category) return false;
  if (filters.company && item.company !== filters.company) return false;

  return true;
}

function buildSuggestions(items: IndexedSearchItem[], query: string): Suggestion[] {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length < 2) return [];

  const suggestions = new Map<string, Suggestion>();

  function add(value: string | null | undefined, source: string, baseScore: number) {
    const clean = compactText(value);
    if (!clean) return;

    const normalized = normalizeSearchText(clean);
    if (!normalized.includes(normalizedQuery) && !normalized.startsWith(normalizedQuery)) {
      return;
    }

    const score =
      normalized === normalizedQuery
        ? baseScore + 40
        : normalized.startsWith(normalizedQuery)
          ? baseScore + 24
          : baseScore;
    const previous = suggestions.get(normalized);
    if (!previous || score > previous.score) {
      suggestions.set(normalized, {
        value: clean,
        label: clean,
        source,
        score,
      });
    }
  }

  for (const item of items) {
    add(item.name, "Producto", 90);
    add(item.company, "Empresa", 62);
    add(item.category, "Categoría", 42);
    add(item.subcategory, "Subcategoría", 38);
    for (const token of item.tokens) add(token, "Relacionado", 28);
  }

  return Array.from(suggestions.values())
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))
    .slice(0, 8);
}

function ResultCard({
  item,
  highlighted = false,
}: {
  item: SearchItem;
  highlighted?: boolean;
}) {
  const status = statusMeta(item.certificationStatus);

  return (
    <Link
      href={`/producto/${item.id}`}
      className={`block rounded-md border bg-white p-3 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md ${
        highlighted ? "border-emerald-300 ring-1 ring-emerald-200" : "border-zinc-200"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status.className}`}>
          {status.label}
        </span>
        <span className="shrink-0 text-sm font-medium text-emerald-700">
          Ver ficha →
        </span>
      </div>

      <h2 className="mt-2 line-clamp-2 text-base font-semibold leading-5 text-zinc-950">
        {item.name}
      </h2>

      <div className="mt-2 grid gap-1 text-sm leading-5 text-zinc-600">
        <p className="line-clamp-1">{item.company ?? "Sin empresa"}</p>
        <p className="line-clamp-1">
          {item.sourceType === "MEDICINE" ? "💊" : "🛒"}{" "}
          {sourceTypeLabel(item.sourceType)}
        </p>
        <p className="line-clamp-1">
          🏷 {[item.category, item.subcategory].filter(Boolean).join(" / ") || "Sin categoría"}
        </p>
      </div>
    </Link>
  );
}

export function SearchExperience({
  items,
  initialState,
}: {
  items: SearchItem[];
  initialState: SearchInitialState;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initialState.q);
  const [type, setType] = useState<SourceType | undefined>(initialState.type);
  const [status, setStatus] = useState<CertificationStatus | undefined>(
    initialState.status,
  );
  const [category, setCategory] = useState(initialState.category);
  const [company, setCompany] = useState(initialState.company);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const deferredQ = useDeferredValue(q);
  const indexedItems = useMemo(() => items.map(buildIndexItem), [items]);
  const controlFilters = useMemo(
    () => ({ type, status, category, company }),
    [category, company, status, type],
  );
  const availableCategories = useMemo(
    () =>
      unique(
        indexedItems
          .filter((item) => filterByControls(item, { type, status, category: "", company: "" }))
          .map((item) => item.category ?? ""),
      ).sort((left, right) => left.localeCompare(right)),
    [indexedItems, status, type],
  );
  const availableCompanies = useMemo(
    () =>
      unique(
        indexedItems
          .filter((item) => filterByControls(item, { type, status, category, company: "" }))
          .map((item) => item.company ?? ""),
      ).sort((left, right) => left.localeCompare(right)),
    [category, indexedItems, status, type],
  );
  const suggestions = useMemo(
    () =>
      buildSuggestions(
        indexedItems.filter((item) => filterByControls(item, controlFilters)),
        deferredQ,
      ),
    [controlFilters, deferredQ, indexedItems],
  );
  const normalizedQuery = useMemo(() => normalizeSearchText(deferredQ), [deferredQ]);
  const queryTokens = useMemo(() => tokenize(deferredQ), [deferredQ]);
  const scoredResults = useMemo(() => {
    return indexedItems
      .filter((item) => filterByControls(item, controlFilters))
      .map((item) => ({
        item,
        score: scoreItem(item, normalizedQuery, queryTokens),
      }))
      .filter((entry) => !normalizedQuery || entry.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.item.nameNormalized.localeCompare(right.item.nameNormalized),
      )
      .slice(0, MAX_RESULTS);
  }, [controlFilters, indexedItems, normalizedQuery, queryTokens]);
  const bestResult = scoredResults[0];
  const bestConfidence = bestResult ? scoreToConfidence(bestResult.score) : 0;
  const hasBestMatch = Boolean(normalizedQuery && bestResult && bestConfidence >= BEST_MATCH_THRESHOLD);
  const visibleResults = hasBestMatch ? scoredResults.slice(1) : scoredResults;

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      window.history.replaceState(
        null,
        "",
        buildHref({
          q,
          type,
          status,
          category,
          company,
        }),
      );
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [category, company, q, status, type]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    router.push(buildHref({ q, type, status, category, company }), {
      scroll: false,
    });
    setSuggestionsOpen(false);
  }

  function applySuggestion(value: string) {
    setQ(value);
    setSuggestionsOpen(false);
    setActiveSuggestion(-1);
    inputRef.current?.focus();
  }

  function handleSuggestionKeys(event: KeyboardEvent<HTMLInputElement>) {
    if (!suggestionsOpen && event.key !== "Escape") setSuggestionsOpen(true);

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSuggestion((current) =>
        Math.min(current + 1, suggestions.length - 1),
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggestion((current) => Math.max(current - 1, -1));
    } else if (event.key === "Enter" && activeSuggestion >= 0) {
      event.preventDefault();
      const suggestion = suggestions[activeSuggestion];
      if (suggestion) applySuggestion(suggestion.value);
    } else if (event.key === "Escape") {
      setSuggestionsOpen(false);
      setActiveSuggestion(-1);
    }
  }

  function clearFilters() {
    setQ("");
    setType(undefined);
    setStatus(undefined);
    setCategory("");
    setCompany("");
    setSuggestionsOpen(false);
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl overflow-x-hidden px-4 py-7 sm:px-6 sm:py-10">
      <Link href="/" className="text-sm font-medium text-emerald-700">
        Volver al inicio
      </Link>

      <header className="mt-7">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-950">
          Buscar productos
        </h1>
      </header>

      <form onSubmit={submitSearch} className="mt-6">
        <div className="relative">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <label className="relative block min-w-0">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg text-zinc-400">
                🔎
              </span>
              <input
                ref={inputRef}
                value={q}
                onChange={(event) => {
                  setQ(event.target.value);
                  setSuggestionsOpen(true);
                  setActiveSuggestion(-1);
                }}
                onFocus={() => setSuggestionsOpen(true)}
                onKeyDown={handleSuggestionKeys}
                placeholder="Busca un producto, medicamento, empresa, categoría o marca..."
                role="combobox"
                aria-expanded={suggestionsOpen}
                aria-controls="search-suggestions"
                aria-activedescendant={
                  activeSuggestion >= 0
                    ? `search-suggestion-${activeSuggestion}`
                    : undefined
                }
                className="h-13 w-full min-w-0 rounded-md border border-zinc-300 bg-white py-3 pl-12 pr-4 text-base outline-none ring-emerald-600 transition focus:ring-2"
              />
            </label>
            <button className="h-13 rounded-md bg-emerald-700 px-6 text-sm font-semibold text-white transition hover:bg-emerald-800">
              Buscar
            </button>
          </div>

          {suggestionsOpen && suggestions.length > 0 ? (
            <div
              id="search-suggestions"
              className="absolute z-20 mt-2 max-h-80 w-full overflow-auto rounded-md border border-zinc-200 bg-white py-2 shadow-xl transition"
            >
              {suggestions.map((suggestion, index) => (
                <button
                  key={`${suggestion.source}-${suggestion.value}`}
                  id={`search-suggestion-${index}`}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applySuggestion(suggestion.value)}
                  className={`flex w-full items-center justify-between gap-4 px-4 py-2.5 text-left text-sm transition ${
                    index === activeSuggestion
                      ? "bg-emerald-50 text-emerald-950"
                      : "text-zinc-800 hover:bg-zinc-50"
                  }`}
                >
                  <span className="line-clamp-1 font-medium">{suggestion.label}</span>
                  <span className="shrink-0 text-xs text-zinc-500">
                    {suggestion.source}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="mt-4 grid gap-3 rounded-md border border-zinc-200 bg-white/80 p-3 transition sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-wrap gap-2 lg:col-span-4">
            {[
              ["", "Todos"],
              ["FOOD", "Alimentos"],
              ["MEDICINE", "Medicamentos"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setType(value ? (value as SourceType) : undefined)}
                className={`rounded-full border px-3 py-1.5 text-sm transition ${
                  (value || undefined) === type
                    ? "border-emerald-700 bg-emerald-50 text-emerald-800"
                    : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                }`}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 transition hover:bg-zinc-50"
            >
              Limpiar filtros
            </button>
          </div>

          <select
            value={status ?? ""}
            onChange={(event) =>
              setStatus((event.target.value || undefined) as CertificationStatus | undefined)
            }
            className="h-10 min-w-0 rounded-md border border-zinc-300 bg-white px-3 text-sm"
            aria-label="Estado"
          >
            <option value="">Todos los estados</option>
            <option value="CERTIFIED_GLUTEN_FREE">✔ Certificado sin gluten</option>
            <option value="NOT_RENEWED_ANALYSIS">⚠ No ha renovado análisis</option>
            <option value="UNKNOWN">✖ No certificado</option>
          </select>

          <select
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              setCompany("");
            }}
            className="h-10 min-w-0 rounded-md border border-zinc-300 bg-white px-3 text-sm"
            aria-label="Categoria"
          >
            <option value="">Todas las categorías</option>
            {availableCategories.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          <select
            value={company}
            onChange={(event) => setCompany(event.target.value)}
            className="h-10 min-w-0 rounded-md border border-zinc-300 bg-white px-3 text-sm lg:col-span-2"
            aria-label="Empresa"
          >
            <option value="">Todas las empresas</option>
            {availableCompanies.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </form>

      <p className="mt-5 text-sm text-zinc-600">
        Mostrando {scoredResults.length} producto
        {scoredResults.length === 1 ? "" : "s"}
        {scoredResults.length === MAX_RESULTS ? " más relevantes" : ""}
      </p>

      <section className="mt-4 space-y-4">
        {hasBestMatch && bestResult ? (
          <div className="animate-[fadeIn_180ms_ease-out]">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
              Mejor coincidencia
            </p>
            <ResultCard item={bestResult.item} highlighted />
          </div>
        ) : null}

        {hasBestMatch && visibleResults.length > 0 ? (
          <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Otros resultados relacionados
          </p>
        ) : null}

        <div className="grid gap-2.5">
          {visibleResults.map((entry) => (
            <div key={entry.item.id} className="animate-[fadeIn_180ms_ease-out]">
              <ResultCard item={entry.item} />
            </div>
          ))}
        </div>

        {scoredResults.length === 0 ? (
          <div className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-600 sm:p-8">
            No hay productos para esta búsqueda.
          </div>
        ) : null}
      </section>
    </main>
  );
}
