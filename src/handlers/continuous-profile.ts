// Continuous profile extraction — silently learns traveler facts from every exchange
// Runs as fire-and-forget after each message, using Haiku for speed/cost

import { extractJSON } from "../llm.js";
import {
  getOrCreateTraveler,
  updateTraveler,
  type Traveler,
} from "../database.js";

interface ProfileDelta {
  _no_changes?: boolean;
  name?: string;
  trip_dates?: { start: string; end: string };
  travel_party?: string;
  dietary_restrictions?: string[];
  budget?: string;
  pace?: string;
  interests?: string[];
  cuisine_preferences?: string[];
  specific_requests?: string[];
  first_time_visitor?: boolean;
}

/** Flows/intents where extraction adds no value (they handle profiles themselves or aren't about the traveler) */
const SKIP_FLOWS = new Set([
  "contribution",
  "contribute",
  "feedback",
  "generate",
  "profile_learning",
  "profile",
]);

/**
 * Fire-and-forget entry point — call after every sendMessage.
 * Never throws; logs errors and moves on.
 */
export async function maybeExtractProfile(
  phoneNumber: string,
  recentMessages: Array<{ role: string; content: string }>,
  currentFlow: string
): Promise<void> {
  try {
    if (shouldSkipExtraction(currentFlow)) return;

    const traveler = await getOrCreateTraveler(phoneNumber);
    const delta = await extractProfileDelta(traveler, recentMessages);

    if (!delta || delta._no_changes) return;

    // Build the update object by merging delta into existing traveler
    const updates = mergeProfileDelta(traveler, delta);
    if (Object.keys(updates).length === 0) return;

    await updateTraveler(phoneNumber, updates);
    console.log(
      `[continuous-profile] Updated ${phoneNumber}:`,
      Object.keys(updates).join(", ")
    );
  } catch (error) {
    console.error("[continuous-profile] Error (non-blocking):", error);
  }
}

function shouldSkipExtraction(currentFlow: string): boolean {
  return SKIP_FLOWS.has(currentFlow);
}

async function extractProfileDelta(
  traveler: Traveler,
  recentMessages: Array<{ role: string; content: string }>
): Promise<ProfileDelta | null> {
  const currentProfile = {
    name: traveler.name,
    trip_dates: traveler.trip_dates,
    travel_party: traveler.travel_party,
    dietary_restrictions: traveler.dietary_restrictions,
    first_time_visitor: traveler.first_time_visitor,
    ...(traveler.preferences ?? {}),
  };

  const context = `Current profile:\n${JSON.stringify(currentProfile, null, 2)}`;
  const input = recentMessages
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  try {
    return await extractJSON<ProfileDelta>("continuous_profile", input, context);
  } catch {
    return null;
  }
}

// --- Merge logic ---

/** Scalar fields that overwrite directly */
const SCALAR_FIELDS = new Set([
  "name",
  "travel_party",
  "budget",
  "pace",
  "first_time_visitor",
]);

/** Array fields that append + deduplicate, with ! removal support */
const ARRAY_FIELDS = new Set([
  "dietary_restrictions",
  "interests",
  "cuisine_preferences",
  "specific_requests",
]);

/** Fields stored on the traveler record directly (not inside preferences) */
const TOP_LEVEL_FIELDS = new Set([
  "name",
  "trip_dates",
  "travel_party",
  "dietary_restrictions",
  "first_time_visitor",
]);

/**
 * Merge a profile delta into the existing traveler, returning a partial update
 * ready for updateTraveler().
 */
function mergeProfileDelta(
  existing: Traveler,
  delta: ProfileDelta
): Partial<Traveler> {
  const updates: Record<string, any> = {};
  const prefUpdates: Record<string, any> = {};

  for (const [key, value] of Object.entries(delta)) {
    if (key === "_no_changes") continue;
    if (value === null || value === undefined) continue;

    if (key === "trip_dates") {
      // Overwrite as a unit
      updates.trip_dates = value;
    } else if (SCALAR_FIELDS.has(key)) {
      if (TOP_LEVEL_FIELDS.has(key)) {
        updates[key] = value;
      } else {
        prefUpdates[key] = value;
      }
    } else if (ARRAY_FIELDS.has(key) && Array.isArray(value)) {
      const existingArr = getExistingArray(existing, key);
      const merged = mergeArray(existingArr, value as string[]);
      if (TOP_LEVEL_FIELDS.has(key)) {
        updates[key] = merged;
      } else {
        prefUpdates[key] = merged;
      }
    }
  }

  // Merge preferences sub-object if we have preference-level updates
  if (Object.keys(prefUpdates).length > 0) {
    updates.preferences = { ...(existing.preferences ?? {}), ...prefUpdates };
  }

  return updates;
}

/** Get the existing array for a field, checking both top-level and preferences */
function getExistingArray(traveler: Traveler, field: string): string[] {
  if (TOP_LEVEL_FIELDS.has(field)) {
    return (traveler as any)[field] ?? [];
  }
  return (traveler.preferences ?? {})[field] ?? [];
}

/** Merge arrays: append + deduplicate, !-prefixed items remove existing entries */
function mergeArray(existing: string[], incoming: string[]): string[] {
  const removals = new Set(
    incoming
      .filter((item) => item.startsWith("!"))
      .map((item) => item.slice(1).toLowerCase())
  );
  const additions = incoming.filter((item) => !item.startsWith("!"));

  // Start with existing, remove any !-prefixed items
  let result = existing.filter(
    (item) => !removals.has(item.toLowerCase())
  );

  // Add new items, deduplicating
  const lowerSet = new Set(result.map((item) => item.toLowerCase()));
  for (const item of additions) {
    if (!lowerSet.has(item.toLowerCase())) {
      result.push(item);
      lowerSet.add(item.toLowerCase());
    }
  }

  return result;
}
