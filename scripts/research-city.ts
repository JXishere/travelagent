/**
 * research-city.ts — Research any city in the world and build a spot seed file
 *
 * Phases:
 *   0a. Resolve country (if not provided)
 *   0b. Discover neighborhoods — Sonnet + web search finds key areas + density classification
 *   1.  Analyze — query DB for existing city coverage, build area×category gap matrix
 *   2.  Discovery — Haiku + web search finds real spots per gap cell
 *   3.  Enrichment — Haiku + web search extracts structured details per spot
 *   4.  Output — seed file at scripts/seeds/{city-slug}.ts
 *
 * Usage:
 *   npx tsx --env-file .env.local scripts/research-city.ts --city "Bangkok" --country "Thailand"
 *   npx tsx --env-file .env.local scripts/research-city.ts --city "Tokyo" --dry-run
 *   npx tsx --env-file .env.local scripts/research-city.ts --city "Bali" --area "Seminyak" --category dinner
 *   npx tsx --env-file .env.local scripts/research-city.ts --city "Bangkok" --insert
 *   npx tsx --env-file .env.local scripts/research-city.ts --city "Bangkok" --enrich-only
 */

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

// ============================================
// CONFIG
// ============================================

const HAIKU = "claude-haiku-4-5-20251001";
const SONNET = "claude-sonnet-4-6";

const CATEGORIES = [
  "breakfast",
  "lunch",
  "dinner",
  "cafe",
  "activity",
  "nightlife",
  "market",
] as const;
type Category = (typeof CATEGORIES)[number];

// Spots to target per gap cell by area density
const DENSITY_TARGETS: Record<"major" | "moderate" | "minor", number> = {
  major: 8,
  moderate: 5,
  minor: 3,
};

// Per-category weight (relative emphasis within each area)
const CATEGORY_WEIGHT: Record<Category, number> = {
  dinner: 1.0,
  lunch: 0.8,
  cafe: 0.6,
  breakfast: 0.5,
  activity: 0.5,
  nightlife: 0.4,
  market: 0.3,
};

// ============================================
// TYPES
// ============================================

interface DiscoveredArea {
  area: string;
  density: "major" | "moderate" | "minor";
  description?: string;
}

interface ExistingSpot {
  name: string;
  area: string;
  categories: string[];
  city: string;
}

interface DiscoveredSpot {
  name: string;
  area: string;
  category: Category;
  city: string;
}

interface EnrichedSpot {
  name: string;
  city: string;
  country: string;
  area: string;
  categories: string[];
  address?: string;
  latitude?: number;
  longitude?: number;
  price_range?: string;
  payment_methods?: string[];
  what_to_order?: string[];
  what_to_skip?: string[];
  pro_tips?: string[];
  vibe?: string;
  best_time_of_day?: string;
  indoor_outdoor?: string;
  weather_dependent?: boolean;
  must_go?: boolean;
  source: "llm_research";
}

interface GapCell {
  area: string;
  category: Category;
  city: string;
  density: "major" | "moderate" | "minor";
  current: number;
  target: number;
  needed: number;
}

interface Progress {
  city: string;
  country: string;
  areas: DiscoveredArea[];
  completed_cells: string[];
  discovered: Record<string, DiscoveredSpot[]>;
  enriched: EnrichedSpot[];
}

// ============================================
// CLIENTS + RATE LIMITER
// ============================================

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);
const anthropic = new Anthropic();

class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private rpm: number,
    private maxTokens: number
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens > 0) {
      this.tokens--;
      return;
    }
    const waitMs = (60_000 / this.rpm) * 1.1;
    await sleep(waitMs);
    this.refill();
    this.tokens--;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const newTokens = (elapsed / 60_000) * this.rpm;
    this.tokens = Math.min(this.maxTokens, this.tokens + newTokens);
    this.lastRefill = now;
  }
}

const haikuLimiter = new RateLimiter(30, 10);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================
// PHASE 0a: RESOLVE COUNTRY
// ============================================

