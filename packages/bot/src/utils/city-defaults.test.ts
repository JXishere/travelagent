import { describe, it, expect } from "vitest";
import { getCityDefaults, getDefaultCity } from "./city-defaults.js";

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
