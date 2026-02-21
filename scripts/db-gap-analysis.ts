/**
 * db-gap-analysis.ts — Offline knowledge graph gap analysis
 *
 * Queries Supabase directly (no live servers needed) and surfaces:
 *   1. Missing operational fields by city
 *   2. Area × category coverage voids (< 3 spots)
 *   3. Embedding gaps (spots invisible to semantic search)
 *   4. Source distribution (verified vs llm_research)
 *   5. Worst offenders (most missing fields)
 *
 * Usage:
 *   npm run db-gap             # full report
 *   npm run db-gap -- --city "Kuala Lumpur"   # filter by city
 */

import { createClient } from "@supabase/supabase-js";

const CATEGORIES = [
  "breakfast",
  "lunch",
  "dinner",
  "cafe",
  "activity",
  "nightlife",
  "market",
];

// ─── Output helpers ────────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  grey: "\x1b[90m",
  magenta: "\x1b[35m",
};

function section(title: string) {
  const bar = "═".repeat(60);
  console.log();
  console.log(`${C.bold}${C.cyan}${bar}${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ${title}${C.reset}`);
  console.log(`${C.bold}${C.cyan}${bar}${C.reset}`);
}

function subsection(title: string) {
  console.log();
  console.log(`${C.bold}${C.yellow}  ▸ ${title}${C.reset}`);
}

function row(label: string, value: string | number, warn = false) {
  const col = warn ? C.red : C.grey;
  console.log(`    ${label.padEnd(35)} ${col}${value}${C.reset}`);
}

