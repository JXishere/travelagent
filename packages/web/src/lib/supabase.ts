import { createClient, SupabaseClient } from "@supabase/supabase-js";

export interface Spot {
  id: string;
  name: string;
  city: string;
  neighborhood: string;
  category: string;
  tier: number;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  payment_methods: string[] | null;
  price_range: string | null;
  what_to_order: string[] | null;
  what_to_skip: string[] | null;
  pro_tips: string[] | null;
  vibe: string | null;
  best_time_of_day: string | null;
  indoor_outdoor: string | null;
  weather_dependent: boolean | null;
  confidence_score: number | null;
  opening_hours: Record<string, string> | null;
  source: string | null;
  use_count: number | null;
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

export async function getCityStats(
  city: string = "Kuala Lumpur"
): Promise<{ spot_count: number; contributor_count: number }> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;

  if (!url || !key) {
    return { spot_count: 0, contributor_count: 0 };
  }

  const supabase = createClient(url, key);
  const { data, error } = await supabase.rpc("get_city_stats", {
    target_city: city,
  });

  if (error) {
    console.error("Failed to fetch city stats:", error);
    return { spot_count: 0, contributor_count: 0 };
  }

  return data as { spot_count: number; contributor_count: number };
}

export async function getDistinctCities(): Promise<string[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;

  if (!url || !key) {
    return ["every city"];
  }

  const supabase = createClient(url, key);
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
