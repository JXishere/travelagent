// City defaults — coordinates, timezone, and locale for each supported city

export interface CityDefaults {
  name: string;
  timezone: string;
  utcOffset: number;
  latitude: number;
  longitude: number;
  language: string;
  currency: string;
}

const CITY_DEFAULTS: Record<string, CityDefaults> = {
  "Kuala Lumpur": {
    name: "Kuala Lumpur",
    timezone: "Asia/Kuala_Lumpur",
    utcOffset: 8,
    latitude: 3.139,
    longitude: 101.6869,
    language: "en",
    currency: "MYR",
  },
  Penang: {
    name: "Penang",
    timezone: "Asia/Kuala_Lumpur",
    utcOffset: 8,
    latitude: 5.4141,
    longitude: 100.3288,
    language: "en",
    currency: "MYR",
  },
};

const DEFAULT_CITY = "Kuala Lumpur";

export function getCityDefaults(city?: string): CityDefaults {
  if (city && CITY_DEFAULTS[city]) return CITY_DEFAULTS[city];
  return CITY_DEFAULTS[DEFAULT_CITY];
}

export function getDefaultCity(): string {
  return DEFAULT_CITY;
}

/** Get all supported city names */
export function getSupportedCities(): string[] {
  return Object.keys(CITY_DEFAULTS);
}

/** Check if a city is supported */
export function isSupportedCity(city: string): boolean {
  return city in CITY_DEFAULTS;
}

/**
 * Map an area name to its city in the database.
 * E.g. "PJ" → "Petaling Jaya", "Bangsar" → "Kuala Lumpur"
 * Returns undefined if no special mapping is needed (use default city).
 */
const AREA_CITY_MAP: Record<string, string> = {
  pj: "Petaling Jaya",
  "petaling jaya": "Petaling Jaya",
  "damansara utama": "Petaling Jaya",
  "damansara kim": "Petaling Jaya",
  ss2: "Petaling Jaya",
  "subang jaya": "Petaling Jaya",
  subang: "Petaling Jaya",
  "bandar sunway": "Petaling Jaya",
  sunway: "Petaling Jaya",
  "shah alam": "Petaling Jaya",
  klang: "Petaling Jaya",
  "aman suria": "Petaling Jaya",
  "ara damansara": "Petaling Jaya",
  "mutiara damansara": "Petaling Jaya",
  "section 13": "Petaling Jaya",
  "section 14": "Petaling Jaya",
  "section 17": "Petaling Jaya",
  "section 19": "Petaling Jaya",
  "pj old town": "Petaling Jaya",
  "taman megah": "Petaling Jaya",
  "sunway mas": "Petaling Jaya",
  "kota damansara": "Petaling Jaya",
  "damansara jaya": "Petaling Jaya",
  "tropicana": "Petaling Jaya",
  "cyberjaya": "Petaling Jaya",
  ttdi: "Kuala Lumpur",
  bangsar: "Kuala Lumpur",
  "bukit bintang": "Kuala Lumpur",
  klcc: "Kuala Lumpur",
  kl: "Kuala Lumpur",
  "kuala lumpur": "Kuala Lumpur",
  penang: "Penang",
  "george town": "Penang",
  "georgetown": "Penang",
};

export function resolveCityFromArea(area: string | string[] | undefined): string | undefined {
  if (!area) return undefined;
  // If the classifier returned an array, try the first element
  const areaStr = Array.isArray(area) ? area[0] : area;
  if (!areaStr) return undefined;
  return AREA_CITY_MAP[areaStr.toLowerCase().trim()];
}

/**
 * Given an area string that might mention multiple areas (e.g. "PJ or KL"),
 * return the unique set of cities those areas belong to.
 */
export function resolveCitiesFromArea(area: string | string[] | undefined): string[] {
  if (!area) return [];
  // The classifier may return area as an array — normalize to a flat list of parts
  const parts = Array.isArray(area)
    ? area.flatMap((a) => a.split(/\s+or\s+|\/|,/i)).map((s) => s.trim()).filter(Boolean)
    : area.split(/\s+or\s+|\/|,/i).map((s) => s.trim()).filter(Boolean);
  const cities = new Set<string>();
  for (const part of parts) {
    const city = resolveCityFromArea(part);
    if (city) cities.add(city);
  }
  return [...cities];
}