async function resolveCountry(city: string): Promise<string> {
  const response = await anthropic.messages.create({
    model: HAIKU,
    max_tokens: 50,
    system:
      "You are a geography assistant. Reply with only the country name, nothing else.",
    messages: [
      {
        role: "user",
        content: `What country is ${city} in? Reply with only the country name.`,
      },
    ],
  });

  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

// ============================================
// PHASE 0b: DISCOVER NEIGHBORHOODS
// ============================================

async function discoverCityAreas(
  city: string,
  country: string
): Promise<DiscoveredArea[]> {
  console.log(`  Searching for neighborhoods in ${city}, ${country}...`);

  const prompt = `Search the web for the main dining and nightlife neighborhoods in ${city}, ${country}.

I need 8-15 specific neighborhoods, districts, or areas that have a real food/dining/nightlife scene.

Classify each area's density:
- "major": High-density, well-known areas with dozens of venues (tourist hubs, main entertainment/dining strips)
- "moderate": Mid-tier areas with a solid local scene (residential neighborhoods with clusters of food spots)
- "minor": Smaller areas worth covering but fewer venues

Return JSON array:
[
  {"area": "Area Name", "density": "major", "description": "Brief note about this area"},
  ...
]

RULES:
- Use exact local names people actually search for
- Include a mix of tourist-known and local-favorite areas
- 8-15 areas total
- No fabrication — only real areas`;

  try {
    const response = await retryWithBackoff(() =>
      anthropic.messages.create({
        model: SONNET,
        max_tokens: 2048,
        temperature: 0.3,
        system: `You are a local city expert. Find real neighborhoods with active dining scenes in ${city}, ${country}. Use web search to verify.`,
        messages: [{ role: "user", content: prompt }],
        tools: [
          { type: "web_search_20250305", name: "web_search", max_uses: 5 },
        ],
      })
    );

    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );
    const text = textBlocks[textBlocks.length - 1]?.text || "";
    const results = parseJSONArray(text) as Array<{
      area: string;
      density: string;
      description?: string;
    }>;

    const validDensities = ["major", "moderate", "minor"] as const;
    return results
      .filter((r) => r.area && validDensities.includes(r.density as any))
      .map((r) => ({
        area: r.area,
        density: r.density as "major" | "moderate" | "minor",
        description: r.description,
      }));
  } catch (err: any) {
    console.error("  Area discovery failed:", err?.message || err);
    return [];
  }
}

// ============================================
// PHASE 1: LOAD EXISTING DB SPOTS
// ============================================

async function loadExistingSpots(city: string): Promise<ExistingSpot[]> {
  const { data, error } = await supabase
    .from("spots")
    .select("name, area, categories, city")
    .eq("city", city);

  if (error) throw new Error(`Failed to load spots: ${error.message}`);
  return (data || []) as ExistingSpot[];
}

// ============================================
// GAP MATRIX
// ============================================

function buildCoverageMatrix(
  city: string,
  areas: DiscoveredArea[],
  existing: ExistingSpot[],
  options?: { filterArea?: string; filterCategory?: string }
): GapCell[] {
  // Count existing spots per area x category
  const counts: Record<string, Record<string, number>> = {};
  for (const s of existing) {
    const area = s.area || "Unknown";
    if (!counts[area]) counts[area] = {};
    const cat = s.categories?.[0] ?? "unknown";
    counts[area][cat] = (counts[area][cat] || 0) + 1;
  }

  // Ensure all discovered areas are represented
  for (const a of areas) {
    if (!counts[a.area]) counts[a.area] = {};
  }

  const gaps: GapCell[] = [];

  for (const a of areas) {
    const catMap = counts[a.area] || {};
    const densityTarget = DENSITY_TARGETS[a.density];

    for (const cat of CATEGORIES) {
      const current = catMap[cat] || 0;
      const target = Math.max(
        1,
        Math.round(densityTarget * CATEGORY_WEIGHT[cat])
      );
      const needed = Math.max(0, target - current);

      if (needed > 0) {
        gaps.push({
          area: a.area,
          category: cat,
          city,
          density: a.density,
          current,
          target,
          needed: Math.min(needed, 8),
        });
      }
    }
  }

  // Apply filters
  let filtered = gaps;
  if (options?.filterCategory) {
    filtered = filtered.filter((g) => g.category === options.filterCategory);
  }
  if (options?.filterArea) {
    filtered = filtered.filter(
      (g) => g.area.toLowerCase() === options.filterArea!.toLowerCase()
    );
  }

  // Sort: major areas first, then by needed desc
  filtered.sort((a, b) => {
    const order = { major: 0, moderate: 1, minor: 2 };
    return order[a.density] - order[b.density] || b.needed - a.needed;
  });

  return filtered;
}

