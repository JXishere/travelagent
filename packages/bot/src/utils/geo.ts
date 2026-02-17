// Geo utilities — haversine distance and proximity filtering

import type { Spot } from "../database.js";

const EARTH_RADIUS_KM = 6371;

/** Calculate distance between two lat/lng points using haversine formula */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export interface SpotWithDistance extends Spot {
  distance_km: number;
}

/** Filter spots within maxKm of a point, sorted by distance */
export function filterByDistance(
  spots: Spot[],
  lat: number,
  lng: number,
  maxKm = 3
): SpotWithDistance[] {
  return spots
    .filter((s) => s.latitude != null && s.longitude != null)
    .map((s) => ({
      ...s,
      distance_km: haversineKm(lat, lng, s.latitude!, s.longitude!),
    }))
    .filter((s) => s.distance_km <= maxKm)
    .sort((a, b) => a.distance_km - b.distance_km);
}

/** Parse "lat,lng" from a string (e.g. "3.139,101.687") */
export function parseCoordinates(text: string): { lat: number; lng: number } | null {
  const match = text.match(/(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/);
  if (!match) return null;

  const lat = parseFloat(match[1]);
  const lng = parseFloat(match[2]);

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}
