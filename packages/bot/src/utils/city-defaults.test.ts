import { describe, it, expect } from "vitest";
import { getCityDefaults, getDefaultCity, getSupportedCities, isSupportedCity } from "./city-defaults.js";

describe("getCityDefaults", () => {
  it("returns KL config for 'Kuala Lumpur'", () => {
    const kl = getCityDefaults("Kuala Lumpur");
    expect(kl.name).toBe("Kuala Lumpur");
    expect(kl.timezone).toBe("Asia/Kuala_Lumpur");
    expect(kl.utcOffset).toBe(8);
    expect(kl.currency).toBe("MYR");
  });

  it("falls back to KL for unknown city", () => {
    const result = getCityDefaults("Tokyo");
    expect(result.name).toBe("Kuala Lumpur");
  });

  it("falls back to KL for undefined", () => {
    const result = getCityDefaults(undefined);
    expect(result.name).toBe("Kuala Lumpur");
  });

  it("falls back to KL when called with no args", () => {
    const result = getCityDefaults();
    expect(result.name).toBe("Kuala Lumpur");
  });
});

describe("getDefaultCity", () => {
  it("returns 'Kuala Lumpur'", () => {
    expect(getDefaultCity()).toBe("Kuala Lumpur");
  });
});

describe("getSupportedCities", () => {
  it("returns array including Kuala Lumpur", () => {
    const cities = getSupportedCities();
    expect(cities).toContain("Kuala Lumpur");
    expect(cities.length).toBeGreaterThanOrEqual(1);
  });
});

describe("isSupportedCity", () => {
  it("returns true for Kuala Lumpur", () => {
    expect(isSupportedCity("Kuala Lumpur")).toBe(true);
  });

  it("returns false for unsupported city", () => {
    expect(isSupportedCity("Tokyo")).toBe(false);
  });
});