function printMatrix(
  areas: DiscoveredArea[],
  gaps: GapCell[],
  existing: ExistingSpot[]
): void {
  console.log("\n=== AREA x CATEGORY COVERAGE MATRIX ===\n");

  const header =
    "Area".padEnd(25) +
    "Density".padEnd(10) +
    CATEGORIES.map((c) => c.padEnd(11)).join("") +
    "TOTAL";
  console.log(header);
  console.log("-".repeat(header.length));

  const counts: Record<string, Record<string, number>> = {};
  for (const s of existing) {
    const area = s.area || "Unknown";
    if (!counts[area]) counts[area] = {};
    const cat = s.categories?.[0] ?? "unknown";
    counts[area][cat] = (counts[area][cat] || 0) + 1;
  }

  for (const a of areas) {
    const catMap = counts[a.area] || {};
    const total = Object.values(catMap).reduce((s, n) => s + n, 0);
    const row =
      a.area.padEnd(25) +
      a.density.padEnd(10) +
      CATEGORIES.map((c) => String(catMap[c] || 0).padEnd(11)).join("") +
      total;
    console.log(row);
  }

  console.log(`\n=== GAP SUMMARY ===`);
  console.log(`Total gap cells: ${gaps.length}`);
  console.log(
    `Total new spots needed: ${gaps.reduce((s, g) => s + g.needed, 0)}`
  );

  console.log("\nBy category:");
  for (const cat of CATEGORIES) {
    const catGaps = gaps.filter((g) => g.category === cat);
    const needed = catGaps.reduce((s, g) => s + g.needed, 0);
    console.log(
      `  ${cat.padEnd(12)} ${needed} spots across ${catGaps.length} areas`
    );
  }
}

// ============================================
// PHASE 2: DISCOVERY
// ============================================

const STYLE_GUIDE = `
QUALITY GUIDELINES:
- ~15% must_go spots (genuinely best-in-class, can't-miss)
- Mix vibes: local, casual, chill, upscale, chaotic, touristy (weighted toward local and casual)
- Mix prices: weighted toward $ and $$ over $$$
- Focus on places locals actually go, not just tourist traps
- Pro tips must be operational: payment methods, timing, what to avoid, capacity notes
- what_to_order must be specific dish/item names, not generic descriptions`;

async function discoverSpots(
  area: string,
  category: Category,
  city: string,
  country: string,
  existingNames: string[]
): Promise<DiscoveredSpot[]> {
  const existingList =
    existingNames.length > 0
      ? `\nALREADY IN DATABASE (do NOT include these):\n${existingNames.map((n) => `- ${n}`).join("\n")}`
      : "";

  const prompt = `Search the web for real ${category} spots in ${area}, ${city}, ${country}.

Find 6 REAL places that currently exist. Each must be a specific, named establishment (not a generic description).

For each spot provide:
- name: Exact business name
- reason: Why it's worth including (1 sentence)

REQUIREMENTS:
- Every spot must be verifiable via web search — no fabrication
- Mix of price ranges weighted toward affordable options
- Include local favorites, not just tourist-facing places
${existingList}

Return JSON array:
[{"name": "Spot Name", "reason": "Why it's good"}]`;

  await haikuLimiter.acquire();

  try {
    const response = await retryWithBackoff(() =>
      anthropic.messages.create({
        model: HAIKU,
        max_tokens: 1024,
        temperature: 0.4,
        system: `You are a research assistant finding real restaurants and venues in ${country}. Return only verified, currently-operating establishments.`,
        messages: [{ role: "user", content: prompt }],
        tools: [
          { type: "web_search_20250305", name: "web_search", max_uses: 5 },
        ],
      })
    );

    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );
    const text = textBlocks[textBlocks.length - 1]?.text || "";
    const results: Array<{ name: string; reason: string }> =
      parseJSONArray(text);

    return results
      .filter(
        (r) =>
          r.name &&
          !existingNames.some((n) => normalize(n) === normalize(r.name))
      )
      .map((r) => ({ name: r.name, area, category, city }));
  } catch (err: any) {
    console.error(
      `  Discovery failed for ${area}/${category}:`,
      err?.message || err
    );
    return [];
  }
}