function pct(count: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((count / total) * 100)}%`;
}

function gap(count: number, total: number): string {
  const p = Math.round((count / total) * 100);
  const color = p > 50 ? C.red : p > 20 ? C.yellow : C.grey;
  return `${color}${count} / ${total} (${p}% missing)${C.reset}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_KEY!
  );

  const cityFilter = (() => {
    const idx = process.argv.indexOf("--city");
    return idx !== -1 ? process.argv[idx + 1] : null;
  })();

  console.log(
    `\n${C.bold}Sam — Knowledge Graph Gap Analysis${C.reset}  ${C.grey}${new Date().toISOString()}${C.reset}`
  );
  if (cityFilter) console.log(`${C.grey}City filter: ${cityFilter}${C.reset}`);

  // ── Fetch all spots (select only needed fields) ──────────────────────────────
  let query = sb.from("spots").select(
    "id,name,city,area,categories,source,verified,must_go,address,price_range,vibe,opening_hours,payment_methods,what_to_order,pro_tips,embedding"
  );
  if (cityFilter) query = query.eq("city", cityFilter);

  const { data: spots, error } = await query;
  if (error || !spots) {
    console.error(`${C.red}DB error:${C.reset}`, error);
    process.exit(1);
  }

  const total = spots.length;

  // ─────────────────────────────────────────────────────────────────────────────
  // SECTION 1: Summary by city
  // ─────────────────────────────────────────────────────────────────────────────
  section("1. Coverage by City");

  const byCityMap = new Map<string, typeof spots>();
  for (const s of spots) {
    const city = s.city ?? "unknown";
    if (!byCityMap.has(city)) byCityMap.set(city, []);
    byCityMap.get(city)!.push(s);
  }

  for (const [city, citySpots] of [...byCityMap.entries()].sort(
    (a, b) => b[1].length - a[1].length
  )) {
    const verified = citySpots.filter((s) => s.verified).length;
    const unverified = citySpots.length - verified;
    const withEmbed = citySpots.filter((s) => s.embedding !== null).length;
    console.log(
      `\n  ${C.bold}${city}${C.reset}  ${C.grey}(${citySpots.length} spots)${C.reset}`
    );
    row("Verified (human/seed)", `${verified} (${pct(verified, citySpots.length)})`);
    row(
      "Unverified (llm_research)",
      `${unverified} (${pct(unverified, citySpots.length)})`,
      unverified > verified
    );
    row("With embeddings (searchable)", `${withEmbed} (${pct(withEmbed, citySpots.length)})`, withEmbed < citySpots.length * 0.9);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SECTION 2: Missing operational fields
  // ─────────────────────────────────────────────────────────────────────────────
  section("2. Missing Operational Fields");
  console.log(`  ${C.grey}Total spots: ${total}${C.reset}`);

  // Note: opening_hours and payment_methods are intentionally NULL —
  // cleared by migration 20260220_000000 (fetched live via web search instead).
  const missing = {
    address: spots.filter((s) => !s.address || s.address.trim() === "").length,
    price_range: spots.filter((s) => !s.price_range).length,
    vibe: spots.filter((s) => !s.vibe).length,
    what_to_order: spots.filter(
      (s) => !s.what_to_order || (s.what_to_order as string[]).length === 0
    ).length,
    pro_tips: spots.filter(
      (s) => !s.pro_tips || (s.pro_tips as string[]).length === 0
    ).length,
    embedding: spots.filter((s) => !s.embedding).length,
  };

  const fieldLabels: Record<string, string> = {
    address: "Address",
    price_range: "Price range ($, $$, $$$)",
    vibe: "Vibe",
    what_to_order: "What to order",
    pro_tips: "Pro tips",
    embedding: "Embedding (invisible to search!)",
  };

  for (const [field, count] of Object.entries(missing)) {
    const warn = count > total * 0.1 || (field === "embedding" && count > 0);
    const label = fieldLabels[field];
    console.log(`\n    ${label}`);
    console.log(`      ${gap(count, total)}`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SECTION 3: Missing fields by source
  // ─────────────────────────────────────────────────────────────────────────────
  section("3. Field Completeness by Source");

  const sources = [...new Set(spots.map((s) => s.source ?? "unknown"))].sort();
  const keyFields = ["address", "what_to_order", "vibe", "pro_tips", "price_range"] as const;

  for (const source of sources) {
    const sourceSpots = spots.filter((s) => (s.source ?? "unknown") === source);
    const n = sourceSpots.length;
    console.log(`\n  ${C.bold}${source}${C.reset}  ${C.grey}(${n} spots)${C.reset}`);

    for (const field of keyFields) {
      let missing = 0;
      if (field === "what_to_order" || field === "pro_tips") {
        missing = sourceSpots.filter(
          (s) => !s[field] || (s[field] as string[]).length === 0
        ).length;
      } else {
        missing = sourceSpots.filter(
          (s) => !s[field as keyof typeof s] || (s[field as keyof typeof s] as string) === ""
        ).length;
      }
      const p = Math.round((missing / n) * 100);
      const color = p > 70 ? C.red : p > 30 ? C.yellow : C.green;
      console.log(
        `    ${field.padEnd(20)} ${color}${missing}/${n} missing (${p}%)${C.reset}`
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SECTION 4: Coverage voids — category × area
  // ─────────────────────────────────────────────────────────────────────────────
  section("4. Category × Area Coverage Voids");
  console.log(
    `  ${C.grey}Showing area/category combos with < 3 spots per city${C.reset}`
  );

  for (const [city, citySpots] of [...byCityMap.entries()].sort(
    (a, b) => b[1].length - a[1].length
  )) {
    const areas = [
      ...new Set(
        citySpots.map((s) => s.area).filter(Boolean) as string[]
      ),
    ].sort();

    const voids: Array<{ area: string; category: string; count: number }> = [];

    for (const area of areas) {
      for (const cat of CATEGORIES) {
        const count = citySpots.filter(
          (s) =>
            s.area === area &&
            (s.categories as string[] | null)?.includes(cat)
        ).length;
        if (count < 3) {
          voids.push({ area, category: cat, count });
        }
      }
    }

    if (voids.length === 0) {
      console.log(`\n  ${C.bold}${city}${C.reset}  ✓ No voids found`);
      continue;
    }

    console.log(
      `\n  ${C.bold}${city}${C.reset}  ${C.grey}(${voids.length} voids)${C.reset}`
    );

    // Group by area
    const byArea = new Map<string, typeof voids>();
    for (const v of voids) {
      if (!byArea.has(v.area)) byArea.set(v.area, []);
      byArea.get(v.area)!.push(v);
    }

    // Only show areas with severe voids (all categories have < 3 spots)
    const severeAreas: string[] = [];
    for (const [area, areaVoids] of byArea.entries()) {
      const zeroCats = areaVoids.filter((v) => v.count === 0);
      if (zeroCats.length >= 4) severeAreas.push(area);
    }

    if (severeAreas.length > 0) {
      console.log(
        `    ${C.red}Severe voids (≥4 zero-coverage categories):${C.reset}`
      );
      for (const area of severeAreas.slice(0, 10)) {
        const areaVoids = byArea.get(area)!;
        const zeroCats = areaVoids
          .filter((v) => v.count === 0)
          .map((v) => v.category)
          .join(", ");
        console.log(
          `      ${C.yellow}${area}${C.reset}  ${C.grey}missing: ${zeroCats}${C.reset}`
        );
      }
    }

    // Show zero-coverage combos for high-value categories
    const highValue = ["dinner", "lunch", "breakfast"];
    const zeroDinner = voids.filter(
      (v) => v.count === 0 && highValue.includes(v.category)
    );
    if (zeroDinner.length > 0) {
      console.log(
        `\n    ${C.red}Zero coverage for high-value categories (dinner/lunch/breakfast):${C.reset}`
      );
      const grouped = new Map<string, string[]>();
      for (const v of zeroDinner) {
        if (!grouped.has(v.category)) grouped.set(v.category, []);
        grouped.get(v.category)!.push(v.area);
      }
      for (const [cat, areas] of grouped.entries()) {
        console.log(
          `      ${C.yellow}${cat}${C.reset}: ${areas.slice(0, 8).join(", ")}${areas.length > 8 ? ` +${areas.length - 8} more` : ""}`
        );
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SECTION 5: Worst offenders — spots missing the most fields
  // ─────────────────────────────────────────────────────────────────────────────
  section("5. Worst Offenders — Most Missing Fields");
  console.log(
    `  ${C.grey}Spots with the most missing operational fields (top 20)${C.reset}`
  );

  // Score against the 5 fields that should actually be populated
  const scored = spots.map((s) => {
    let score = 0;
    if (!s.address || s.address.trim() === "") score++;
    if (!s.price_range) score++;
    if (!s.vibe) score++;
    if (!s.what_to_order || (s.what_to_order as string[]).length === 0) score++;
    if (!s.pro_tips || (s.pro_tips as string[]).length === 0) score++;
    return { ...s, missingScore: score };
  });

  const worst = scored
    .filter((s) => s.missingScore >= 4)
    .sort((a, b) => b.missingScore - a.missingScore)
    .slice(0, 20);

  if (worst.length === 0) {
    console.log(`  ${C.green}  All spots have decent field coverage!${C.reset}`);
  } else {
    console.log();
    for (const s of worst) {
      const missingFields: string[] = [];
      if (!s.address || s.address.trim() === "") missingFields.push("address");
      if (!s.price_range) missingFields.push("price");
      if (!s.vibe) missingFields.push("vibe");
      if (!s.what_to_order || (s.what_to_order as string[]).length === 0)
        missingFields.push("what_to_order");
      if (!s.pro_tips || (s.pro_tips as string[]).length === 0)
        missingFields.push("pro_tips");

      const color = s.missingScore >= 4 ? C.red : C.yellow;
      console.log(
        `    ${color}[${s.missingScore}/7]${C.reset} ${C.bold}${s.name}${C.reset}  ${C.grey}${s.city} / ${s.area ?? "?"} / ${(s.categories as string[] | null)?.join(",") ?? "?"} / ${s.source}${C.reset}`
      );
      console.log(
        `          ${C.grey}missing: ${missingFields.join(", ")}${C.reset}`
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SECTION 6: Summary scorecard
  // ─────────────────────────────────────────────────────────────────────────────
  section("6. Summary Scorecard");

  // "Fully operational" = has the 3 fields users ask about most: address, what_to_order, price_range
  const fullyOperational = spots.filter(
    (s) =>
      s.address &&
      s.address.trim() !== "" &&
      s.price_range &&
      s.what_to_order &&
      (s.what_to_order as string[]).length > 0
  ).length;

  const embeddingGap = missing.embedding;
  const orderGap = missing.what_to_order;
  const addressGap = missing.address;

  console.log();
  row("Total spots", total);
  row(
    "Fully operational (address + price + what_to_order)",
    `${fullyOperational} / ${total} (${pct(fullyOperational, total)})`,
    fullyOperational < total * 0.5
  );
  row(
    "Searchable (has embedding)",
    `${total - embeddingGap} / ${total} (${pct(total - embeddingGap, total)})`,
    embeddingGap > 0
  );
  row(
    "Has address",
    `${total - addressGap} / ${total} (${pct(total - addressGap, total)})`,
    addressGap > total * 0.3
  );
  row(
    "Has what_to_order",
    `${total - orderGap} / ${total} (${pct(total - orderGap, total)})`,
    orderGap > total * 0.3
  );
  row(
    "Worst offenders (≥4/5 missing)",
    `${scored.filter((s) => s.missingScore >= 4).length} spots`,
    scored.filter((s) => s.missingScore >= 4).length > 50
  );

  console.log();
  console.log(`${C.grey}${"─".repeat(60)}${C.reset}`);
  console.log(`${C.grey}Done.${C.reset}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
