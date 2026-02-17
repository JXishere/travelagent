import { describe, it, expect } from "vitest";
import { haversineKm, filterByDistance, parseCoordinates } from "./geo.js";
import type { Spot } from "../database.js";

describe("haversineKm", () => {
  it("calculates KLCC to Bangsar ~5km", () => {
    // KLCC: 3.1588, 101.7118
    // Bangsar: 3.1297, 101.6717
    const dist = haversineKm(3.1588, 101.7118, 3.1297, 101.6717);
    expect(dist).toBeGreaterThan(4);
    expect(dist).toBeLessThan(6);
  });

  it("returns 0 for same point", () => {
    const dist = haversineKm(3.139, 101.6869, 3.139, 101.6869);
    expect(dist).toBe(0);
  });

  it("calculates KL to Singapore ~300km", () => {
    // KL: 3.139, 101.6869
    // Singapore: 1.3521, 103.8198
    const dist = haversineKm(3.139, 101.6869, 1.3521, 103.8198);
    expect(dist).toBeGreaterThan(290);
    expect(dist).toBeLessThan(320);
  });

  it("handles negative coordinates", () => {
    // Sydney: -33.8688, 151.2093 to Melbourne: -37.8136, 144.9631
    const dist = haversineKm(-33.8688, 151.2093, -37.8136, 144.9631);
    expect(dist).toBeGreaterThan(700);
    expect(dist).toBeLessThan(800);
  });
});

describe("filterByDistance", () => {
  const spots: Spot[] = [
    { id: "s1", name: "KLCC Spot", city: "KL", latitude: 3.1588, longitude: 101.7118 },
    { id: "s2", name: "Bangsar Spot", city: "KL", latitude: 3.1297, longitude: 101.6717 },
    { id: "s3", name: "Close Spot", city: "KL", latitude: 3.16, longitude: 101.71 },
    { id: "s4", name: "No Coords", city: "KL" },
    { id: "s5", name: "Far Spot", city: "KL", latitude: 1.35, longitude: 103.82 },
  ];

  it("filters spots within default 3km radius", () => {
    // Near KLCC
    const result = filterByDistance(spots, 3.1588, 101.7118);
    expect(result.length).toBe(2); // KLCC Spot and Close Spot
    expect(result[0].name).toBe("KLCC Spot"); // closest first
    expect(result[1].name).toBe("Close Spot");
  });

  it("respects custom maxKm", () => {
    const result = filterByDistance(spots, 3.1588, 101.7118, 10);
    expect(result.length).toBe(3); // KLCC, Close, Bangsar
  });

  it("excludes spots without coordinates", () => {
    const result = filterByDistance(spots, 3.1588, 101.7118, 1000);
    expect(result.find((s) => s.name === "No Coords")).toBeUndefined();
  });

  it("returns empty array when no spots are within range", () => {
    const result = filterByDistance(spots, 0, 0, 1);
    expect(result).toEqual([]);
  });

  it("returns empty for empty input", () => {
    const result = filterByDistance([], 3.1588, 101.7118);
    expect(result).toEqual([]);
  });

  it("includes distance_km on results", () => {
    const result = filterByDistance(spots, 3.1588, 101.7118, 10);
    for (const s of result) {
      expect(s.distance_km).toBeTypeOf("number");
      expect(s.distance_km).toBeGreaterThanOrEqual(0);
    }
  });

  it("sorts by distance ascending", () => {
    const result = filterByDistance(spots, 3.1588, 101.7118, 10);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].distance_km).toBeGreaterThanOrEqual(result[i - 1].distance_km);
    }
  });
});

describe("parseCoordinates", () => {
  it("parses 'lat,lng' format", () => {
    expect(parseCoordinates("3.139,101.687")).toEqual({ lat: 3.139, lng: 101.687 });
  });

  it("parses with spaces around comma", () => {
    expect(parseCoordinates("3.139 , 101.687")).toEqual({ lat: 3.139, lng: 101.687 });
  });

  it("parses negative coordinates", () => {
    expect(parseCoordinates("-33.8688,151.2093")).toEqual({ lat: -33.8688, lng: 151.2093 });
  });

  it("returns null for non-coordinate text", () => {
    expect(parseCoordinates("near Bangsar")).toBeNull();
  });

  it("returns null for out-of-range lat", () => {
    expect(parseCoordinates("91,101")).toBeNull();
  });

  it("returns null for out-of-range lng", () => {
    expect(parseCoordinates("3,181")).toBeNull();
  });

  it("parses integers", () => {
    expect(parseCoordinates("3,101")).toEqual({ lat: 3, lng: 101 });
  });
});