// ============================================
// PHASE 3: ENRICHMENT
// ============================================

async function enrichSpot(
  spot: DiscoveredSpot,
  country: string
): Promise<EnrichedSpot | null> {
  const prompt = `Search the web for "${spot.name}" ${spot.category} in ${spot.area}, ${spot.city}, ${country}.

Extract structured details about this specific establishment. Only include information you can verify from web sources.

${STYLE_GUIDE}

Return a JSON object (omit any fields you cannot verify):
{
  "name": "exact business name",
  "address": "street address",
  "latitude": 0.0000,
  "longitude": 0.0000,
  "must_go": false,
  "price_range": "$$",
  "payment_methods": ["cash", "card"],
  "what_to_order": ["specific item 1", "specific item 2"],
  "what_to_skip": ["item to avoid and why"],
  "pro_tips": ["operational tip 1", "tip 2", "tip 3"],
  "vibe": "local",
  "best_time_of_day": "morning|afternoon|evening|late-night",
  "indoor_outdoor": "indoor|outdoor|both",
  "weather_dependent": false
}

RULES:
- what_to_order: Specific dish names, not generic categories
- pro_tips: Payment, timing, ordering strategy, capacity — NOT generic praise
- must_go: true = genuinely best-in-class, can't-miss. false = solid, worth a visit
- Omit fields rather than fabricate`;

  await haikuLimiter.acquire();

  try {
    const response = await retryWithBackoff(() =>
      anthropic.messages.create({
        model: HAIKU,
        max_tokens: 1024,
        temperature: 0.2,
        system: `You are a research assistant extracting structured data about restaurants and venues in ${country}. Return only verified information.`,
        messages: [{ role: "user", content: prompt }],
        tools: [
          { type: "web_search_20250305", name: "web_search", max_uses: 3 },
        ],
      })
    );

    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );
    const text = textBlocks[textBlocks.length - 1]?.text || "";
    const data = parseJSONObject(text);

    if (!data.name || (!data.what_to_order?.length && !data.pro_tips?.length)) {
      const keys = Object.keys(data);
      if (keys.length === 0) {
        console.warn(`    Skipping ${spot.name} — empty parse`);
      } else {
        console.warn(
          `    Skipping ${spot.name} — insufficient data (keys: ${keys.join(", ")})`
        );
      }
      return null;
    }

    const enriched: EnrichedSpot = {
      name: data.name || spot.name,
      city: spot.city,
      country,
      area: spot.area,
      categories: [spot.category],
      source: "llm_research",
    };

    if (data.must_go === true) enriched.must_go = true;
    if (data.address) enriched.address = data.address;
    if (data.latitude && data.longitude) {
      enriched.latitude = Number(data.latitude);
      enriched.longitude = Number(data.longitude);
    }
    if (["$", "$$", "$$$"].includes(data.price_range))
      enriched.price_range = data.price_range;
    if (Array.isArray(data.payment_methods) && data.payment_methods.length)
      enriched.payment_methods = data.payment_methods;
    if (Array.isArray(data.what_to_order) && data.what_to_order.length)
      enriched.what_to_order = data.what_to_order;
    if (Array.isArray(data.what_to_skip) && data.what_to_skip.length)
      enriched.what_to_skip = data.what_to_skip;
    if (Array.isArray(data.pro_tips) && data.pro_tips.length)
      enriched.pro_tips = data.pro_tips;
    if (
      ["casual", "upscale", "chaotic", "chill", "local", "touristy"].includes(
        data.vibe
      )
    )
      enriched.vibe = data.vibe;
    if (
      ["morning", "afternoon", "evening", "late-night"].includes(
        data.best_time_of_day
      )
    )
      enriched.best_time_of_day = data.best_time_of_day;
    if (["indoor", "outdoor", "both"].includes(data.indoor_outdoor))
      enriched.indoor_outdoor = data.indoor_outdoor;
    if (typeof data.weather_dependent === "boolean")
      enriched.weather_dependent = data.weather_dependent;

    return enriched;
  } catch (err) {
    console.error(`    Enrichment failed for ${spot.name}:`, err);
    return null;
  }
}

