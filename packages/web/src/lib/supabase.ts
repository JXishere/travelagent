import { createClient, SupabaseClient } from "@supabase/supabase-js";

export interface Spot {
  id: string;
  name: string;
  city: string;
  country: string | null;
  area: string;
  categories: string[];
  must_go: boolean;
  verified: boolean;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  price_range: string | null;
  what_to_order: string[] | null;
  what_to_skip: string[] | null;
  pro_tips: string[] | null;
  vibe: string | null;
  best_time_of_day: string | null;
  indoor_outdoor: string | null;
  weather_dependent: boolean | null;
  input_method: string | null;
  recommendation_count: number | null;
  contribution_count: number | null;
  created_at: string;
}

function getClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function getAllSpots(): Promise<Spot[]> {
  const supabase = getClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("spots")
    .select("*")
    .order("name");

  if (error) {
    console.error("Failed to fetch spots:", error);
    return [];
  }

  return (data ?? []) as Spot[];
}

export async function updateSpot(
  id: string,
  updates: Partial<Spot>
): Promise<boolean> {
  const supabase = getClient();
  if (!supabase) return false;

  const { error } = await supabase.from("spots").update(updates).eq("id", id);

  if (error) {
    console.error("Failed to update spot:", error);
    return false;
  }
  return true;
}

export async function deleteSpot(id: string): Promise<boolean> {
  const supabase = getClient();
  if (!supabase) return false;

  const { error } = await supabase.from("spots").delete().eq("id", id);

  if (error) {
    console.error("Failed to delete spot:", error);
    return false;
  }
  return true;
}

export async function getCityStats(): Promise<{ spot_count: number }> {
  const supabase = getClient();
  if (!supabase) return { spot_count: 0 };

  const { count, error } = await supabase
    .from("spots")
    .select("*", { count: "exact", head: true });

  if (error) {
    console.error("Failed to fetch stats:", error.message, error.code, error.hint);
    return { spot_count: 0 };
  }

  return { spot_count: count ?? 0 };
}

export async function getDistinctCities(): Promise<string[]> {
  const supabase = getClient();
  if (!supabase) return ["every city"];

  const { data, error } = await supabase
    .from("spots")
    .select("city")
    .order("city");

  if (error || !data || data.length === 0) {
    return ["every city"];
  }

  const cities = [...new Set(data.map((row: { city: string }) => row.city))];
  return cities.length > 0 ? cities : ["every city"];
}

interface RecentSpot {
  name: string;
  area: string | null;
  categories: string[];
  what_to_order: string[] | null;
  what_to_skip: string[] | null;
  pro_tips: string[] | null;
  vibe: string | null;
  best_time_of_day: string | null;
  price_range: string | null;
  indoor_outdoor: string | null;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateTeasers(spot: RecentSpot): string[] {
  const area = spot.area;
  if (!area) return [];

  const candidates: string[] = [];
  const cat = spot.categories?.[0] ?? "spot";

  // Dish — pick a random dish, not always the first
  const dishes = spot.what_to_order?.filter(Boolean) ?? [];
  if (dishes.length > 0) {
    const dish = pick(dishes).toLowerCase();
    candidates.push(
      `Sam just learned where to get the best ${dish} in ${area}.`,
      `Someone just told Sam where the locals go for ${dish} in ${area}.`,
      `Sam just found out about a ${dish} spot in ${area} you need to know about.`,
    );
  }

  // What to skip — teases the insider "avoid" knowledge
  if (spot.what_to_skip?.length) {
    candidates.push(
      `Sam just found out what NOT to order at a place in ${area}.`,
      `Sam just learned what to skip at a ${cat} spot in ${area}.`,
    );
  }

  // Pro tips — reference the actual tip content if short enough
  const tips = spot.pro_tips?.filter(Boolean) ?? [];
  if (tips.length > 0) {
    const tip = pick(tips);
    if (tip.length <= 60) {
      candidates.push(`Sam just learned: "${tip.toLowerCase()}" — a spot in ${area}.`);
    }
    candidates.push(
      `Sam just picked up an insider tip about a ${cat} spot in ${area}.`,
    );
  }

  // Price range
  if (spot.price_range) {
    const pr = spot.price_range.toLowerCase();
    if (pr.includes("$") || pr.includes("cheap") || pr.includes("budget")) {
      candidates.push(`Sam just found a cheap ${cat} spot in ${area} that actually delivers.`);
    }
  }

  // Vibe
  if (spot.vibe) {
    candidates.push(`Sam just found a ${spot.vibe} little ${cat} spot in ${area}.`);
  }

  // Time of day
  if (spot.best_time_of_day) {
    candidates.push(`Sam just picked up a ${spot.best_time_of_day} move in ${area}.`);
  }

  // Indoor/outdoor
  if (spot.indoor_outdoor === "outdoor") {
    candidates.push(`Sam just found an open-air ${cat} spot in ${area}.`);
  }

  // Mystery / vague (always available — these are the most intriguing)
  candidates.push(
    `Sam just got the inside scoop on a spot in ${area}.`,
    `Sam just picked up a tip about a place in ${area} most people walk right past.`,
  );

  return candidates;
}


export async function getRecentSpotTeasers(limit = 200): Promise<string[]> {
  const supabase = getClient();
  if (!supabase) return [];

  // Only pull spots with real intel — at least one of what_to_order or pro_tips
  const { data, error } = await supabase
    .from("spots")
    .select("name, area, categories, what_to_order, what_to_skip, pro_tips, vibe, best_time_of_day, price_range, indoor_outdoor")
    .not("area", "is", null)
    .or("what_to_order.not.is.null,pro_tips.not.is.null")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data || data.length === 0) return [];

