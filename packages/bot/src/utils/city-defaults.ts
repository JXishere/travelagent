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
