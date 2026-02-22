import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "fs";

async function main() {
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);
const { data } = await sb.from("spots").select("name, area, categories, city").in("city", ["Kuala Lumpur", "Petaling Jaya"]);

const existing: Record<string, number> = {};
for (const s of data!) {
  const k = `${s.area}::${s.categories?.[0]}`;
  existing[k] = (existing[k] || 0) + 1;
}

const HIGH = ["Bangsar","Bukit Bintang","KLCC","Chinatown","SS2","Damansara Jaya"];
const MED = ["TTDI","Taman Paramount","Pudu","Kampung Baru","Section 17","Damansara Uptown","Chow Kit","Cheras","Hartamas","Mont Kiara","Damansara Utama","Damansara Heights","Taman Megah","Brickfields","Pavilion"];
const CAT_TARGETS: Record<string,number> = {dinner:250,lunch:170,cafe:100,breakfast:80,activity:80,nightlife:70,market:50};

function density(area: string) {
  if (HIGH.includes(area)) return 10;
  if (MED.includes(area)) return 6;
  return 4;
}

const p = JSON.parse(readFileSync("scripts/research-progress.json", "utf-8"));
const totalBefore = Object.values(p.discovered).reduce((s: number, v: any) => s + v.length, 0);
let trimmedTotal = 0;

for (const key of Object.keys(p.discovered)) {
  const spots = p.discovered[key];
  if (!spots.length) continue;
  const [area, cat] = key.split("::");
  const current = existing[key] || 0;
  const rawTarget = density(area) * ((CAT_TARGETS[cat] || 50) / 250);
  const target = Math.max(1, Math.round(rawTarget));
  let needed = Math.max(0, Math.min(target - current, 6));
  needed = Math.max(needed, 1);
  p.discovered[key] = spots.slice(0, needed);
  trimmedTotal += p.discovered[key].length;
}

console.log(`Before: ${totalBefore} spots`);
console.log(`After:  ${trimmedTotal} spots`);

const cats: Record<string, number> = {};
for (const [k, v] of Object.entries(p.discovered) as any) {
  if (!v.length) continue;
  const cat = k.split("::")[1];
  cats[cat] = (cats[cat] || 0) + v.length;
}
for (const [cat, count] of Object.entries(cats).sort((a: any, b: any) => b[1] - a[1])) {
  console.log(`  ${cat}: ${count}`);
}

writeFileSync("scripts/research-progress.json", JSON.stringify(p, null, 2));
console.log("Saved.");
}
main().catch(console.error);
