import { createClient } from "@supabase/supabase-js";

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
