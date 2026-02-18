import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock modules that have side effects at import time
vi.mock("../database.js", () => ({}));
vi.mock("../transcription.js", () => ({}));
vi.mock("../whatsapp.js", () => ({}));
vi.mock("../llm.js", () => ({
  webSearchSpot: vi.fn().mockResolvedValue({}),
}));

import {
  smartMerge,
  isReady,
  smartMergeForUpdate,
  formatSummary,
  describeNewInfo,
  buildFollowUp,
  buildWarmPrefix,
  enrichFromWeb,
} from "./contribution.js";
import { webSearchSpot } from "../llm.js";
import type { Spot } from "../database.js";

describe("smartMerge", () => {
  it("merges new fields into empty object", () => {
    const result = smartMerge({}, { name: "Fatty Crab", category: "dinner" });
    expect(result.name).toBe("Fatty Crab");
    expect(result.category).toBe("dinner");
  });

  it("preserves existing fields when incoming is empty", () => {
    const result = smartMerge({ name: "Fatty Crab" }, {});
    expect(result.name).toBe("Fatty Crab");
  });

  it("overwrites scalar fields", () => {
    const result = smartMerge(
      { name: "Fatty Crab", category: "lunch" },
      { category: "dinner" }
    );
    expect(result.category).toBe("dinner");
  });

  it("appends to arrays without duplicates by default", () => {
    const result = smartMerge(
      { what_to_order: ["nasi lemak"] },
      { what_to_order: ["nasi lemak", "roti canai"] }
    );
    expect(result.what_to_order).toEqual(["nasi lemak", "roti canai"]);
  });

  it("replaces arrays when replaceArrays is true", () => {
    const result = smartMerge(
      { what_to_order: ["nasi lemak", "teh tarik"] },
      { what_to_order: ["roti canai"] },
      true
    );
    expect(result.what_to_order).toEqual(["roti canai"]);
  });

  it("ignores null, undefined, empty strings, empty arrays, and empty objects", () => {
    const result = smartMerge(
      { name: "Fatty Crab", vibe: "casual" },
      { name: null as any, vibe: "", what_to_order: [], opening_hours: {} }
    );
    expect(result.name).toBe("Fatty Crab");
    expect(result.vibe).toBe("casual");
    expect(result.what_to_order).toBeUndefined();
  });

  it("skips missing_fields key", () => {
    const result = smartMerge(
      {},
      { name: "test", missing_fields: ["category"] } as any
    );
    expect(result.missing_fields).toBeUndefined();
  });
});

describe("isReady", () => {
  it("returns false when missing critical fields", () => {
    expect(isReady({})).toBe(false);
    expect(isReady({ name: "Test" })).toBe(false);
    expect(isReady({ name: "Test", category: "dinner" })).toBe(false);
  });

  it("returns false when has critical but no operational data", () => {
    expect(isReady({ name: "Test", category: "dinner", neighborhood: "Bangsar" })).toBe(false);
  });

  it("returns true when has critical + operational data", () => {
    expect(
      isReady({
        name: "Test",
        category: "dinner",
        neighborhood: "Bangsar",
        what_to_order: ["nasi lemak"],
      })
    ).toBe(true);

    expect(
      isReady({
        name: "Test",
        category: "dinner",
        neighborhood: "Bangsar",
        pro_tips: ["go early"],
      })
    ).toBe(true);

    expect(
      isReady({
        name: "Test",
        category: "dinner",
        neighborhood: "Bangsar",
        payment_methods: ["cash"],
      })
    ).toBe(true);
  });
});

describe("smartMergeForUpdate", () => {
  it("extracts scalar updates", () => {
    const result = smartMergeForUpdate({ vibe: "chaotic", price_range: "$$" });
    expect(result.vibe).toBe("chaotic");
    expect(result.price_range).toBe("$$");
  });

  it("ignores missing_fields", () => {
    const result = smartMergeForUpdate({ vibe: "chill", missing_fields: ["name"] } as any);
    expect(result).not.toHaveProperty("missing_fields");
  });

  it("ignores null values", () => {
    const result = smartMergeForUpdate({ vibe: null as any });
    expect(result).not.toHaveProperty("vibe");
  });
});

const baseSpot: Spot = {
  id: "spot-1",
  name: "Fatty Crab",
  city: "Kuala Lumpur",
};

