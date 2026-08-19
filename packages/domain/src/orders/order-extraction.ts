export interface OrderCatalogItem {
  productId: string;
  name: string;
}

export interface ExtractedOrderLine {
  productId: string;
  /** Cantidad en string decimal ("1", "2", "5"). */
  quantity: string;
}

export interface OrderExtractionResult {
  lines: ExtractedOrderLine[];
  /** Términos del texto que no resolvieron a ningún producto del catálogo. */
  ambiguities: string[];
}

/** Normaliza texto para matching: minúsculas, sin acentos, espacios colapsados. */
export function normalizeOrderText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set([
  "dame", "quiero", "necesito", "me", "un", "una", "unos", "unas", "de", "del",
  "la", "el", "los", "las", "y", "para", "por", "favor", "porfavor", "gracias",
  "hola", "buenas", "buenos", "libra", "libras", "unidad", "unidades",
  "paquete", "paquetes"
]);

/** Raíz aproximada de una palabra (prefijo) para tolerar plurales simples. */
function root(word: string): string {
  return word.slice(0, 4);
}

/** Palabras significativas del nombre (sin stopwords ni tokens con dígitos). */
function itemKeywords(name: string): string[] {
  return normalizeOrderText(name)
    .split(" ")
    .filter((token) => token.length >= 3 && !/^\d+$/.test(token) && !STOPWORDS.has(token));
}

/**
 * Extrae líneas de pedido de texto libre (determinística). Cada producto del
 * catálogo cuya palabra clave coincida con un término del texto genera una
 * línea; la cantidad es el entero inmediatamente anterior (default 1). Los
 * términos que parecen ítems pero no resuelven a ningún producto se reportan
 * como ambigüedades (nunca se resuelven en silencio).
 */
export function extractOrderLines(
  text: string,
  catalog: OrderCatalogItem[]
): OrderExtractionResult {
  const normalized = normalizeOrderText(text);
  const tokens = normalized.length === 0 ? [] : normalized.split(" ");
  const lines: ExtractedOrderLine[] = [];
  const seen = new Set<string>();

  for (const item of catalog) {
    const keywords = itemKeywords(item.name);
    if (keywords.length === 0) continue;
    const matchIndex = tokens.findIndex(
      (token) => !/^\d+$/.test(token) && keywords.some((keyword) => root(keyword) === root(token))
    );
    if (matchIndex === -1 || seen.has(item.productId)) continue;
    seen.add(item.productId);
    lines.push({ productId: item.productId, quantity: quantityBeforeTokens(tokens, matchIndex) });
  }

  const ambiguities = findAmbiguousTerms(tokens, catalog);

  return { lines, ambiguities };
}

/** Busca la cantidad entera inmediatamente anterior al token que matcheó. */
function quantityBeforeTokens(tokens: string[], matchIndex: number): string {
  if (matchIndex > 0) {
    const previous = tokens[matchIndex - 1]!;
    if (/^\d+$/.test(previous) && previous !== "0") return previous;
  }
  // Caso "5 libras de plátano": número antes de "libras de".
  if (matchIndex >= 3) {
    const number = tokens[matchIndex - 3]!;
    const unit = tokens[matchIndex - 2]!;
    const of = tokens[matchIndex - 1]!;
    if (/^\d+$/.test(number) && number !== "0" && (unit === "libra" || unit === "libras" || unit === "unidad" || unit === "unidades") && of === "de") {
      return number;
    }
  }
  return "1";
}

/** Términos candidatos que no resuelven a ningún producto del catálogo. */
function findAmbiguousTerms(tokens: string[], catalog: OrderCatalogItem[]): string[] {
  const knownKeywords = catalog.flatMap((item) => itemKeywords(item.name));
  const ambiguities: string[] = [];
  for (const token of tokens) {
    if (token.length < 3 || /^\d+$/.test(token) || STOPWORDS.has(token)) continue;
    const resolved = knownKeywords.some((keyword) => root(keyword) === root(token));
    if (!resolved && !ambiguities.includes(token)) ambiguities.push(token);
  }
  return ambiguities;
}
