// Query flow — "I'm hungry near Bangsar" → spot recommendations from knowledge graph

import { chat, buildSystemPrompt, HAIKU, langInstruction, langUserNote, samSays } from "../llm.js";
import { querySpots, semanticSearchSpots, incrementSpotUseCount, markSpotsVisited, getOrCreateTraveler, getSpotContributions, trackEvent, getAreaCentroid, getDistinctAreas, type Spot, type SpotContribution } from "../database.js";
import { getCurrentWeather } from "../weather.js";
import { resolveCategories, DEFAULT_CATEGORIES } from "../utils/categories.js";
import { getDefaultCity, getCityDefaults, isSupportedCity, getSupportedCities, resolveCityFromArea, resolveCitiesFromArea, CITY_LEVEL_ALIASES, AREA_CITY_MAP_KEYS } from "../utils/city-defaults.js";
import { filterByDistance, haversineKm } from "../utils/geo.js";
import { parseAreas } from "../utils/area-extractor.js";

interface QueryDetails {
  area?: string;
  meal_type?: string;
  time_of_day?: string;
  mood?: string;
  specific_place?: string;
  cuisine?: string;
}

export async function handleQuery(
  phoneNumber: string,
  message: string,
  details: QueryDetails,
  travelerContext?: string,
  options?: { channel?: "whatsapp" | "web" }
): Promise<string> {
  const channel = options?.channel ?? "whatsapp";
  // Use cuisine as fallback for meal_type — the LLM sometimes puts "coffee" in cuisine instead of meal_type
  const effectiveMealType = details.meal_type || details.cuisine;
  const categories = resolveCategories(effectiveMealType, details.time_of_day);
  const isDishQuery = categories === null;
  const traveler = await getOrCreateTraveler(phoneNumber);
  const weather = await getCurrentWeather();
  const city = traveler.current_city ?? getDefaultCity();

  // Gracefully handle unsupported cities — track for product signal, respond honestly
  if (traveler.current_city && !isSupportedCity(city)) {
    trackEvent(phoneNumber, channel, "unsupported_city_request", { city });
    const supportedList = getSupportedCities().join(", ");
    return samSays(
      `Respond warmly — you don't have ${city} in your network yet. You currently cover ${supportedList}. Keep it short and friendly.`,
      getDefaultCity()
    );
  }

  // Extract budget signal for price filtering
  const priceRange = mapBudgetToPriceRange(traveler.preferences?.budget as string | undefined);

  // Use specific_place as area fallback if no explicit area given
  // e.g. "I'm near KLCC, want coffee" → area=undefined, specific_place="KLCC" → effectiveArea="KLCC"
  // Fall back to traveler's known home area if available
  const homeArea = traveler.home_areas?.[0];
  const effectiveArea = details.area || details.specific_place || homeArea;

  // If no area context at all, ask where they are before querying
  if (!effectiveArea) {
    return samSays(`Ask where in ${city} they are right now — you need to know their location before recommending spots. One casual question.`, city);
  }

  // Parse multi-area string using vocabulary matching — handles "ss2 ss23 and taman megah"
  // (space-separated codes the LLM lumps together) as well as comma-separated lists.
  const dbAreas = await getDistinctAreas();
  const rawAreas = effectiveArea
    ? parseAreas(effectiveArea, dbAreas, AREA_CITY_MAP_KEYS)
    : [];

  // Resolve city from area — "PJ" / "SS2" maps to "Petaling Jaya", etc.
  // Pass rawAreas so individual areas like "SS23" resolve correctly even when the
  // original effectiveArea string was "ss2 ss23 and taman megah" (un-comma-separated).
  const areaCities = resolveCitiesFromArea(rawAreas.length > 0 ? rawAreas : effectiveArea);
  const resolvedCity = rawAreas.length > 0
    ? resolveCityFromArea(rawAreas[0])
    : resolveCityFromArea(effectiveArea);
  const queryCities = areaCities.length > 0 ? areaCities : undefined;
  const queryCity = queryCities ? undefined : city;

  // Filter out city-level aliases — "pj" / "kl" are not spot area tags
  const subAreas = rawAreas.filter(a => !CITY_LEVEL_ALIASES.has(a.toLowerCase()));
  const areaList = subAreas.length > 0 ? subAreas : undefined;

  // Compute centroid for the primary requested sub-area — used to annotate spot distances.
  // Cached after first hit, so no extra DB cost on repeated queries for the same area.
  const primaryArea = subAreas[0];
  const areaCentroid = primaryArea ? await getAreaCentroid(primaryArea) : undefined;

  let spots: Spot[];
  let areaWidened = false;

  if (isDishQuery) {
    // Dish query ("roti", "laksa") — semantic search only, no category fallback
    // If semantic search returns nothing, go straight to no-results (honest response)
    spots = await trySemanticSearch(message, resolvedCity ?? city);
  } else {
    // Category query ("dinner", "breakfast") — structured first, semantic fallback
    spots = await querySpots({
      city: queryCity,
      cities: queryCities,
      areas: areaList,
      categories,
      indoor_outdoor: weather?.is_raining ? "indoor" : undefined,
      priceRange,
      limit: 5,
    });
    // If empty and area was filtered, retry without area constraint then apply proximity filter
    if (spots.length === 0 && areaList) {
      areaWidened = true;
      spots = await querySpots({
        city: queryCity,
        cities: queryCities,
        categories,
        indoor_outdoor: weather?.is_raining ? "indoor" : undefined,
        limit: 20, // fetch larger pool so proximity filter has something to work with
      });
      // Proximity filter: keep only spots within 3km of the user's area centroid.
      // Centroid is computed from actual spot coordinates in the DB — no hardcoded list to maintain.
      // If centroid is unknown (no geocoded spots for that area) or nothing is within 3km,
      // return empty — better to say "no coverage" than recommend the wrong part of the city.
      if (rawAreas.length > 0) {
        // Use pre-computed centroid; fall back to iterating rawAreas if primary had no centroid
        const coords = areaCentroid ?? (await Promise.all(rawAreas.map(a => getAreaCentroid(a)))).find(Boolean);
        if (coords) {
          spots = filterByDistance(spots, coords.lat, coords.lng, 3);
        } else {
          // Can't geo-constrain — don't return citywide results as if they're nearby
          spots = [];
        }
      }
    }
    if (spots.length === 0) {
      spots = await trySemanticSearch(message, resolvedCity ?? city);
    }
  }

  // Time-aware soft filter — remove spots whose best_time_of_day doesn't match local hour.
  // Soft: if filtering would empty results, keep all but add a timing note to the LLM context.
  let timingNote = "";
  if (!isDishQuery && spots.length > 0) {
    const cityDefs = getCityDefaults(resolvedCity ?? city);
    const localHour = ((new Date().getUTCHours() + cityDefs.utcOffset) % 24 + 24) % 24;
    const timeFiltered = spots.filter(s => isTimeMatch(s.best_time_of_day, localHour));
    if (timeFiltered.length > 0) {
      spots = timeFiltered;
    } else {
      timingNote = `\nNote: the current local time is ${localHour}:00 — these spots' usual hours may not match. Mention this gently if relevant (e.g. "usually a breakfast spot but worth checking if they're still open").`;
    }
  }

  if (spots.length === 0) {
    console.warn(`[query] No results: intent=${details.meal_type || details.cuisine || 'unknown'}, area=${effectiveArea}, city=${queryCity || queryCities}`);
    return await chat(
      buildSystemPrompt(city, options?.channel) + langInstruction(message),
      [
        {
          role: "user",
          content: `The user says: "${message}"\n\nYou have NO spots in your knowledge graph for this query. Do NOT make up or suggest any restaurants, cafes, or places. Be honest that you don't have intel on this yet.${effectiveArea ? ` Offer to search other areas of the city instead.` : ""} Keep it short — this is WhatsApp. Never tell them to "ask locals" — you're the one they're asking.`,
        },
      ],
      { maxTokens: 512, model: HAIKU }
    );
  }

  // Track usage and mark as visited
  const topSpots = spots.slice(0, 3);

  // Build distance labels for spots not in one of the requested sub-areas.
  // Only annotate when we have a centroid reference AND the spot has coordinates.
  const distanceFromArea = new Map<string, string>();
  if (areaCentroid && primaryArea) {
    for (const spot of topSpots) {
      const inRequestedArea = subAreas.some(a =>
        spot.area?.toLowerCase().includes(a.toLowerCase())
      );
      if (!inRequestedArea && spot.latitude != null && spot.longitude != null) {
        const km = haversineKm(areaCentroid.lat, areaCentroid.lng, spot.latitude, spot.longitude);
        const label = km < 1
          ? `~${Math.round(km * 1000)}m from ${primaryArea}`
          : `~${km.toFixed(1)}km from ${primaryArea}`;
        distanceFromArea.set(spot.id, label);
      }
    }
  }

  for (const spot of topSpots) {
    incrementSpotUseCount(spot.id);
  }
  await markSpotsVisited(phoneNumber, topSpots.map(s => s.id));
  trackEvent(phoneNumber, channel, "recommendation", {
    spot_ids: topSpots.map(s => s.id),
    spot_names: topSpots.map(s => s.name),
    categories,
    area: effectiveArea,
  });

  // Build traveler preferences for context
  const prefs = traveler.preferences ?? {};
  const prefLines: string[] = [];
  if (traveler.dietary_restrictions?.length) prefLines.push(`Dietary restrictions: ${traveler.dietary_restrictions.join(", ")}`);
  if (prefs.budget) prefLines.push(`Budget: ${prefs.budget}`);
  if (prefs.interests?.length) prefLines.push(`Interests: ${prefs.interests.join(", ")}`);
  if (prefs.cuisine_preferences?.length) prefLines.push(`Cuisine preferences: ${prefs.cuisine_preferences.join(", ")}`);
  const prefContext = prefLines.length > 0 ? `\nUser preferences:\n${prefLines.join("\n")}` : "";

  // Format spots for Claude (with optional contributor perspectives)
  const spotContext = formatSpotsForLLM(topSpots, distanceFromArea);
  const spotContributions = await Promise.all(
    topSpots.map(s => getSpotContributions(s.id).catch(() => [] as SpotContribution[]))
  );
  const perspectivesContext = buildContributorPerspectives(topSpots, spotContributions);
  const weatherContext = weather ? `\nCurrent weather: ${weather.summary}` : "";

  // Detect area mismatch — user asked for specific area(s) but results are from elsewhere
  const requestedArea = effectiveArea;
  const hasAreaMismatch =
    requestedArea &&
    areaList &&
    spots.length > 0 &&
    !spots.some((s) =>
      areaList.some(a => s.area?.toLowerCase().includes(a.toLowerCase()))
    );
  const areaNote =
    hasAreaMismatch || areaWidened
      ? `\n\nNote: The user asked for spots near "${requestedArea}" but these picks are from other parts of the city. Mention the actual area for each spot so they can judge the distance. Use the Distance field if present — say "~Xkm away" not "a short drive". NEVER invent distances.`
      : "";

  const prompt = `The user asked: "${message}"
${travelerContext ? `\nAdditional context: ${travelerContext}` : ""}
${prefContext}
${weatherContext}

Here are the matching spots from your knowledge graph. Format each spot as two lines: "Name (Area)" on line 1, then what to order and one key tip on line 2. Blank line between spots. Max 3 spots. No intros. Lead with your strongest pick.

CRITICAL: ONLY mention details that appear in the spot data below. If a spot only has a name and area, just say the name and area. Do NOT invent prices, dishes, pro tips, hours, or any other details not listed. NEVER invent distances, walking times, or driving times. If a spot has a Distance field, you may mention it as a reference — say "~Xkm from [area]", not "a short drive" or "10 minutes away". If a spot has limited data, keep the recommendation short and honest — "I know the spot but don't have deep intel on it yet" is fine.
${areaNote}${timingNote}
${spotContext}${perspectivesContext}${langUserNote(message)}`;

  return await chat(buildSystemPrompt(city, options?.channel) + langInstruction(message), [{ role: "user", content: prompt }], {
    maxTokens: 256,
  });
}

