/**
 * batch-research.ts — Discover and enrich ~500 new KL/Selangor spots
 *
 * Phases:
 *   0. Analyze — query DB, build area×category coverage matrix, compute gaps
 *   1. Discovery — Sonnet + web search finds real spots per gap cell
 *   2. Enrichment — Haiku + web search extracts structured details per spot
 *   3. Output — generates seed files in packages/bot/src/seeds/
 *
 * Usage:
 *   npm run research -- --dry-run           # preview gap matrix only
 *   npm run research                        # full run
 *   npm run research -- --category market   # single category
 *   npm run research -- --area "Subang Jaya"
 *   npm run research -- --city "Petaling Jaya"
 */

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

// ============================================
// CONFIG
// ============================================

const SONNET = "claude-sonnet-4-5-20250929";
const HAIKU = "claude-haiku-4-5-20251001";

const PROGRESS_FILE = join(__dirname, "research-progress.json");

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

// Area density tiers — determines how many spots to target per gap cell
const HIGH_DENSITY_AREAS = [
  "Bangsar",
  "Bukit Bintang",
  "KLCC",
  "Chinatown",
  "SS2",
  "Damansara Jaya",
];
const MEDIUM_DENSITY_AREAS = [
  "TTDI",
  "Taman Paramount",
  "Pudu",
  "Kampung Baru",
  "Section 17",
  "Damansara Uptown",
  "Chow Kit",
  "Cheras",
  "Hartamas",
  "Mont Kiara",
  "Damansara Utama",
  "Damansara Heights",
  "Taman Megah",
  "Brickfields",
  "Pavilion",
];

// New areas to add coverage for
const NEW_AREAS: { area: string; city: string }[] = [
  { area: "Subang Jaya", city: "Petaling Jaya" },
  { area: "Bandar Sunway", city: "Petaling Jaya" },
  { area: "Shah Alam", city: "Petaling Jaya" },
  { area: "Puchong", city: "Petaling Jaya" },
  { area: "Setapak", city: "Kuala Lumpur" },
  { area: "Wangsa Maju", city: "Kuala Lumpur" },
  { area: "Segambut", city: "Kuala Lumpur" },
  { area: "Ampang", city: "Kuala Lumpur" },
  { area: "Sri Petaling", city: "Kuala Lumpur" },
  { area: "Kota Damansara", city: "Petaling Jaya" },
  { area: "Cyberjaya", city: "Petaling Jaya" },
  { area: "Tropicana", city: "Petaling Jaya" },
];

// Per-category targets (total across all areas)
const CATEGORY_TARGETS: Record<Category, number> = {
  dinner: 250,
  lunch: 170,
  cafe: 100,
  breakfast: 80,
  activity: 80,
  nightlife: 70,
  market: 50,
};

// ============================================
// RATE LIMITER
// ============================================

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
    // Wait for next token
    const waitMs = (60_000 / this.rpm) * 1.1; // 10% buffer
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

const sonnetLimiter = new RateLimiter(15, 5);
const haikuLimiter = new RateLimiter(30, 10);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================
// SUPABASE + ANTHROPIC CLIENTS
// ============================================

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);
const anthropic = new Anthropic();

// ============================================
// TYPES
// ============================================

interface ExistingSpot {
  name: string;
  area: string;
  category: string;
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
  area: string;
  category: Category;
  tier: number;
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
  confidence_score: number;
  source: "llm_research";
}

interface GapCell {
  area: string;
  category: Category;
  city: string;
  current: number;
  target: number;
  needed: number;
}

interface Progress {
  completed_cells: string[]; // "area::category" keys
  discovered: Record<string, DiscoveredSpot[]>; // keyed by "area::category"
  enriched: EnrichedSpot[];
}

// ============================================
// PHASE 0: ANALYZE
// ============================================

async function loadExistingSpots(): Promise<ExistingSpot[]> {
  const { data, error } = await supabase
    .from("spots")
    .select("name, area, category, city")
    .in("city", ["Kuala Lumpur", "Petaling Jaya"]);

  if (error) throw new Error(`Failed to load spots: ${error.message}`);
  return data as ExistingSpot[];
}