// ============================================
// PHASE 4: OUTPUT
// ============================================

function generateSeedFile(
  spots: EnrichedSpot[],
  city: string,
  country: string
): string {
  const byCategory: Record<string, EnrichedSpot[]> = {};
  for (const s of spots) {
    const cat0 = s.categories?.[0] ?? "unknown";
    if (!byCategory[cat0]) byCategory[cat0] = [];
    byCategory[cat0].push(s);
  }

  const catOrder: Category[] = [
    "breakfast",
    "lunch",
    "dinner",
    "cafe",
    "activity",
    "nightlife",
    "market",
  ];

  const date = new Date().toISOString().split("T")[0];
  const areaCount = new Set(spots.map((s) => s.area)).size;
  let out = `// ${city}, ${country} — auto-generated by research-city.ts on ${date}\n`;
  out += `// ${spots.length} spots across ${areaCount} areas\n`;
  out += `// Review before seeding: check must_go flags, verify addresses, spot-check pro_tips\n`;
  out += `\nexport const spots = [\n`;

  for (const cat of catOrder) {
    const catSpots = byCategory[cat];
    if (!catSpots?.length) continue;

    out += `\n  // ============================================\n`;
    out += `  // ${cat.toUpperCase()}\n`;
    out += `  // ============================================\n`;

    catSpots.sort(
      (a, b) => a.area.localeCompare(b.area) || a.name.localeCompare(b.name)
    );

    for (const s of catSpots) {
      out += `  ${formatSpotObject(s)},\n`;
    }
  }

  out += `];\n`;
  return out;
}

function formatSpotObject(s: EnrichedSpot): string {
  const lines: string[] = [];
  lines.push(`{`);
  lines.push(`    name: ${JSON.stringify(s.name)},`);
  lines.push(`    city: ${JSON.stringify(s.city)},`);
  lines.push(`    country: ${JSON.stringify(s.country)},`);
  lines.push(`    area: ${JSON.stringify(s.area)},`);
  lines.push(`    categories: ${JSON.stringify(s.categories)},`);
  if (s.must_go) lines.push(`    must_go: true,`);
  if (s.address) lines.push(`    address: ${JSON.stringify(s.address)},`);
  if (s.latitude != null) lines.push(`    latitude: ${s.latitude},`);
  if (s.longitude != null) lines.push(`    longitude: ${s.longitude},`);
  if (s.price_range)
    lines.push(`    price_range: ${JSON.stringify(s.price_range)},`);
  if (s.payment_methods)
    lines.push(`    payment_methods: ${JSON.stringify(s.payment_methods)},`);
  if (s.what_to_order)
    lines.push(`    what_to_order: ${JSON.stringify(s.what_to_order)},`);
  if (s.what_to_skip)
    lines.push(`    what_to_skip: ${JSON.stringify(s.what_to_skip)},`);
  if (s.pro_tips) lines.push(`    pro_tips: ${JSON.stringify(s.pro_tips)},`);
  if (s.vibe) lines.push(`    vibe: ${JSON.stringify(s.vibe)},`);
  if (s.best_time_of_day)
    lines.push(
      `    best_time_of_day: ${JSON.stringify(s.best_time_of_day)},`
    );
  if (s.indoor_outdoor)
    lines.push(`    indoor_outdoor: ${JSON.stringify(s.indoor_outdoor)},`);
  if (s.weather_dependent != null)
    lines.push(`    weather_dependent: ${s.weather_dependent},`);
  lines.push(`    source: "llm_research",`);
  lines.push(`  }`);
  return lines.join("\n  ");
}

// ============================================
// DB INSERT (--insert flag)
// ============================================