describe("formatSummary", () => {
  it("formats full data", () => {
    const result = formatSummary({
      name: "Fatty Crab",
      neighborhood: "Taman Megah",
      category: "dinner",
      price_range: "$$",
      payment_methods: ["cash"],
      what_to_order: ["chilli crab"],
      pro_tips: ["go early"],
      opening_hours: { monday: "6pm-11pm" },
      vibe: "chaotic",
    });
    expect(result).toContain("*Fatty Crab* — Taman Megah, Kuala Lumpur");
    expect(result).toContain("Dinner");
    expect(result).toContain("$$");
    expect(result).toContain("cash");
    expect(result).toContain("🍽 Order: chilli crab");
    expect(result).toContain("💡 go early");
    expect(result).toContain("🕐 Monday: 6pm-11pm");
    expect(result).toContain("✨ Vibe: chaotic");
  });

  it("formats minimal data", () => {
    const result = formatSummary({ name: "Test Spot", neighborhood: "KLCC" });
    expect(result).toContain("*Test Spot* — KLCC, Kuala Lumpur");
    expect(result).not.toContain("🍽");
    expect(result).not.toContain("💡");
    expect(result).not.toContain("🕐");
    expect(result).not.toContain("✨");
  });

  it("uses custom city when provided", () => {
    const result = formatSummary({
      name: "Test",
      neighborhood: "Shibuya",
      city: "Tokyo",
    });
    expect(result).toContain("*Test* — Shibuya, Tokyo");
  });

  it("joins multiple what_to_order items", () => {
    const result = formatSummary({
      name: "Test",
      neighborhood: "X",
      what_to_order: ["nasi lemak", "roti canai"],
    });
    expect(result).toContain("🍽 Order: nasi lemak, roti canai");
  });

  it("joins multiple pro_tips with periods", () => {
    const result = formatSummary({
      name: "Test",
      neighborhood: "X",
      pro_tips: ["go early", "sit outside"],
    });
    expect(result).toContain("💡 go early. sit outside");
  });

  it("formats opening_hours entries", () => {
    const result = formatSummary({
      name: "Test",
      neighborhood: "X",
      opening_hours: { monday: "9am-5pm", tuesday: "10am-6pm" },
    });
    expect(result).toContain("🕐 Monday: 9am-5pm, Tuesday: 10am-6pm");
  });

  it("skips opening_hours when empty object", () => {
    const result = formatSummary({
      name: "Test",
      neighborhood: "X",
      opening_hours: {},
    });
    expect(result).not.toContain("🕐");
  });
});

describe("describeNewInfo", () => {
  it("detects new array items", () => {
    const existing: Spot = {
      ...baseSpot,
      what_to_order: ["nasi lemak"],
    };
    const result = describeNewInfo(existing, {
      what_to_order: ["nasi lemak", "roti canai"],
    });
    expect(result).toEqual(["• New what to order: roti canai"]);
  });

  it("filters duplicates case-insensitively", () => {
    const existing: Spot = {
      ...baseSpot,
      what_to_order: ["Nasi Lemak"],
    };
    const result = describeNewInfo(existing, {
      what_to_order: ["nasi lemak"],
    });
    expect(result).toEqual([]);
  });

  it("detects new vibe", () => {
    const existing: Spot = { ...baseSpot, vibe: "casual" };
    const result = describeNewInfo(existing, { vibe: "chaotic" });
    expect(result).toContain("• Vibe: chaotic (was: casual)");
  });

  it("skips same vibe", () => {
    const existing: Spot = { ...baseSpot, vibe: "casual" };
    const result = describeNewInfo(existing, { vibe: "casual" });
    expect(result.find((l) => l.includes("Vibe"))).toBeUndefined();
  });

  it("detects new price_range", () => {
    const existing: Spot = { ...baseSpot, price_range: "$" };
    const result = describeNewInfo(existing, { price_range: "$$" });
    expect(result).toContain("• Price: $$ (was: $)");
  });

  it("returns empty array when no differences", () => {
    const existing: Spot = {
      ...baseSpot,
      what_to_order: ["nasi lemak"],
      vibe: "casual",
      price_range: "$$",
    };
    const result = describeNewInfo(existing, {
      what_to_order: ["nasi lemak"],
      vibe: "casual",
      price_range: "$$",
    });
    expect(result).toEqual([]);
  });
});

describe("buildFollowUp", () => {
  it("returns opening prompt when extraction yielded nothing", () => {
    const result = buildFollowUp({}, {});
    expect(result).toContain("What's the spot?");
  });

  it("asks for name when missing", () => {
    const result = buildFollowUp({ category: "dinner" }, {});
    expect(result).toContain("What's it called?");
  });

  it("asks for neighborhood when missing", () => {
    const result = buildFollowUp({ name: "Fatty Crab" }, {});
    expect(result).toContain("What area");
  });

  it("asks for category when missing", () => {
    const result = buildFollowUp(
      { name: "Fatty Crab", neighborhood: "Taman Megah" },
      {}
    );
    expect(result).toContain("What kind of spot?");
  });

  it("asks for what_to_order when missing", () => {
    const result = buildFollowUp(
      { name: "Fatty Crab", neighborhood: "Taman Megah", category: "dinner" },
      {}
    );
    expect(result).toContain("What should people order");
  });

  it("asks for tips when all critical fields present", () => {
    const result = buildFollowUp(
      {
        name: "Fatty Crab",
        neighborhood: "Taman Megah",
        category: "dinner",
        what_to_order: ["chilli crab"],
      },
      {}
    );
    expect(result).toContain("Any tips?");
  });
});