function getAreaDensityTarget(area: string): number {
  if (HIGH_DENSITY_AREAS.includes(area)) return 10;
  if (MEDIUM_DENSITY_AREAS.includes(area)) return 6;
  return 4;
}

function buildCoverageMatrix(
  spots: ExistingSpot[],
  options?: { filterArea?: string; filterCategory?: string; filterCity?: string }
): {
  matrix: Record<string, Record<string, number>>;
  gaps: GapCell[];
} {
  // Count existing spots per area×category
  const matrix: Record<string, Record<string, number>> = {};
  const areaCities: Record<string, string> = {};

  for (const s of spots) {
    const area = s.area || "unknown";
    if (!matrix[area]) matrix[area] = {};
    matrix[area][s.category] = (matrix[area][s.category] || 0) + 1;
    areaCities[area] = s.city;
  }

  // Add new areas that might have zero existing spots
  for (const { area, city } of NEW_AREAS) {
    if (!matrix[area]) matrix[area] = {};
    areaCities[area] = city;
  }

  // Compute gap cells
  const gaps: GapCell[] = [];

  for (const [area, catMap] of Object.entries(matrix)) {
    const densityTarget = getAreaDensityTarget(area);
    const areaTotal = Object.values(catMap).reduce((s, n) => s + n, 0);

    // For tiny areas (0-2 spots total), only target food categories + their strongest
    const isNewArea = areaTotal <= 2;
    const catsToTarget = isNewArea
      ? CATEGORIES.filter(c => ["breakfast", "lunch", "dinner", "cafe"].includes(c))
      : CATEGORIES;

    for (const cat of catsToTarget) {
      const current = catMap[cat] || 0;
      // Scale target by area density, more conservative for low-density
      const rawTarget = densityTarget * (CATEGORY_TARGETS[cat] / 250);
      const target = Math.max(1, Math.round(rawTarget));
      const needed = Math.max(0, target - current);

      if (needed > 0) {
        gaps.push({
          area,
          category: cat,
          city: areaCities[area] || "Kuala Lumpur",
          current,
          target,
          needed: Math.min(needed, 6), // Cap at 6 per cell
        });
      }
    }
  }

  // Sort within each category: high-density areas first, then underserved
  gaps.sort((a, b) => {
    const aDensity = getAreaDensityTarget(a.area);
    const bDensity = getAreaDensityTarget(b.area);
    return bDensity - aDensity || b.needed - a.needed || a.current - b.current;
  });

  // Apply filters before budget capping
  const hasFilters = options?.filterArea || options?.filterCategory || options?.filterCity;
  let filtered = gaps;
  if (options?.filterCategory) filtered = filtered.filter(g => g.category === options.filterCategory);
  if (options?.filterArea) filtered = filtered.filter(g => g.area === options.filterArea);
  if (options?.filterCity) filtered = filtered.filter(g => g.city === options.filterCity);

  // Skip budget cap when filters are active (user is targeting specific gaps)
  let capped: GapCell[];
  if (hasFilters) {
    capped = filtered;
  } else {
    // Allocate budget proportionally across categories (matching plan targets)
    const TOTAL_BUDGET = 500;
    const CATEGORY_BUDGET: Record<Category, number> = {
      dinner: 107,
      lunch: 91,
      cafe: 52,
      activity: 49,
      breakfast: 47,
      market: 40,
      nightlife: 39,
    };
    const budgetSum = Object.values(CATEGORY_BUDGET).reduce((s, n) => s + n, 0);
    const scale = TOTAL_BUDGET / budgetSum;

    capped = [];
    for (const cat of CATEGORIES) {
      let catBudget = Math.round(CATEGORY_BUDGET[cat] * scale);
      const catGaps = filtered.filter(g => g.category === cat);
      for (const gap of catGaps) {
        if (catBudget <= 0) break;
        const take = Math.min(gap.needed, catBudget);
        capped.push({ ...gap, needed: take });
        catBudget -= take;
      }
    }
  }

  // Sort for execution: high-density first
  capped.sort((a, b) => {
    const aDensity = getAreaDensityTarget(a.area);
    const bDensity = getAreaDensityTarget(b.area);
    return bDensity - aDensity || b.needed - a.needed;
  });

  return { matrix, gaps: capped };
}

