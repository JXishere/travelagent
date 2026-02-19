import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);

async function main() {
  const { data, error } = await sb.from("spots").select("source, city").in("city", ["Kuala Lumpur", "Petaling Jaya"]);
  if (error) { console.error(error); process.exit(1); }

  const counts: Record<string, Record<string, number>> = {};
  for (const r of data!) {
    const src = r.source || "null";
    if (!counts[src]) counts[src] = {};
    counts[src][r.city] = (counts[src][r.city] || 0) + 1;
  }

  console.log("| Source | KL | PJ | Total |");
  console.log("|--------|-----|-----|-------|");
  let grandTotal = 0;
  for (const [src, cities] of Object.entries(counts).sort((a, b) => {
    const ta = Object.values(a[1]).reduce((s, n) => s + n, 0);
    const tb = Object.values(b[1]).reduce((s, n) => s + n, 0);
    return tb - ta;
  })) {
    const kl = cities["Kuala Lumpur"] || 0;
    const pj = cities["Petaling Jaya"] || 0;
    const total = kl + pj;
    grandTotal += total;
    console.log(`| ${src.padEnd(14)} | ${String(kl).padEnd(3)} | ${String(pj).padEnd(3)} | ${String(total).padEnd(5)} |`);
  }
  console.log(`| **Total**      |     |     | **${grandTotal}** |`);
}
main().catch(console.error);