describe("buildWarmPrefix", () => {
  it("acknowledges name + neighborhood", () => {
    const result = buildWarmPrefix(
      { name: "Fatty Crab", neighborhood: "Taman Megah" },
      {}
    );
    expect(result).toBe("*Fatty Crab* in Taman Megah, nice! ");
  });

  it("acknowledges name only", () => {
    const result = buildWarmPrefix({ name: "Fatty Crab" }, {});
    expect(result).toBe("Got it — *Fatty Crab*. ");
  });

  it("acknowledges neighborhood only", () => {
    const result = buildWarmPrefix({ neighborhood: "Bangsar" }, {});
    expect(result).toBe("Bangsar, nice! ");
  });

  it("returns generic when nothing new", () => {
    const prev = { name: "Fatty Crab", neighborhood: "Taman Megah" };
    const result = buildWarmPrefix(
      { name: "Fatty Crab", neighborhood: "Taman Megah" },
      prev
    );
    expect(result).toBe("Got it. ");
  });
});

describe("enrichFromWeb", () => {
  const mockedWebSearch = vi.mocked(webSearchSpot);

  beforeEach(() => {
    mockedWebSearch.mockReset().mockResolvedValue({});
  });

  it("returns data unchanged when name is missing", async () => {
    const data = { category: "dinner" };
    const result = await enrichFromWeb(data);
    expect(result.enriched).toEqual(data);
    expect(result.didEnrich).toBe(false);
    expect(mockedWebSearch).not.toHaveBeenCalled();
  });

  it("returns data unchanged when already isReady", async () => {
    const data = {
      name: "Fatty Crab",
      category: "dinner",
      neighborhood: "Taman Megah",
      what_to_order: ["chilli crab"],
    };
    const result = await enrichFromWeb(data);
    expect(result.enriched).toEqual(data);
    expect(result.didEnrich).toBe(false);
    expect(mockedWebSearch).not.toHaveBeenCalled();
  });

  it("merges web data and contributor data wins on conflicts", async () => {
    mockedWebSearch.mockResolvedValue({
      neighborhood: "Bangsar South",
      category: "cafe",
      price_range: "$$",
    });

    const data = {
      name: "Ka'ia",
      category: "dinner", // contributor says dinner, web says cafe — contributor wins
    };

    const result = await enrichFromWeb(data);
    expect(result.enriched.name).toBe("Ka'ia");
    expect(result.enriched.category).toBe("dinner"); // contributor wins
    expect(result.enriched.neighborhood).toBe("Bangsar South"); // filled from web
    expect(result.enriched.price_range).toBe("$$"); // filled from web
    expect(result.didEnrich).toBe(true);
  });

  it("strips opinion fields from web data", async () => {
    mockedWebSearch.mockResolvedValue({
      neighborhood: "Bangsar South",
      price_range: "$$",
      what_to_order: ["flat white"],
      what_to_skip: ["the pastries"],
      pro_tips: ["sit upstairs"],
      vibe: "chill",
      tier: 2,
      best_time_of_day: "morning",
    });

    const data = { name: "Ka'ia" };
    const result = await enrichFromWeb(data);

    // Operational fields filled
    expect(result.enriched.neighborhood).toBe("Bangsar South");
    expect(result.enriched.price_range).toBe("$$");

    // Opinion fields stripped — not present from web
    expect(result.enriched.what_to_order).toBeUndefined();
    expect(result.enriched.what_to_skip).toBeUndefined();
    expect(result.enriched.pro_tips).toBeUndefined();
    expect(result.enriched.vibe).toBeUndefined();
    expect(result.enriched.tier).toBeUndefined();
    expect(result.enriched.best_time_of_day).toBeUndefined();
    expect(result.didEnrich).toBe(true);
  });

  it("returns didEnrich false when web returns only opinion fields", async () => {
    mockedWebSearch.mockResolvedValue({
      what_to_order: ["flat white"],
      vibe: "chill",
      pro_tips: ["go early"],
    });

    const data = { name: "Ka'ia" };
    const result = await enrichFromWeb(data);
    expect(result.enriched).toEqual(data);
    expect(result.didEnrich).toBe(false);
  });

  it("returns didEnrich false when web returns empty", async () => {
    mockedWebSearch.mockResolvedValue({});
    const data = { name: "Unknown Spot" };
    const result = await enrichFromWeb(data);
    expect(result.enriched).toEqual(data);
    expect(result.didEnrich).toBe(false);
  });
});