export function formatOpeningHours(hours: Record<string, string>): string {
  return Object.entries(hours)
    .map(([day, time]) => `${day.charAt(0).toUpperCase() + day.slice(1)}: ${time}`)
    .join(", ");
}

export function sourceLabel(source: string | undefined): string {
  switch (source) {
    case "voice": return "local contributor (voice note)";
    case "text": return "local contributor";
    case "seed":
    case "manual":
    default: return "curated by Sam";
  }
}

/** Map traveler budget preference to price_range filter values */
function mapBudgetToPriceRange(budget: string | undefined): string[] | undefined {
  if (!budget) return undefined;
  const b = budget.toLowerCase();
  if (b === "backpacker" || b === "tight" || b === "budget") return ["$"];
  if (b === "moderate" || b === "mid") return ["$", "$$"];
  if (b === "splurge" || b === "luxury") return ["$$", "$$$"];
  return undefined;
}

/** Check if a spot's best_time_of_day matches the current local hour */
function isTimeMatch(bestTimeOfDay: string | undefined, localHour: number): boolean {
  if (!bestTimeOfDay || bestTimeOfDay === "anytime") return true;
  switch (bestTimeOfDay) {
    case "breakfast": return localHour >= 6 && localHour < 11;
    case "brunch": return localHour >= 9 && localHour < 13;
    case "lunch": return localHour >= 11 && localHour < 15;
    case "afternoon": return localHour >= 12 && localHour < 18;
    case "dinner": return localHour >= 17 && localHour < 23;
    case "evening": return localHour >= 17 && localHour < 23;
    case "night": return localHour >= 19 || localHour < 3;
    default: return true; // unknown values — don't filter
  }
}

