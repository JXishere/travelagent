import { describe, it, expect } from "vitest";
import { buildAreaVocabulary, extractAreasFromText, parseAreas } from "./area-extractor.js";

// Sample DB areas (canonical casing from DB)
const DB_AREAS = [
  "SS2", "SS23", "Taman Megah", "Bangsar", "KLCC", "TTDI",
  "Bukit Bintang", "Damansara Utama", "PJ Old Town",
];

// Map keys (lowercased aliases from AREA_CITY_MAP)
const MAP_KEYS = [
  "pj", "ss2", "ss23", "taman megah", "bangsar", "klcc", "ttdi",
  "bukit bintang", "damansara utama", "kl", "petaling jaya", "kuala lumpur",
];

describe("buildAreaVocabulary", () => {
  it("deduplicates and sorts longest-first", () => {
    const vocab = buildAreaVocabulary(["SS2", "Taman Megah"], ["ss2", "taman megah", "pj"]);
    // "taman megah" (10) should come before "ss2" (3) and "pj" (2)
    expect(vocab[0]).toBe("taman megah");
    expect(vocab).not.toContain("SS2"); // only lowercase stored
    // ss2 should appear once despite appearing in both arrays
    expect(vocab.filter(v => v === "ss2").length).toBe(1);
  });
});

describe("extractAreasFromText", () => {
  const vocab = buildAreaVocabulary(DB_AREAS, MAP_KEYS);

  it("handles space-separated area codes", () => {
    const result = extractAreasFromText("ss2 ss23 and taman megah", vocab, DB_AREAS);
    expect(result).toEqual(["SS2", "SS23", "Taman Megah"]);
  });

  it("handles comma-separated areas", () => {
    const result = extractAreasFromText("SS2, SS23, Bangsar", vocab, DB_AREAS);
    expect(result).toEqual(["SS2", "SS23", "Bangsar"]);
  });

  it("handles slash separator", () => {
    const result = extractAreasFromText("bangsar/klcc", vocab, DB_AREAS);
    expect(result).toEqual(["Bangsar", "KLCC"]);
  });

  it("handles 'or' separator", () => {
    const result = extractAreasFromText("near ttdi or ss2", vocab, DB_AREAS);
    expect(result).toEqual(["TTDI", "SS2"]);
  });

  it("extracts area from natural language", () => {
    const result = extractAreasFromText("dinner near bangsar", vocab, DB_AREAS);
    expect(result).toEqual(["Bangsar"]);
  });

  it("enforces word boundaries — ss2 not matched inside a word", () => {
    const result = extractAreasFromText("boss2day", vocab, DB_AREAS);
    expect(result).toEqual([]);
  });

  it("deduplicates repeated areas", () => {
    const result = extractAreasFromText("ss2 ss2", vocab, DB_AREAS);
    expect(result).toEqual(["SS2"]);
  });

  it("returns canonical DB casing not lowercase", () => {
    const result = extractAreasFromText("bangsar", vocab, DB_AREAS);
    expect(result).toEqual(["Bangsar"]);
  });
});

describe("parseAreas", () => {
  it("returns extracted areas when vocabulary matches", () => {
    const result = parseAreas("ss2 ss23 and taman megah", DB_AREAS, MAP_KEYS);
    expect(result).toEqual(["SS2", "SS23", "Taman Megah"]);
  });

  it("falls back to comma-split for unknown areas", () => {
    const result = parseAreas("Foo Bar, Baz District", DB_AREAS, MAP_KEYS);
    expect(result).toEqual(["Foo Bar", "Baz District"]);
  });

  it("returns empty array for empty string", () => {
    expect(parseAreas("", DB_AREAS, MAP_KEYS)).toEqual([]);
    expect(parseAreas("   ", DB_AREAS, MAP_KEYS)).toEqual([]);
  });

  it("handles single area", () => {
    const result = parseAreas("Bangsar", DB_AREAS, MAP_KEYS);
    expect(result).toEqual(["Bangsar"]);
  });
});