  // Build a pool of all candidate teasers, then pick one random teaser per spot
  const teasers: string[] = [];
  for (const spot of data as RecentSpot[]) {
    const candidates = generateTeasers(spot);
    if (candidates.length > 0) {
      teasers.push(pick(candidates));
    }
  }

  // Shuffle
  for (let i = teasers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [teasers[i], teasers[j]] = [teasers[j], teasers[i]];
  }

  return teasers;
}

export interface PendingCorrection {
  id: string;
  spot_id: string;
  spot_name: string;
  spot_area: string | null;
  reporter_id: string;
  correction_type: string;
  correction_note: string | null;
  created_at: string;
}

export async function getPendingCorrections(): Promise<PendingCorrection[]> {
  const supabase = getClient();
  if (!supabase) return [];

  const { data: corrections, error: cErr } = await supabase
    .from("spot_corrections")
    .select("id, spot_id, reporter_id, correction_type, correction_note, created_at")
    .order("created_at", { ascending: false });

  if (cErr || !corrections?.length) return [];

  const spotIds = [...new Set(corrections.map((c: any) => c.spot_id as string))];
  const { data: spots } = await supabase
    .from("spots")
    .select("id, name, area, is_closed")
    .in("id", spotIds)
    .not("is_closed", "eq", true);

  if (!spots) return [];
  const spotMap = new Map(spots.map((s: any) => [s.id as string, s]));

  return corrections
    .filter((c: any) => spotMap.has(c.spot_id))
    .map((c: any) => {
      const spot = spotMap.get(c.spot_id)!;
      return {
        id: c.id,
        spot_id: c.spot_id,
        spot_name: spot.name,
        spot_area: spot.area ?? null,
        reporter_id: c.reporter_id,
        correction_type: c.correction_type,
        correction_note: c.correction_note ?? null,
        created_at: c.created_at,
      } as PendingCorrection;
    });
}

export async function approveCorrection(spotId: string): Promise<boolean> {
  const supabase = getClient();
  if (!supabase) return false;
  const { error: e1 } = await supabase.from("spots").update({ is_closed: true, verified: false }).eq("id", spotId);
  if (e1) { console.error("approveCorrection spots update failed:", e1); return false; }
  await supabase.from("spot_corrections").delete().eq("spot_id", spotId);
  return true;
}

export async function rejectCorrection(spotId: string): Promise<boolean> {
  const supabase = getClient();
  if (!supabase) return false;
  const { error: e1 } = await supabase.from("spots").update({ verified: true }).eq("id", spotId);
  if (e1) { console.error("rejectCorrection spots update failed:", e1); return false; }
  await supabase.from("spot_corrections").delete().eq("spot_id", spotId);
  return true;
}

export async function getCountries(): Promise<string[]> {
  const supabase = getClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("spots")
    .select("country")
    .not("country", "is", null);

  if (error || !data || data.length === 0) return [];

  const countries = [...new Set(data.map((r: { country: string }) => r.country))].sort();
  return countries;
}

export async function getDistinctAreas(): Promise<string[]> {
  const supabase = getClient();
  if (!supabase) return ["everywhere"];

  const { data, error } = await supabase
    .from("spots")
    .select("area")
    .not("area", "is", null)
    .order("area");

  if (error || !data || data.length === 0) {
    return ["everywhere"];
  }

  const areas = [...new Set(data.map((row: { area: string }) => row.area))];
  return areas.length > 0 ? areas : ["everywhere"];
}