function printMatrix(
  matrix: Record<string, Record<string, number>>,
  gaps: GapCell[]
): void {
  console.log("\n=== AREA × CATEGORY COVERAGE MATRIX ===\n");
  const header =
    "Area".padEnd(25) +
    CATEGORIES.map((c) => c.padEnd(11)).join("") +
    "TOTAL";
  console.log(header);
  console.log("-".repeat(header.length));

  const sorted = Object.entries(matrix).sort((a, b) => {
    const totalA = Object.values(a[1]).reduce((s, n) => s + n, 0);
    const totalB = Object.values(b[1]).reduce((s, n) => s + n, 0);
    return totalB - totalA;
  });

  for (const [area, catMap] of sorted) {
    const total = Object.values(catMap).reduce((s, n) => s + n, 0);
    const row =
      area.padEnd(25) +
      CATEGORIES.map((c) => String(catMap[c] || 0).padEnd(11)).join("") +
      total;
    console.log(row);
  }

  console.log(`\n=== GAP SUMMARY ===`);
  console.log(`Total gap cells: ${gaps.length}`);
  console.log(
    `Total new spots needed: ${gaps.reduce((s, g) => s + g.needed, 0)}`
  );

  // Breakdown by category
  console.log("\nBy category:");
  for (const cat of CATEGORIES) {
    const catGaps = gaps.filter((g) => g.category === cat);
    const needed = catGaps.reduce((s, g) => s + g.needed, 0);
    console.log(`  ${cat.padEnd(12)} ${needed} spots across ${catGaps.length} areas`);
  }
}

// ============================================
// PHASE 1: DISCOVERY (Sonnet + web search)
// ============================================

const STYLE_GUIDE = `
CONTRIBUTOR STYLE PATTERNS (match these):
- Tier distribution: 73% tier 2 (should-do), 17% tier 1 (must-do), 10% tier 3 (hidden gem)
- Vibes: local (31%), casual (26%), chill (23%), upscale (10%), chaotic (8%), touristy (2%)
- Price: $$ (45%), $ (40%), $$$ (14%)
- Pro tips should be operational and opinionated: "Cash only", "Sells out by 1pm", "Go before 9am on weekends", "Non-halal"
- What_to_order should be specific dishes: "Nasi lemak with ayam goreng berempah", not just "nasi lemak"
- Keep it real — if a place is average, it's tier 2. Tier 1 is reserved for genuine best-in-class spots.
`;

