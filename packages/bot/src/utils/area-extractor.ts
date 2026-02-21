// Vocabulary-aware area extractor
// Scans raw area strings against known DB area names + AREA_CITY_MAP keys.
// Handles space-separated codes ("ss2 ss23") that LLMs fail to comma-separate.

/**
 * Build a deduplicated, lowercase vocabulary sorted longest-first.
 * Longest-first ensures "taman megah" matches before "taman".
 */
export function buildAreaVocabulary(dbAreas: string[], mapKeys: string[]): string[] {
  const seen = new Set<string>();
  const combined: string[] = [];
  for (const a of [...dbAreas, ...mapKeys]) {
    const lower = a.toLowerCase().trim();
    if (lower && !seen.has(lower)) {
      seen.add(lower);
      combined.push(lower);
    }
  }
  return combined.sort((a, b) => b.length - a.length);
}

/**
 * Greedy left-to-right scan of `text` against the vocabulary.
 * Returns canonical DB-cased area names in match order, deduplicated.
 */
export function extractAreasFromText(
  text: string,
  vocabulary: string[],
  dbAreas: string[]
): string[] {
  const canonicalMap = new Map(dbAreas.map(a => [a.toLowerCase().trim(), a]));
  const normalized = text.toLowerCase();
  const found: string[] = [];
  const foundLower = new Set<string>();
  let i = 0;

  while (i < normalized.length) {
    let matched = false;
    for (const term of vocabulary) {
      if (normalized.startsWith(term, i)) {
        const end = i + term.length;
        const beforeOk = i === 0 || !/[a-z0-9]/.test(normalized[i - 1]);
        const afterOk = end === normalized.length || !/[a-z0-9]/.test(normalized[end]);
        if (beforeOk && afterOk && !foundLower.has(term)) {
          foundLower.add(term);
          // Prefer DB canonical casing; fall back to the matched term
          found.push(canonicalMap.get(term) ?? term);
          i = end;
          // Consume connectors: "and", "or", commas, slashes, spaces
          const connector = normalized.slice(i).match(/^(\s*(?:and|or|,|\/|\s)\s*)/);
          if (connector) i += connector[0].length;
          matched = true;
          break;
        }
      }
    }
    if (!matched) i++;
  }
  return found;
}

/**
 * Entry point: parse a raw area string (from LLM intent classifier) into individual area names.
 * Uses vocabulary matching first; falls back to comma-split for unrecognised areas.
 */
export function parseAreas(
  rawAreaString: string,
  dbAreas: string[],
  mapKeys: string[]
): string[] {
  if (!rawAreaString.trim()) return [];
  const vocabulary = buildAreaVocabulary(dbAreas, mapKeys);
  const extracted = extractAreasFromText(rawAreaString, vocabulary, dbAreas);
  if (extracted.length > 0) return extracted;
  // Fallback: comma-split for area strings not in the vocabulary
  return rawAreaString.split(',').map(s => s.trim()).filter(Boolean);
}