async function insertSpots(
  spots: EnrichedSpot[],
  city: string
): Promise<void> {
  const { data: existing } = await supabase
    .from("spots")
    .select("name")
    .eq("city", city);

  const existingNames = new Set(
    (existing || []).map((s: any) => normalize(s.name))
  );
  const newSpots = spots.filter((s) => !existingNames.has(normalize(s.name)));

  console.log(
    `\nInserting ${newSpots.length} new spots (${spots.length - newSpots.length} duplicates skipped)...`
  );

  let inserted = 0;
  for (const spot of newSpots) {
    const { error } = await supabase.from("spots").insert({
      ...spot,
      input_method: "llm_research",
    });
    if (error) {
      console.error(`  Failed: ${spot.name} — ${error.message}`);
    } else {
      console.log(`  + ${spot.name} (${spot.area})`);
      inserted++;
    }
  }
  console.log(`\nInserted ${inserted} spots.`);
}

// ============================================
// PROGRESS PERSISTENCE
// ============================================

function progressFilePath(slug: string): string {
  return join(__dirname, `research-${slug}-progress.json`);
}

function loadProgress(slug: string, city: string, country: string): Progress {
  const path = progressFilePath(slug);
  if (existsSync(path)) {
    return JSON.parse(readFileSync(path, "utf-8"));
  }
  return {
    city,
    country,
    areas: [],
    completed_cells: [],
    discovered: {},
    enriched: [],
  };
}

function saveProgress(slug: string, progress: Progress): void {
  writeFileSync(progressFilePath(slug), JSON.stringify(progress, null, 2));
}

function cellKey(area: string, category: string): string {
  return `${area}::${category}`;
}

// ============================================
// RETRY WITH BACKOFF
// ============================================

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.status || err?.error?.status;
      if ((status === 429 || status === 529) && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 5000 + Math.random() * 2000;
        console.warn(
          `    Rate limited (${status}), retrying in ${Math.round(delay / 1000)}s...`
        );
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Max retries exceeded");
}

// ============================================
// UTILS
// ============================================

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function cityToSlug(city: string): string {
  return city
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

function sanitizeJSON(str: string): string {
  return str.replace(/[\x00-\x1F\x7F]/g, (ch) => {
    if (ch === "\n" || ch === "\r" || ch === "\t") return ch;
    return "";
  });
}

function parseJSONArray(text: string): any[] {
  const clean = sanitizeJSON(text);
  const fenceMatch = clean.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {}
  }
  const start = clean.indexOf("[");
  if (start !== -1) {
    let depth = 0;
    for (let i = start; i < clean.length; i++) {
      if (clean[i] === "[") depth++;
      else if (clean[i] === "]") depth--;
      if (depth === 0) {
        try {
          return JSON.parse(clean.slice(start, i + 1));
        } catch {}
        break;
      }
    }
  }
  try {
    return JSON.parse(clean.trim());
  } catch {}
  return [];
}

function parseJSONObject(text: string): Record<string, any> {
  const clean = sanitizeJSON(text);
  const fenceMatch = clean.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {}
  }
  const start = clean.indexOf("{");
  if (start !== -1) {
    let depth = 0;
    for (let i = start; i < clean.length; i++) {
      if (clean[i] === "{") depth++;
      else if (clean[i] === "}") depth--;
      if (depth === 0) {
        try {
          return JSON.parse(clean.slice(start, i + 1));
        } catch {}
        break;
      }
    }
  }
  try {
    return JSON.parse(clean.trim());
  } catch {}
  return {};
}

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

// ============================================
// MAIN
// ============================================

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
research-city.ts — Research any city in the world

Usage:
  npx tsx --env-file .env.local scripts/research-city.ts --city <city> [options]

Required:
  --city <city>        City to research (e.g. "Bangkok", "Tokyo", "Lisbon")

Options:
  --country <country>  Country name (auto-detected if omitted)
  --area <area>        Only research one specific neighborhood
  --category <cat>     Only research one category (breakfast|lunch|dinner|cafe|activity|nightlife|market)
  --dry-run            Preview gap matrix without making discovery/enrichment API calls
  --enrich-only        Skip discovery, only enrich already-discovered spots
  --insert             Insert results to database after research completes
  --help               Show this help

Output:
  scripts/seeds/<city-slug>.ts                   Seed file for review
  scripts/research-<city-slug>-progress.json     Resumable progress (delete to restart)