async function discoverSpots(
  area: string,
  category: Category,
  city: string,
  existingNames: string[]
): Promise<DiscoveredSpot[]> {
  const existingList =
    existingNames.length > 0
      ? `\nALREADY IN DATABASE (do NOT include these):\n${existingNames.map((n) => `- ${n}`).join("\n")}`
      : "";

  const cityRegion = city === "Petaling Jaya" ? "Petaling Jaya / Selangor" : "Kuala Lumpur";
  const target = getAreaDensityTarget(area);
  const count = Math.min(8, Math.max(2, target));

  const prompt = `Search the web for real ${category} spots in ${area}, ${cityRegion}, Malaysia.

Find ${count} REAL places that exist right now. Each must be a specific, named establishment (not a generic description).

For each spot, provide:
- name: The exact business name
- Why it's worth including (1 sentence)

REQUIREMENTS:
- Every spot must be verifiable via web search — no fabrication
- Mix of price ranges ($, $$, $$$) weighted toward $ and $$
- Mix of vibes (local, casual, chill, upscale) weighted toward local and casual
- Focus on places locals actually go, not just tourist lists
${existingList}

Return JSON array:
[{"name": "Spot Name", "reason": "Why it's good"}]`;

  await sonnetLimiter.acquire();

  try {
    const response = await retryWithBackoff(() =>
      anthropic.messages.create({
        model: SONNET,
        max_tokens: 1024,
        temperature: 0.4,
        system:
          "You are a research assistant finding real restaurants and venues in Malaysia. Return only verified, currently-operating establishments. Use web search to verify each recommendation.",
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

    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const bareMatch = text.match(/\[[\s\S]*\]/);
    const jsonStr = fenceMatch
      ? fenceMatch[1].trim()
      : bareMatch
        ? bareMatch[0]
        : text.trim();

    const results: Array<{ name: string; reason: string }> = JSON.parse(sanitizeJSON(jsonStr));

    return results
      .filter((r) => r.name && !existingNames.some((n) => normalize(n) === normalize(r.name)))
      .map((r) => ({
        name: r.name,
        area,
        category,
        city,
      }));
  } catch (err: any) {
    console.error(`  Discovery failed for ${area}/${category}:`, err?.message || err);
    return [];
  }
}

// ============================================
// PHASE 2: ENRICHMENT (Haiku + web search)
// ============================================

async function enrichSpot(spot: DiscoveredSpot): Promise<EnrichedSpot | null> {
  const cityRegion =
    spot.city === "Petaling Jaya"
      ? "Petaling Jaya / Selangor"
      : "Kuala Lumpur";

  const prompt = `Search the web for "${spot.name}" ${spot.category} in ${spot.area}, ${cityRegion}, Malaysia.

Extract structured details about this specific establishment. Only include information you can verify from web sources.

${STYLE_GUIDE}

Return a JSON object with these fields (omit any you can't verify):
{
  "name": "exact business name",
  "address": "street address",
  "latitude": 3.xxxx,
  "longitude": 101.xxxx,
  "tier": 2,
  "price_range": "$$",
  "payment_methods": ["cash", "card"],
  "what_to_order": ["specific dish 1", "specific dish 2"],
  "what_to_skip": ["specific item to avoid and why"],
  "pro_tips": ["operational tip 1", "operational tip 2", "operational tip 3"],
  "vibe": "local",
  "best_time_of_day": "morning|afternoon|evening|late-night",
  "indoor_outdoor": "indoor|outdoor|both",
  "weather_dependent": false
}

RULES:
- what_to_order: Be specific — "Char kuey teow with duck egg", not "noodles"
- pro_tips: Must be operational — payment, timing, ordering strategy, capacity. NOT generic praise.
- tier: 1 = genuinely best-in-class destination. 2 = solid, worth a visit. 3 = hidden gem for the adventurous.
- Omit fields rather than guess. No fabricated data.`;

  await haikuLimiter.acquire();

  try {
    const response = await retryWithBackoff(() =>
      anthropic.messages.create({
        model: HAIKU,
        max_tokens: 1024,
        temperature: 0.2,
        system:
          "You are a research assistant extracting structured data about Malaysian restaurants and venues. Return only verified information. Use web search to verify details.",
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

    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const bareMatch = text.match(/\{[\s\S]*\}/);
    const jsonStr = fenceMatch
      ? fenceMatch[1].trim()
      : bareMatch
        ? bareMatch[0]
        : text.trim();

    const data = JSON.parse(sanitizeJSON(jsonStr));

    // Validate minimum quality
    if (
      !data.name ||
      (!data.what_to_order?.length && !data.pro_tips?.length)
    ) {
      console.warn(`    Skipping ${spot.name} — insufficient data from web`);
      return null;
    }

    // Assign confidence based on data completeness
    let confidence = 0.5;
    if (data.address) confidence += 0.05;
    if (data.latitude && data.longitude) confidence += 0.05;
    if (data.what_to_order?.length >= 2) confidence += 0.05;
    if (data.pro_tips?.length >= 2) confidence += 0.05;
    confidence = Math.min(0.7, confidence);

    const enriched: EnrichedSpot = {
      name: data.name || spot.name,
      city: spot.city,
      area: spot.area,
      category: spot.category,
      tier: [1, 2, 3].includes(data.tier) ? data.tier : 2,
      confidence_score: confidence,
      source: "llm_research",
    };

    // Copy optional fields only if present
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
// PHASE 3: OUTPUT
// ============================================

function generateSeedFile(spots: EnrichedSpot[], comment: string): string {
  // Group by category
  const byCategory: Record<string, EnrichedSpot[]> = {};
  for (const s of spots) {
    if (!byCategory[s.category]) byCategory[s.category] = [];
    byCategory[s.category].push(s);
  }

  // Sort categories in standard order
  const catOrder: Category[] = [
    "breakfast",
    "lunch",
    "dinner",
    "cafe",
    "activity",
    "nightlife",
    "market",
  ];

  let out = `// ${comment}\n// Auto-generated by batch-research.ts — do not hand-edit\n\nexport const spots = [\n`;

  for (const cat of catOrder) {
    const catSpots = byCategory[cat];
    if (!catSpots?.length) continue;

    out += `\n  // ============================================\n`;
    out += `  // ${cat.toUpperCase()}\n`;
    out += `  // ============================================\n`;

    // Sort by area, then name
    catSpots.sort((a, b) => a.area.localeCompare(b.area) || a.name.localeCompare(b.name));

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
  lines.push(`    area: ${JSON.stringify(s.area)},`);
  lines.push(`    category: ${JSON.stringify(s.category)},`);
  lines.push(`    tier: ${s.tier},`);
  if (s.address) lines.push(`    address: ${JSON.stringify(s.address)},`);
  if (s.latitude != null) lines.push(`    latitude: ${s.latitude},`);
  if (s.longitude != null) lines.push(`    longitude: ${s.longitude},`);
  if (s.price_range) lines.push(`    price_range: ${JSON.stringify(s.price_range)},`);
  if (s.payment_methods)
    lines.push(`    payment_methods: ${JSON.stringify(s.payment_methods)},`);
  if (s.what_to_order)
    lines.push(`    what_to_order: ${JSON.stringify(s.what_to_order)},`);
  if (s.what_to_skip)
    lines.push(`    what_to_skip: ${JSON.stringify(s.what_to_skip)},`);
  if (s.pro_tips) lines.push(`    pro_tips: ${JSON.stringify(s.pro_tips)},`);
  if (s.vibe) lines.push(`    vibe: ${JSON.stringify(s.vibe)},`);
  if (s.best_time_of_day)
    lines.push(`    best_time_of_day: ${JSON.stringify(s.best_time_of_day)},`);
  if (s.indoor_outdoor)
    lines.push(`    indoor_outdoor: ${JSON.stringify(s.indoor_outdoor)},`);
  if (s.weather_dependent != null)
    lines.push(`    weather_dependent: ${s.weather_dependent},`);
  lines.push(`    confidence_score: ${s.confidence_score},`);
  lines.push(`    source: "llm_research",`);
  lines.push(`  }`);
  return lines.join("\n  ");
}

// ============================================
// PROGRESS PERSISTENCE
// ============================================

function loadProgress(): Progress {
  if (existsSync(PROGRESS_FILE)) {
    return JSON.parse(readFileSync(PROGRESS_FILE, "utf-8"));
  }
  return { completed_cells: [], discovered: {}, enriched: [] };
}

function saveProgress(progress: Progress): void {
  writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
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

// ============================================
// MAIN
// ============================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const filterCategory = getArg(args, "--category") as Category | undefined;
  const filterArea = getArg(args, "--area");
  const filterCity = getArg(args, "--city");

  console.log("Phase 0: Loading existing spots from database...");
  const existing = await loadExistingSpots();
  console.log(`  Found ${existing.length} KL+PJ spots in DB`);

  const { matrix, gaps } = buildCoverageMatrix(existing, {
    filterArea,
    filterCategory,
    filterCity,
  });

  printMatrix(matrix, gaps);

  if (dryRun) {
    console.log("\n--dry-run: stopping before API calls");
    return;
  }

  if (gaps.length === 0) {
    console.log("\nNo gaps to fill — coverage is complete!");
    return;
  }

  // Load progress for resumability
  const progress = loadProgress();
  const existingNamesByAreaCat: Record<string, string[]> = {};

  // Pre-build existing name lookup
  for (const s of existing) {
    const key = cellKey(s.area, s.category);
    if (!existingNamesByAreaCat[key]) existingNamesByAreaCat[key] = [];
    existingNamesByAreaCat[key].push(s.name);
  }

  // Also include already-discovered spots in dedup list
  for (const [key, discovered] of Object.entries(progress.discovered)) {
    if (!existingNamesByAreaCat[key]) existingNamesByAreaCat[key] = [];
    for (const d of discovered) {
      existingNamesByAreaCat[key].push(d.name);
    }
  }

  // Phase 1: Discovery
  console.log(`\n=== PHASE 1: DISCOVERY (${gaps.length} gap cells) ===\n`);

  let discoveredTotal = 0;
  for (const gap of gaps) {
    const key = cellKey(gap.area, gap.category);
    if (progress.completed_cells.includes(key)) {
      const prev = progress.discovered[key]?.length || 0;
      discoveredTotal += prev;
      console.log(`  [skip] ${gap.area} / ${gap.category} (already completed, ${prev} spots)`);
      continue;
    }

    console.log(
      `  Discovering: ${gap.area} / ${gap.category} (need ${gap.needed})...`
    );

    // Gather all existing names for this area (across all categories) for broader dedup
    const areaNames = existing
      .filter((s) => s.area === gap.area)
      .map((s) => s.name);
    const enrichedNames = progress.enriched
      .filter((s) => s.area === gap.area)
      .map((s) => s.name);
    const allAreaNames = [...new Set([...areaNames, ...enrichedNames])];

    const discovered = await discoverSpots(
      gap.area,
      gap.category,
      gap.city,
      allAreaNames
    );

    progress.discovered[key] = discovered;
    progress.completed_cells.push(key);
    discoveredTotal += discovered.length;
    saveProgress(progress);

    console.log(
      `    Found ${discovered.length} spots: ${discovered.map((d) => d.name).join(", ")}`
    );
  }

  console.log(`\nDiscovery complete: ${discoveredTotal} total spots found`);

  // Phase 2: Enrichment
  const allDiscovered = Object.values(progress.discovered).flat();
  const alreadyEnrichedNames = new Set(
    progress.enriched.map((s) => normalize(s.name))
  );
  const toEnrich = allDiscovered.filter(
    (d) => !alreadyEnrichedNames.has(normalize(d.name))
  );

  console.log(
    `\n=== PHASE 2: ENRICHMENT (${toEnrich.length} spots to enrich, ${progress.enriched.length} already done) ===\n`
  );

  let enrichedCount = 0;
  for (const spot of toEnrich) {
    process.stdout.write(
      `  Enriching [${enrichedCount + 1}/${toEnrich.length}]: ${spot.name} (${spot.area})...`
    );

    const enriched = await enrichSpot(spot);
    if (enriched) {
      progress.enriched.push(enriched);
      console.log(
        ` OK (${enriched.what_to_order?.length || 0} orders, ${enriched.pro_tips?.length || 0} tips)`
      );
    } else {
      console.log(" SKIPPED");
    }

    enrichedCount++;

    // Save progress every 10 spots
    if (enrichedCount % 10 === 0) {
      saveProgress(progress);
    }
  }

  saveProgress(progress);
  console.log(
    `\nEnrichment complete: ${progress.enriched.length} total enriched spots`
  );

  // Phase 3: Output seed files
  console.log("\n=== PHASE 3: GENERATING SEED FILES ===\n");

  const klSpots = progress.enriched.filter((s) => s.city === "Kuala Lumpur");
  const pjSpots = progress.enriched.filter((s) => s.city === "Petaling Jaya");

  // Dedup against existing DB spots one more time
  const existingNorm = new Set(existing.map((s) => normalize(s.name)));
  const dedupedKl = klSpots.filter((s) => !existingNorm.has(normalize(s.name)));
  const dedupedPj = pjSpots.filter((s) => !existingNorm.has(normalize(s.name)));

  const klPath = join(
    __dirname,
    "..",
    "packages",
    "bot",
    "src",
    "seeds",
    "kl-research.ts"
  );
  const pjPath = join(
    __dirname,
    "..",
    "packages",
    "bot",
    "src",
    "seeds",
    "pj-research.ts"
  );

  if (dedupedKl.length > 0) {
    const klContent = generateSeedFile(
      dedupedKl,
      `KL research spots (${dedupedKl.length})`
    );
    writeFileSync(klPath, klContent);
    console.log(`  Wrote ${dedupedKl.length} KL spots to ${klPath}`);
  }

  if (dedupedPj.length > 0) {
    const pjContent = generateSeedFile(
      dedupedPj,
      `PJ/Selangor research spots (${dedupedPj.length})`
    );
    writeFileSync(pjPath, pjContent);
    console.log(`  Wrote ${dedupedPj.length} PJ spots to ${pjPath}`);
  }

  console.log("\nDone! Next steps:");
  console.log("  1. Review the generated seed files");
  console.log("  2. npm run seed");
  console.log(
    "  3. npx tsx --env-file .env.local packages/bot/src/backfill-embeddings.ts"
  );
}

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