/** Try semantic search when structured query returns no results */
async function trySemanticSearch(
  message: string,
  city: string,
): Promise<Spot[]> {
  try {
    const { generateEmbedding } = await import("../embeddings.js");
    const embedding = await generateEmbedding(message);
    return await semanticSearchSpots(embedding, { city });
  } catch {
    // Semantic search unavailable (missing API key, no embeddings, etc.)
    return [];
  }
}

export function formatSpotsForLLM(spots: Spot[], distanceFromArea?: Map<string, string>): string {
  return spots
    .map((s, i) => {
      const lines = [`${i + 1}. ${s.name}`];
      if (s.area) lines.push(`   Neighborhood: ${s.area}`);
      const distLabel = distanceFromArea?.get(s.id);
      if (distLabel) lines.push(`   Distance: ${distLabel}`);
      if (s.categories?.length) lines.push(`   Category: ${s.categories.join(", ")}`);
      if (s.address) lines.push(`   Address: ${s.address}`);
      if (s.price_range) lines.push(`   Price: ${s.price_range}`);
      if (s.payment_methods?.length)
        lines.push(`   Payment: ${s.payment_methods.join(", ")}`);
      if (s.opening_hours)
        lines.push(`   Hours: ${formatOpeningHours(s.opening_hours)}`);
      if (s.what_to_order?.length)
        lines.push(`   Order: ${s.what_to_order.join(", ")}`);
      if (s.what_to_skip?.length)
        lines.push(`   Skip: ${s.what_to_skip.join(", ")}`);
      if (s.pro_tips?.length)
        lines.push(`   Tips: ${s.pro_tips.join(" | ")}`);
      if (s.vibe) lines.push(`   Vibe: ${s.vibe}`);
      if (s.indoor_outdoor) lines.push(`   Setting: ${s.indoor_outdoor}`);
      if (s.best_time_of_day)
        lines.push(`   Best time: ${s.best_time_of_day}`);
      const takeLabel = s.must_go
        ? `must-go (${sourceLabel(s.source)})`
        : s.verified
          ? `verified (${sourceLabel(s.source)})`
          : `unverified — treat as a lead, not a guarantee`;
      lines.push(`   Sam's take: ${takeLabel}`);
      if (s.avg_rating != null)
        lines.push(`   Traveler rating: ${s.avg_rating.toFixed(1)}/5`);
      if (s.isStale) lines.push(`   Freshness: last verified 6+ months ago — details may have changed`);
      return lines.join("\n");
    })
    .join("\n\n");
}

