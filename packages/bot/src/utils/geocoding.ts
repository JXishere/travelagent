// Geocoding — converts a street address to lat/lng using Nominatim (OpenStreetMap)
// Free, no API key required. Rate limit: 1 req/sec (fine for single-spot contributions).
// Nominatim policy: must identify the application in User-Agent.

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "Sam Travel Bot/1.0 (samiseverywhere.com)";

/**
 * Geocode a street address to lat/lng.
 * Returns undefined if the address can't be resolved or the request fails.
 * Appends city to the query to improve accuracy.
 */
export async function geocodeAddress(
  address: string,
  city: string
): Promise<{ lat: number; lng: number } | undefined> {
  const query = `${address}, ${city}`;
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");

  try {
    const response = await fetch(url.toString(), {
      headers: { "User-Agent": USER_AGENT },
    });

    if (!response.ok) {
      console.warn(`[geocode] Nominatim returned ${response.status} for: ${query}`);
      return undefined;
    }

    const results = await response.json() as Array<{ lat: string; lon: string }>;
    if (results.length === 0) return undefined;

    return {
      lat: parseFloat(results[0].lat),
      lng: parseFloat(results[0].lon),
    };
  } catch (error) {
    console.error("[geocode] Failed:", error, "query:", query);
    return undefined;
  }
}