Examples:
  npx tsx --env-file .env.local scripts/research-city.ts --city "Bangkok" --country "Thailand"
  npx tsx --env-file .env.local scripts/research-city.ts --city "Tokyo" --dry-run
  npx tsx --env-file .env.local scripts/research-city.ts --city "Lisbon" --area "Bairro Alto" --category dinner
  npx tsx --env-file .env.local scripts/research-city.ts --city "Bangkok" --insert
`);
    return;
  }

  const city = getArg(args, "--city");
  if (!city) {
    console.error("Error: --city is required. Run with --help for usage.");
    process.exit(1);
  }

  const dryRun = args.includes("--dry-run");
  const enrichOnly = args.includes("--enrich-only");
  const insertToDB = args.includes("--insert");
  const filterCategory = getArg(args, "--category") as Category | undefined;
  const filterArea = getArg(args, "--area");

  if (filterCategory && !CATEGORIES.includes(filterCategory)) {
    console.error(
      `Invalid category "${filterCategory}". Valid: ${CATEGORIES.join(", ")}`
    );
    process.exit(1);
  }

  const slug = cityToSlug(city);

  // Phase 0a: Resolve country
  let country = getArg(args, "--country");
  if (!country) {
    process.stdout.write(`Phase 0a: Resolving country for "${city}"...`);
    country = await resolveCountry(city);
    console.log(` ${country}`);
  } else {
    console.log(`City: ${city}, ${country}`);
  }

  // Load resumable progress
  const progress = loadProgress(slug, city, country);

  // Phase 0b: Discover neighborhoods
  if (filterArea) {
    // Single-area mode: skip neighborhood discovery
    if (
      !progress.areas.find(
        (a) => a.area.toLowerCase() === filterArea.toLowerCase()
      )
    ) {
      progress.areas = [{ area: filterArea, density: "moderate" }];
      saveProgress(slug, progress);
    }
    console.log(`\nPhase 0b: Single-area mode — ${filterArea}`);
  } else if (progress.areas.length === 0) {
    console.log("\nPhase 0b: Discovering neighborhoods...");
    const areas = await discoverCityAreas(city, country);
    if (areas.length === 0) {
      console.error(
        "  Failed to discover any neighborhoods. Try --area <name> to research a specific area manually."
      );
      process.exit(1);
    }
    progress.areas = areas;
    saveProgress(slug, progress);
    console.log(`  Found ${areas.length} neighborhoods:`);
    for (const a of areas) {
      const desc = a.description ? ` — ${a.description}` : "";
      console.log(`    ${a.density.padEnd(10)} ${a.area}${desc}`);
    }
  } else {
    console.log(
      `\nPhase 0b: Using ${progress.areas.length} previously discovered neighborhoods (delete progress file to re-discover)`
    );
    for (const a of progress.areas) {
      console.log(`    ${a.density.padEnd(10)} ${a.area}`);
    }
  }

  // Phase 1: Load existing DB spots
  console.log(`\nPhase 1: Loading existing "${city}" spots from database...`);
  const existing = await loadExistingSpots(city);
  console.log(`  Found ${existing.length} existing spots`);

  // Build gap matrix
  const gaps = buildCoverageMatrix(city, progress.areas, existing, {
    filterArea,
    filterCategory,
  });
  printMatrix(progress.areas, gaps, existing);

  if (dryRun) {
    console.log("\n--dry-run: stopping before API calls");
    return;
  }

  if (gaps.length === 0) {
    console.log("\nNo gaps to fill — coverage looks complete!");
    return;
  }

  // Build existing name lookup for per-area dedup
  const existingNamesByArea: Record<string, string[]> = {};
  for (const s of existing) {
    const area = s.area || "Unknown";
    if (!existingNamesByArea[area]) existingNamesByArea[area] = [];
    existingNamesByArea[area].push(s.name);
  }
  for (const [key, discovered] of Object.entries(progress.discovered)) {
    const area = key.split("::")[0];
    if (!existingNamesByArea[area]) existingNamesByArea[area] = [];
    for (const d of discovered) existingNamesByArea[area].push(d.name);
  }

  // Phase 2: Discovery
  if (enrichOnly) {
    console.log("\n--enrich-only: skipping discovery\n");
  } else {
    console.log(`\n=== PHASE 2: DISCOVERY (${gaps.length} gap cells) ===\n`);

    for (const gap of gaps) {
      const key = cellKey(gap.area, gap.category);
      if (progress.completed_cells.includes(key)) {
        const prev = progress.discovered[key]?.length || 0;
        console.log(
          `  [skip] ${gap.area} / ${gap.category} (${prev} already found)`
        );
        continue;
      }

      console.log(
        `  Discovering: ${gap.area} / ${gap.category} (need ${gap.needed})...`
      );

      const areaNames = [
        ...(existingNamesByArea[gap.area] || []),
        ...progress.enriched
          .filter((s) => s.area === gap.area)
          .map((s) => s.name),
      ];

      const discovered = await discoverSpots(
        gap.area,
        gap.category,
        city,
        country,
        [...new Set(areaNames)]
      );

      progress.discovered[key] = discovered;
      progress.completed_cells.push(key);
      saveProgress(slug, progress);

      console.log(
        `    Found ${discovered.length}: ${discovered.map((d) => d.name).join(", ")}`
      );
    }

    const totalFound = Object.values(progress.discovered).flat().length;
    console.log(`\nDiscovery complete: ${totalFound} spots found`);
  }

  // Phase 3: Enrichment
  const allDiscovered = Object.values(progress.discovered).flat();
  const alreadyEnrichedNames = new Set(
    progress.enriched.map((s) => normalize(s.name))
  );
  const toEnrich = allDiscovered.filter(
    (d) => !alreadyEnrichedNames.has(normalize(d.name))
  );

  console.log(
    `\n=== PHASE 3: ENRICHMENT (${toEnrich.length} new, ${progress.enriched.length} already done) ===\n`
  );

  let enrichedCount = 0;
  for (const spot of toEnrich) {
    process.stdout.write(
      `  [${enrichedCount + 1}/${toEnrich.length}] ${spot.name} (${spot.area})...`
    );

    const enriched = await enrichSpot(spot, country);
    if (enriched) {
      progress.enriched.push(enriched);
      console.log(
        ` OK (${enriched.what_to_order?.length || 0} orders, ${enriched.pro_tips?.length || 0} tips)`
      );
    } else {
      console.log(" SKIPPED");
    }

    enrichedCount++;
    if (enrichedCount % 10 === 0) saveProgress(slug, progress);
  }

  saveProgress(slug, progress);
  console.log(
    `\nEnrichment complete: ${progress.enriched.length} total enriched spots`
  );

  // Phase 4: Output
  console.log("\n=== PHASE 4: OUTPUT ===\n");

  const seedsDir = join(__dirname, "seeds");
  if (!existsSync(seedsDir)) mkdirSync(seedsDir, { recursive: true });

  const outPath = join(seedsDir, `${slug}.ts`);

  // Final dedup against existing DB
  const existingNorm = new Set(existing.map((s) => normalize(s.name)));
  const newSpots = progress.enriched.filter(
    (s) => !existingNorm.has(normalize(s.name))
  );

  if (newSpots.length === 0) {
    console.log("No new spots to write (all already in DB).");
    return;
  }

  const content = generateSeedFile(newSpots, city, country);
  writeFileSync(outPath, content);

  const coveredAreas = [...new Set(newSpots.map((s) => s.area))];
  console.log(`Wrote ${newSpots.length} spots to ${outPath}`);
  console.log(`  Areas: ${coveredAreas.join(", ")}`);
  console.log(`  must_go: ${newSpots.filter((s) => s.must_go).length} spots`);

  if (insertToDB) {
    await insertSpots(newSpots, city);
    console.log("\nNext: backfill embeddings to enable semantic search");
    console.log(
      "  npx tsx --env-file .env.local packages/bot/src/backfill-embeddings.ts"
    );
  } else {
    console.log("\nNext steps:");
    console.log(`  1. Review ${outPath}`);
    console.log(`  2. Re-run with --insert to push to database`);
    console.log(
      `  3. npx tsx --env-file .env.local packages/bot/src/backfill-embeddings.ts`
    );
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