/** Build a contributor perspectives block for the LLM prompt.
 *  Only added when ≥2 contributors have meaningfully different what_to_order suggestions. */
function buildContributorPerspectives(
  spots: Spot[],
  contributions: SpotContribution[][]
): string {
  const notes: string[] = [];
  for (let i = 0; i < spots.length; i++) {
    const note = formatSpotWithContributorPerspectives(contributions[i] ?? []);
    if (note) notes.push(`${i + 1}. ${spots[i].name}: ${note}`);
  }
  if (notes.length === 0) return "";
  return `\n\nContributor perspectives (use this to add colour if relevant):\n${notes.join("\n")}`;
}

/** Returns a formatted perspectives string if ≥2 contributors differ on what_to_order, else null. */
export function formatSpotWithContributorPerspectives(
  contributions: SpotContribution[]
): string | null {
  if (contributions.length < 2) return null;

  const orderSets = contributions
    .filter(c => c.what_to_order?.length)
    .map(c => c.what_to_order!);

  if (orderSets.length < 2) return null;

  // Check for meaningful differences
  const firstSetLower = new Set(orderSets[0].map(s => s.toLowerCase()));
  const hasDifferences = orderSets.some(orders =>
    orders.some(o => !firstSetLower.has(o.toLowerCase()))
  );
  if (!hasDifferences) return null;

  // Collect unique suggestions preserving original casing
  const seen = new Set<string>();
  const displayOrders: string[] = [];
  for (const orders of orderSets) {
    for (const o of orders) {
      if (!seen.has(o.toLowerCase())) {
        seen.add(o.toLowerCase());
        displayOrders.push(o);
      }
    }
  }
  if (displayOrders.length <= 1) return null;

  return `${contributions.length} contributors, ${displayOrders.length} takes on what to order: ${displayOrders.join(", ")}`;
}
