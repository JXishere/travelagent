// Supabase client — all database operations

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./database.types.js";
import { getDefaultCity, getCityDefaults } from "./utils/city-defaults.js";

// Lazy-init: defer createClient until first use so importing this module in test
// environments (where SUPABASE_URL / SUPABASE_KEY are unset) doesn't throw.
// All existing `supabase.from(...)` calls work unchanged — the Proxy is transparent.
let _supabase: SupabaseClient<Database> | null = null;
const supabase = new Proxy({} as SupabaseClient<Database>, {
  get(_: SupabaseClient<Database>, prop: string | symbol) {
    if (!_supabase) {
      _supabase = createClient<Database>(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_KEY!
      );
    }
    return (_supabase as any)[prop];
  },
});

const MAX_CONVERSATION_MESSAGES = 40;

// ============================================
// CONVERSATIONS
// ============================================

export interface Conversation {
  id: string;
  whatsapp_number: string;
  current_flow: string;
  flow_state: Record<string, any>;
  messages: Array<{ role: string; content: string }>;
  updated_at: string;
  last_user_message_at?: string;
}

export async function getOrCreateConversation(
  phoneNumber: string
): Promise<Conversation> {
  const { data } = await supabase
    .from("conversations")
    .select("*")
    .eq("whatsapp_number", phoneNumber)
    .single();

  if (data) return data as unknown as Conversation;

  const { data: created, error } = await supabase
    .from("conversations")
    .insert({ whatsapp_number: phoneNumber })
    .select()
    .single();

  if (error) throw error;
  return created as unknown as Conversation;
}

export async function updateConversation(
  phoneNumber: string,
  updates: Partial<Pick<Conversation, "current_flow" | "flow_state" | "messages">>
): Promise<void> {
  await supabase
    .from("conversations")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("whatsapp_number", phoneNumber);
}

export async function appendMessages(
  phoneNumber: string,
  newMessages: Array<{ role: string; content: string }>
): Promise<void> {
  // Atomic append via RPC — avoids read-modify-write race condition where
  // two concurrent messages from the same user overwrite each other's history.
  await supabase.rpc("append_conversation_messages", {
    p_phone_number: phoneNumber,
    p_new_messages: newMessages,
    p_max_messages: MAX_CONVERSATION_MESSAGES,
  });
}

// ============================================
// HAPPENINGS
// ============================================

export interface Happening {
  id: string;
  name: string;
  city: string;
  country?: string;
  area?: string;
  description?: string;
  start_date: string;
  end_date: string;
  recurring?: boolean;
  recurrence_rule?: string;
  categories?: string[];
  source_url?: string;
  input_method?: string;
  contributor_id?: string;
  created_at?: string;
}

/**
 * Return happenings active on a given date (default: today) for a city.
 * Recurring events are always included when they have a recurrence_rule.
 */
export async function queryHappenings(
  city: string,
  date?: string
): Promise<Happening[]> {
  const targetDate = date ?? new Date().toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("happenings")
    .select("*")
    .ilike("city", `%${city}%`)
    .lte("start_date", targetDate)
    .gte("end_date", targetDate)
    .order("start_date", { ascending: true })
    .limit(10);

  if (error) {
    console.error("[queryHappenings] Error:", error);
    return [];
  }
  return (data ?? []) as unknown as Happening[];
}

// ============================================
// SPOTS
// ============================================

export interface Spot {
  id: string;
  name: string;
  city: string;
  country?: string;
  area?: string;
  categories?: string[];
  must_go?: boolean;
  verified?: boolean;
  address?: string;
  latitude?: number;
  longitude?: number;
  price_range?: string;
  what_to_order?: string[];
  what_to_skip?: string[];
  pro_tips?: string[];
  vibe?: string;
  payment_methods?: string[];
  opening_hours?: Record<string, string>;
  weather_dependent?: boolean;
  best_time_of_day?: string;
  indoor_outdoor?: string;
  contributor_id?: string;
  recommendation_count?: number;
  avg_rating?: number;
  input_method?: string;
  embedding?: number[];
  created_at?: string;
  is_closed?: boolean;
  needs_review?: boolean;
  last_verified?: string;
  isStale?: boolean; // computed at query time — not a DB column
}

/** Strip app-only fields before writing to the spots table */
function toDbSpotRow(spot: Partial<Spot>): Database["public"]["Tables"]["spots"]["Insert"] {
  const { isStale, payment_methods, opening_hours, embedding, ...dbFields } = spot;
  return dbFields as unknown as Database["public"]["Tables"]["spots"]["Insert"];
}

export async function querySpots(filters: {
  city?: string;
  cities?: string[];
  area?: string;
  areas?: string[];
  categories?: string[];
  indoor_outdoor?: string;
  exclude_weather_dependent?: boolean;
  priceRange?: string[];
  excludeIds?: string[];
  limit?: number;
}): Promise<Spot[]> {
  const requestedLimit = filters.limit ?? 5;
  // Fetch a larger pool so we can shuffle within tiers — prevents same spots dominating every response
  const poolSize = Math.min(requestedLimit * 4, 20);

  let query = supabase
    .from("spots")
    .select("*")
    .not("is_closed", "eq", true)
    .not("needs_review", "eq", true)
    .order("must_go", { ascending: false })
    .order("verified", { ascending: false });

  if (filters.cities && filters.cities.length > 0) {
    query = query.in("city", filters.cities);
  } else if (filters.city) {
    query = query.eq("city", filters.city);
  }
  if (filters.areas && filters.areas.length > 0) {
    // Quote values so PostgREST correctly handles area names with spaces (e.g. "Taman Megah")
    const orClause = filters.areas.map(a => `area.ilike."%${a}%"`).join(',');
    query = query.or(orClause);
  } else if (filters.area) {
    query = query.ilike("area", `%${filters.area}%`);
  }
  if (filters.categories)
    query = query.overlaps("categories", filters.categories);
  if (filters.indoor_outdoor)
    query = query.in("indoor_outdoor", [filters.indoor_outdoor, "both"]);
  if (filters.exclude_weather_dependent)
    query = query.or("weather_dependent.eq.false,weather_dependent.is.null");
  if (filters.priceRange && filters.priceRange.length > 0)
    query = query.in("price_range", filters.priceRange);
  if (filters.excludeIds && filters.excludeIds.length > 0)
    query = query.not("id", "in", `(${filters.excludeIds.join(",")})`);

  query = query.limit(poolSize);

  const { data, error } = await query;
  if (error) throw error;
  const pool = (data ?? []) as unknown as Spot[];

  // Compute staleness: no created_at, or created_at older than 180 days
  const staleThreshold = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
  const withStaleness = pool.map(s => ({
    ...s,
    isStale: !s.created_at || s.created_at < staleThreshold,
  }));

  // Spots with avg_rating < 2.5 are demoted to rest tier (poor traveler experience signals)
  const isPoorlyRated = (s: typeof withStaleness[0]) =>
    s.avg_rating != null && s.avg_rating < 2.5;

  // Compute an app-level quality score for tiebreaking within each tier.
  // Replaces random shuffle — richer spots surface first, but randomness is still mixed in
  // via a ±0.1 jitter so the same spots don't dominate every response.
  const qualityScore = (s: typeof withStaleness[0]): number => {
    let score = 0;
    if (s.what_to_order && s.what_to_order.length > 0) score += 0.35;
    if (s.pro_tips && s.pro_tips.length > 0) score += 0.25;
    if (s.avg_rating != null && s.avg_rating >= 3.5) score += 0.20;
    if (s.recommendation_count != null && s.recommendation_count >= 3) score += 0.10;
    if (!s.isStale) score += 0.10;
    // Jitter: ±10% random noise so high-quality spots rotate naturally
    score += (Math.random() - 0.5) * 0.2;
    return score;
  };

  const byQuality = (a: typeof withStaleness[0], b: typeof withStaleness[0]) =>
    qualityScore(b) - qualityScore(a);

  const mustGo = withStaleness.filter(s => s.must_go && !isPoorlyRated(s)).sort(byQuality);
  const verified = withStaleness.filter(s => !s.must_go && s.verified && !isPoorlyRated(s)).sort(byQuality);
  const rest = withStaleness.filter(s => (!s.must_go && !s.verified) || isPoorlyRated(s)).sort(byQuality);
  const isThinSpot = (s: typeof withStaleness[0]) =>
    (!s.what_to_order || s.what_to_order.length === 0) &&
    (!s.pro_tips || s.pro_tips.length === 0);

  const sorted = [...mustGo, ...verified, ...rest];
  const thick  = sorted.filter(s => !isThinSpot(s));
  const thin   = sorted.filter(s =>  isThinSpot(s));
  const finalSpots = (thick.length > 0 ? thick : thin).slice(0, requestedLimit);

  // P2.C: Discovery boost — 30% chance to inject a verified but under-exposed spot at position 2
  if (finalSpots.length >= 2 && Math.random() < 0.3) {
    const alreadyIncluded = new Set(finalSpots.map(s => s.id));
    const discoveryCandidate = sorted.find(s =>
      s.verified === true &&
      s.must_go !== true &&
      (s.recommendation_count == null || s.recommendation_count < 5) &&
      (s.avg_rating == null || s.avg_rating >= 3.0) &&
      !alreadyIncluded.has(s.id)
    );
    if (discoveryCandidate) {
      finalSpots.splice(1, 0, discoveryCandidate);
      if (finalSpots.length > requestedLimit) finalSpots.pop();
    }
  }

  return finalSpots;
}

// In-process cache so repeated widening queries for the same area don't hit the DB twice
const _areaCentroidCache = new Map<string, { lat: number; lng: number } | null>();

/**
 * Compute the geographic centroid of all spots tagged to a given area.
 * Used for proximity filtering when a citywide query widens past the user's area.
 * Results are cached per process lifetime — no maintenance needed as the DB grows.
 */
export async function getAreaCentroid(area: string): Promise<{ lat: number; lng: number } | undefined> {
  const key = area.toLowerCase().trim();
  if (_areaCentroidCache.has(key)) {
    return _areaCentroidCache.get(key) ?? undefined;
  }

  const { data, error } = await supabase
    .from("spots")
    .select("latitude, longitude")
    .ilike("area", `%${area}%`)
    .not("latitude", "is", null)
    .not("longitude", "is", null);

  if (error || !data || data.length === 0) {
    _areaCentroidCache.set(key, null);
    return undefined;
  }

  const lat = data.reduce((sum, s) => sum + (s.latitude as number), 0) / data.length;
  const lng = data.reduce((sum, s) => sum + (s.longitude as number), 0) / data.length;
  const result = { lat, lng };
  _areaCentroidCache.set(key, result);
  return result;
}

let _distinctAreasCache: string[] | null = null;

/**
 * Return all distinct area values from the spots table.
 * Cached per process lifetime — used by the area extractor to build match vocabulary.
 */
export async function getDistinctAreas(): Promise<string[]> {
  if (_distinctAreasCache !== null) return _distinctAreasCache;

  const { data, error } = await supabase
    .from("spots")
    .select("area")
    .not("area", "is", null);

  if (error || !data) { _distinctAreasCache = []; return []; }

  const seen = new Set<string>();
  const areas: string[] = [];
  for (const row of data) {
    const a = (row as unknown as { area: string }).area;
    if (a && !seen.has(a)) { seen.add(a); areas.push(a); }
  }
  _distinctAreasCache = areas;
  return areas;
}

export async function insertSpot(spot: Partial<Spot>): Promise<Spot> {
  const city = spot.city ?? getDefaultCity();
  const country = spot.country ?? getCityDefaults(city).country;
  const { data, error } = await supabase
    .from("spots")
    .insert(toDbSpotRow({ city, country, ...spot }))
    .select()
    .single();
  if (error) throw error;

  const inserted = data as unknown as Spot;

  // Fire-and-forget: generate and store embedding for the new spot
  autoEmbedSpot(inserted).catch((err) =>
    console.error(`Auto-embed failed for spot ${inserted.id}:`, err)
  );

  return inserted;
}

/** Auto-embed a spot after insert (lazy-loaded to avoid circular deps) */
async function autoEmbedSpot(spot: Spot): Promise<void> {
  try {
    const { buildSpotText, embedSpot } = await import("./embeddings.js");
    const text = buildSpotText(spot);
    await embedSpot(spot.id, text, updateSpot);
  } catch {
    // embeddings module may not be available (e.g. missing OPENAI_API_KEY in tests)
  }
}

export async function findDuplicateSpot(
  name: string,
  area?: string
): Promise<Spot | null> {
  // Pass 1: Exact case-insensitive match (existing behaviour, fast path)
  {
    let q = supabase.from("spots").select("*").ilike("name", name);
    if (area) q = q.ilike("area", `%${area}%`);
    const { data } = await q.limit(1).maybeSingle();
    if (data) return data as unknown as Spot;
  }

  // Pass 1b: Fuzzy matching — catch partial/variant names ("Fatty Crab Restaurant", "The Fatty Crab")
  const candidates = await fetchFuzzyCandidates(name, area);
  if (candidates.length === 0) return null;

  // Pass 2: LLM verification — confirm if any candidate is the same physical place
  return await llmVerifyDuplicate(name, area, candidates);
}

async function fetchFuzzyCandidates(
  name: string,
  area?: string
): Promise<Array<{ id: string; name: string; area: string | null }>> {
  let q = supabase
    .from("spots")
    .select("id,name,area")
    .ilike("name", `%${name}%`);
  if (area) q = q.ilike("area", `%${area}%`);
  const { data } = await q.limit(5);
  return (data ?? []) as Array<{ id: string; name: string; area: string | null }>;
}

async function llmVerifyDuplicate(
  name: string,
  area: string | undefined,
  candidates: Array<{ id: string; name: string; area: string | null }>
): Promise<Spot | null> {
  try {
    const { chat, HAIKU } = await import("./llm.js");
    const list = candidates
      .map(c => `ID: ${c.id} | Name: ${c.name} | Area: ${c.area ?? "unknown"}`)
      .join("\n");
    const locationStr = area ? ` in ${area}` : "";
    const prompt = `Is "${name}"${locationStr} the same physical restaurant/place as any of these?\n${list}\n\nReply with ONLY the matching ID, or "none".`;
    const result = await chat(
      "You identify whether two place names refer to the same physical location. Reply with just the ID or 'none'.",
      [{ role: "user", content: prompt }],
      { maxTokens: 50, model: HAIKU }
    );
    const matchedId = result.trim().replace(/['"]/g, "").split(/\s+/)[0];
    if (!matchedId || matchedId === "none") return null;
    const validIds = new Set(candidates.map(c => c.id));
    if (!validIds.has(matchedId)) return null;
    return await getSpotById(matchedId);
  } catch (err) {
    console.error("[dedup] LLM verification failed:", err);
    return null; // Safe default — avoids false positives
  }
}

/** Find a spot by name — fuzzy match, returns best candidate or null */
export async function findSpotByName(name: string, city?: string): Promise<Spot | null> {
  // Pass 1: exact case-insensitive match
  {
    let q = supabase.from("spots").select("*").ilike("name", name);
    if (city) q = q.eq("city", city);
    const { data } = await q.limit(1).maybeSingle();
    if (data) return data as unknown as Spot;
  }

  // Pass 2: substring match (e.g. "Village Park" → "Village Park Restaurant")
  {
    let q = supabase.from("spots").select("*").ilike("name", `%${name}%`);
    if (city) q = q.eq("city", city);
    const { data } = await q.order("must_go", { ascending: false }).limit(1).maybeSingle();
    if (data) return data as unknown as Spot;
  }

  return null;
}

export async function getSpotById(spotId: string): Promise<Spot | null> {
  const { data } = await supabase
    .from("spots")
    .select("*")
    .eq("id", spotId)
    .single();
  return (data as unknown as Spot) ?? null;
}

export async function getSpotsByIds(ids: string[]): Promise<Pick<Spot, "id" | "name" | "area">[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase.from("spots").select("id, name, area").in("id", ids);
  return (data ?? []) as unknown as Pick<Spot, "id" | "name" | "area">[];
}

export async function updateSpot(spotId: string, updates: Partial<Spot>): Promise<void> {
  await supabase
    .from("spots")
    .update(toDbSpotRow(updates))
    .eq("id", spotId);
}

// ============================================
// SPOT CORRECTIONS
// ============================================

export interface CorrectionDelta {
  is_closed?: boolean;
  area?: string;
  address?: string;
  opening_hours_note?: string;
  correction_type: "closed" | "moved" | "wrong_info" | "other";
  correction_summary: string;
}

/** Apply a structured correction delta to a spot and record attribution */
export async function applySpotCorrection(
  spotId: string,
  reporterId: string,
  delta: CorrectionDelta
): Promise<{ hardClosed: boolean; reportCount: number }> {
  // Count existing corrections from different reporters — drives the threshold logic
  const { count } = await supabase
    .from("spot_corrections")
    .select("*", { count: "exact", head: true })
    .eq("spot_id", spotId)
    .neq("reporter_id", reporterId);

  const existingCount = count ?? 0;
  const hardClosed = existingCount >= 1;

  // First report: soft demotion only (verified: false). Second unique reporter: hard close.
  const updates: Partial<Spot> = { verified: false };
  if (hardClosed) updates.is_closed = true;
  if (delta.area) updates.area = delta.area;
  if (delta.address) updates.address = delta.address;

  await supabase.from("spots").update(toDbSpotRow(updates)).eq("id", spotId);

  await supabase.from("spot_corrections").insert({
    spot_id: spotId,
    reporter_id: reporterId,
    correction_type: delta.correction_type,
    correction_note: delta.correction_summary,
    delta: delta as unknown as Json,
  });

  return { hardClosed, reportCount: existingCount + 1 };
}

export interface PendingCorrection {
  id: string;
  spot_id: string;
  spot_name: string;
  spot_area: string | null;
  reporter_id: string;
  correction_type: string;
  correction_note: string | null;
  created_at: string;
}

/** Return all correction reports for spots that are not yet hard-closed */
export async function getPendingCorrections(): Promise<PendingCorrection[]> {
  const { data: corrections } = await supabase
    .from("spot_corrections")
    .select("id, spot_id, reporter_id, correction_type, correction_note, created_at")
    .order("created_at", { ascending: false });

  if (!corrections?.length) return [];

  const spotIds = [...new Set(corrections.map((c: any) => c.spot_id as string))];
  const { data: spots } = await supabase
    .from("spots")
    .select("id, name, area, is_closed")
    .in("id", spotIds)
    .not("is_closed", "eq", true);

  if (!spots) return [];

  const spotMap = new Map(spots.map((s) => [s.id as string, s]));
  return corrections
    .filter((c: any) => spotMap.has(c.spot_id))
    .map((c: any) => {
      const spot = spotMap.get(c.spot_id)!;
      return {
        id: c.id,
        spot_id: c.spot_id,
        spot_name: spot.name,
        spot_area: spot.area ?? null,
        reporter_id: c.reporter_id,
        correction_type: c.correction_type,
        correction_note: c.correction_note ?? null,
        created_at: c.created_at,
      } as PendingCorrection;
    });
}

/** Admin: force-close a spot and clear its pending corrections */
export async function adminApproveCorrection(spotId: string): Promise<void> {
  await supabase.from("spots").update({ is_closed: true, verified: false }).eq("id", spotId);
  await supabase.from("spot_corrections").delete().eq("spot_id", spotId);
}

/** Admin: restore a spot and clear its pending corrections */
export async function adminRejectCorrection(spotId: string): Promise<void> {
  await supabase.from("spots").update({ verified: true }).eq("id", spotId);
  await supabase.from("spot_corrections").delete().eq("spot_id", spotId);
}

/** Semantic similarity search using pgvector embeddings */
export async function semanticSearchSpots(
  queryEmbedding: number[],
  filters?: { city?: string; categories?: string[] },
  limit = 5
): Promise<Spot[]> {
  const embeddingStr = `[${queryEmbedding.join(",")}]`;
  const { data, error } = await supabase.rpc("match_spots", {
    query_embedding: embeddingStr,
    filter_city: filters?.city ?? undefined,
    filter_categories: filters?.categories ?? undefined,
    match_limit: limit,
  });

  if (error) {
    console.error("Semantic search failed:", error);
    return [];
  }

  return (data ?? []) as unknown as Spot[];
}

export async function incrementRecommendationCount(spotId: string): Promise<void> {
  // Atomic increment via RPC — avoids SELECT → UPDATE race condition under concurrent recommendations
  await supabase.rpc("increment_recommendation_count", { p_spot_id: spotId });
}

export async function incrementSpotContributionCount(spotId: string): Promise<void> {
  // Atomic increment via RPC
  await supabase.rpc("increment_spot_contribution_count", { p_spot_id: spotId });
}

// ============================================
// TRAVELERS
// ============================================

export interface Traveler {
  id: string;
  whatsapp_number: string;
  name?: string;
  user_type: "local" | "traveler" | "unknown";
  home_areas: string[];
  preferences: Record<string, any>;
  dietary_restrictions: string[];
  current_city?: string;
  trip_dates?: { start: string; end: string };
  travel_party?: string;
  first_time_visitor?: boolean;
  spots_recommended: string[];
  spots_liked: string[];
  spots_disliked: string[];
  last_proactive_at?: string;
  spots_feedback_asked: string[];
}

export async function getOrCreateTraveler(
  phoneNumber: string
): Promise<Traveler> {
  const { data } = await supabase
    .from("travelers")
    .select("*")
    .eq("whatsapp_number", phoneNumber)
    .single();

  if (data) return data as unknown as Traveler;

  const { data: created, error } = await supabase
    .from("travelers")
    .insert({ whatsapp_number: phoneNumber })
    .select()
    .single();

  if (error) throw error;
  return created as unknown as Traveler;
}

export async function updateTraveler(
  phoneNumber: string,
  updates: Partial<Traveler>
): Promise<void> {
  await supabase
    .from("travelers")
    .update(updates)
    .eq("whatsapp_number", phoneNumber);
}

export async function markSpotRecommended(
  phoneNumber: string,
  spotId: string
): Promise<void> {
  const traveler = await getOrCreateTraveler(phoneNumber);
  const existing = new Set(traveler.spots_recommended ?? []);
  existing.add(spotId);
  await updateTraveler(phoneNumber, { spots_recommended: [...existing] });
}

export async function markSpotsRecommended(
  phoneNumber: string,
  spotIds: string[]
): Promise<void> {
  const traveler = await getOrCreateTraveler(phoneNumber);
  const existing = new Set(traveler.spots_recommended ?? []);
  for (const id of spotIds) existing.add(id);
  await updateTraveler(phoneNumber, { spots_recommended: [...existing] });
}

// ============================================
// CONTRIBUTORS
// ============================================

export interface Contributor {
  id: string;
  whatsapp_number: string;
  name?: string;
  contribution_count: number;
  cities_contributed?: string[];
  created_at?: string;
}

export async function getOrCreateContributor(
  phoneNumber: string
): Promise<Contributor> {
  const { data } = await supabase
    .from("contributors")
    .select("*")
    .eq("whatsapp_number", phoneNumber)
    .single();

  if (data) return data as unknown as Contributor;

  const { data: created, error } = await supabase
    .from("contributors")
    .insert({ whatsapp_number: phoneNumber })
    .select()
    .single();

  if (error) throw error;
  return created as unknown as Contributor;
}

export async function incrementContributorCount(
  phoneNumber: string,
  city: string = getDefaultCity()
): Promise<void> {
  const contributor = await getOrCreateContributor(phoneNumber);
  const existing: string[] = (contributor as any).cities_contributed ?? [];
  const cities = existing.includes(city) ? existing : [...existing, city];
  await supabase
    .from("contributors")
    .update({
      contribution_count: contributor.contribution_count + 1,
      cities_contributed: cities,
    })
    .eq("whatsapp_number", phoneNumber);
}

// ============================================
// PROACTIVE MESSAGING
// ============================================

/** Update last_user_message_at on the conversation (for WhatsApp 24h window tracking) */
export async function touchLastUserMessage(phoneNumber: string): Promise<void> {
  await supabase
    .from("conversations")
    .update({ last_user_message_at: new Date().toISOString() })
    .eq("whatsapp_number", phoneNumber);
}

/** Get travelers currently on a trip with their conversation state */
export async function getActiveTravelers(): Promise<
  Array<Traveler & { current_flow: string; last_user_message_at?: string }>
> {
  const { data: travelers } = await supabase
    .from("travelers")
    .select("*")
    .eq("user_type", "traveler")
    .not("trip_dates", "is", null);

  if (!travelers?.length) return [];

  const phones = travelers.map((t: any) => t.whatsapp_number);
  const { data: conversations } = await supabase
    .from("conversations")
    .select("whatsapp_number, current_flow, last_user_message_at")
    .in("whatsapp_number", phones);

  const convoMap = new Map(
    (conversations ?? []).map((c) => [c.whatsapp_number, c])
  );

  return travelers.map((t: any) => {
    const convo = convoMap.get(t.whatsapp_number);
    return {
      ...t,
      current_flow: convo?.current_flow ?? "general",
      last_user_message_at: convo?.last_user_message_at ?? undefined,
    } as Traveler & { current_flow: string; last_user_message_at?: string };
  });
}

/** Update last_proactive_at timestamp on the traveler */
export async function touchLastProactive(phoneNumber: string): Promise<void> {
  await supabase
    .from("travelers")
    .update({ last_proactive_at: new Date().toISOString() })
    .eq("whatsapp_number", phoneNumber);
}

/** Append spot IDs to spots_feedback_asked (deduped) */
export async function markFeedbackAsked(
  phoneNumber: string,
  spotIds: string[]
): Promise<void> {
  const traveler = await getOrCreateTraveler(phoneNumber);
  const existing = new Set(traveler.spots_feedback_asked ?? []);
  for (const id of spotIds) existing.add(id);
  await updateTraveler(phoneNumber, { spots_feedback_asked: [...existing] });
}

/** Get spots from spots_recommended that haven't been asked about in feedback yet */
export async function getSpotsNeedingFeedback(
  phoneNumber: string
): Promise<Spot[]> {
  const traveler = await getOrCreateTraveler(phoneNumber);
  if (!traveler.spots_recommended?.length) return [];

  const asked = new Set(traveler.spots_feedback_asked ?? []);
  const needFeedback = traveler.spots_recommended.filter((id) => !asked.has(id));
  if (needFeedback.length === 0) return [];

  const { data } = await supabase
    .from("spots")
    .select("*")
    .in("id", needFeedback.slice(-5));

  return (data ?? []) as unknown as Spot[];
}

// ============================================
// FEEDBACK
// ============================================

export interface Feedback {
  id: string;
  spot_id: string;
  traveler_id: string;
  rating: number;
  visited: boolean;
  comments?: string;
  user_tips?: string[];
}

export async function insertFeedback(
  feedback: Omit<Feedback, "id">
): Promise<void> {
  await supabase.from("feedback").insert(feedback);

  // After insert, recompute avg_rating from all verified visits for this spot
  if (feedback.rating != null && feedback.visited !== false) {
    const { data: ratings } = await supabase
      .from("feedback")
      .select("rating")
      .eq("spot_id", feedback.spot_id)
      .eq("visited", true)
      .not("rating", "is", null);

    if (ratings && ratings.length > 0) {
      const avg = ratings.reduce((sum, r) => sum + (r.rating as number), 0) / ratings.length;
      const rounded = Math.round(avg * 100) / 100;
      await supabase
        .from("spots")
        .update({ avg_rating: rounded })
        .eq("id", feedback.spot_id);

      // Auto-demote spots with consistently poor ratings — persistent signal survives query logic changes
      if (avg < 2.5) {
        await supabase
          .from("spots")
          .update({ verified: false, must_go: false })
          .eq("id", feedback.spot_id);
        console.log(`[auto-demotion] spot ${feedback.spot_id} demoted to unverified (avg_rating=${rounded})`);
      }
    }
  }

  // Append user tips to spot
  if (feedback.user_tips?.length) {
    const { data: spot } = await supabase
      .from("spots")
      .select("pro_tips")
      .eq("id", feedback.spot_id)
      .single();

    if (spot) {
      const tips = [...(spot.pro_tips ?? []), ...feedback.user_tips];
      await supabase
        .from("spots")
        .update({ pro_tips: tips })
        .eq("id", feedback.spot_id);
    }
  }
}

// ============================================
// EVENTS — Analytics tracking
// ============================================

/** Fire-and-forget analytics event — never blocks the user */
export function trackEvent(
  sessionId: string,
  channel: "web" | "whatsapp",
  eventType: string,
  eventData: Record<string, any> = {}
): void {
  supabase
    .from("events")
    .insert({ session_id: sessionId, channel, event_type: eventType, event_data: eventData })
    .then(({ error }) => {
      if (error) console.error("[analytics] Failed to track event:", error.message);
    });
}

// ============================================
// SPOT CONTRIBUTIONS — per-contributor attribution
// ============================================

export interface SpotContribution {
  id: string;
  spot_id: string;
  contributor_id: string;
  what_to_order?: string[];
  what_to_skip?: string[];
  pro_tips?: string[];
  vibe?: string;
  must_go?: boolean;
  created_at: string;
}

export async function insertSpotContribution(contribution: {
  spot_id: string;
  contributor_id: string;
  what_to_order?: string[];
  what_to_skip?: string[];
  pro_tips?: string[];
  vibe?: string;
  must_go?: boolean;
}): Promise<void> {
  const { error } = await supabase.from("spot_contributions").insert(contribution);
  if (error) console.error("[attribution] Failed to insert spot contribution:", error);
}

export async function getSpotContributions(spot_id: string): Promise<SpotContribution[]> {
  const { data } = await supabase
    .from("spot_contributions")
    .select("*")
    .eq("spot_id", spot_id)
    .order("created_at", { ascending: true });
  return (data ?? []) as SpotContribution[];
}

// ============================================
// RECENTLY RECOMMENDED
// ============================================

export async function getRecentlyRecommendedSpots(
  phoneNumber: string
): Promise<Spot[]> {
  const traveler = await getOrCreateTraveler(phoneNumber);
  if (!traveler.spots_recommended?.length) return [];

  const { data } = await supabase
    .from("spots")
    .select("*")
    .in("id", traveler.spots_recommended.slice(-5));

  return (data ?? []) as unknown as Spot[];
}

// ============================================
// DAILY DIGEST — P1.A
// ============================================

export interface DailyDigestData {
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  waMessages: number;
  webMessages: number;
  newSpots: Array<{ city: string; country?: string }>;
  topIntent: string;
  topIntentCount: number;
  contributions: number;
  feedbacks: number;
  reviewQueueCount: number;
}

/** Compute KL calendar-day UTC boundaries. offsetDays=-1 = yesterday, 0 = today */
function getKLDayBounds(offsetDays = -1): { start: string; end: string } {
  const klOffsetMs = 8 * 60 * 60 * 1000;
  const now = new Date();
  const klNow = new Date(now.getTime() + klOffsetMs);
  const klToday = new Date(klNow);
  klToday.setUTCHours(0, 0, 0, 0);
  const start = new Date(klToday.getTime() + offsetDays * 24 * 60 * 60 * 1000 - klOffsetMs);
  const end   = new Date(klToday.getTime() - klOffsetMs);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Approximate cost from token counts (Haiku rates: $0.80/M in, $3.00/M out) */
function estimateCost(inputTokens: number, outputTokens: number): number {
  return inputTokens * 0.0000008 + outputTokens * 0.000003;
}

export async function getDailyDigestData(): Promise<DailyDigestData> {
  const { start, end } = getKLDayBounds(-1);

  const [costResult, msgResult, spotResult, flowResult, reviewResult] = await Promise.all([
    supabase.from("events").select("event_data").eq("event_type", "llm_usage")
      .gte("created_at", start).lt("created_at", end),
    supabase.from("events").select("channel, event_data").eq("event_type", "message")
      .gte("created_at", start).lt("created_at", end),
    supabase.from("spots").select("city, country").gte("created_at", start).lt("created_at", end),
    supabase.from("events").select("event_data").eq("event_type", "flow_complete")
      .gte("created_at", start).lt("created_at", end),
    supabase.from("spots").select("*", { count: "exact", head: true })
      .eq("needs_review", true).not("is_closed", "eq", true),
  ]);

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  for (const row of costResult.data ?? []) {
    const d = row.event_data as any;
    if (d?.input_tokens)  totalInputTokens  += d.input_tokens;
    if (d?.output_tokens) totalOutputTokens += d.output_tokens;
  }
  const totalCost = estimateCost(totalInputTokens, totalOutputTokens);

  let waMessages = 0;
  let webMessages = 0;
  const intentCounts: Record<string, number> = {};
  for (const row of msgResult.data ?? []) {
    if ((row as any).channel === "whatsapp") waMessages++;
    else if ((row as any).channel === "web") webMessages++;
    const intent = (row.event_data as any)?.intent;
    if (intent) intentCounts[intent] = (intentCounts[intent] ?? 0) + 1;
  }
  const topEntry = Object.entries(intentCounts).sort(([, a], [, b]) => b - a)[0];
  const topIntent = topEntry?.[0] ?? "—";
  const topIntentCount = topEntry?.[1] ?? 0;

  const newSpots = (spotResult.data ?? []) as unknown as Array<{ city: string; country?: string }>;

  let contributions = 0;
  let feedbacks = 0;
  for (const row of flowResult.data ?? []) {
    const flow = (row.event_data as any)?.flow;
    if (flow === "contribution") contributions++;
    else if (flow === "feedback") feedbacks++;
  }

  const reviewQueueCount = reviewResult.count ?? 0;

  return { totalCost, totalInputTokens, totalOutputTokens, waMessages, webMessages, newSpots, topIntent, topIntentCount, contributions, feedbacks, reviewQueueCount };
}

export async function hasDailyDigestRunToday(): Promise<boolean> {
  const { start, end } = getKLDayBounds(0);
  const { count } = await supabase.from("events").select("*", { count: "exact", head: true })
    .eq("event_type", "daily_digest").gte("created_at", start).lt("created_at", end);
  return (count ?? 0) > 0;
}

export async function hasStalenessCheckRunToday(): Promise<boolean> {
  const { start, end } = getKLDayBounds(0);
  const { count } = await supabase.from("events").select("*", { count: "exact", head: true })
    .eq("event_type", "staleness_check").gte("created_at", start).lt("created_at", end);
  return (count ?? 0) > 0;
}

// ============================================
// CONTRIBUTOR REVIEW QUEUE — P2.A
// ============================================

/** Count of contributor's spots that are already published (needs_review is false/null) */
export async function getContributorApprovedCount(contributorId: string): Promise<number> {
  const { count } = await supabase.from("spots").select("*", { count: "exact", head: true })
    .eq("contributor_id", contributorId).not("needs_review", "eq", true);
  return count ?? 0;
}

/** Count of spots this contributor created in the last 24 hours */
export async function getContributorSpotCountLast24h(contributorId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await supabase.from("spots").select("*", { count: "exact", head: true })
    .eq("contributor_id", contributorId).gte("created_at", since);
  return count ?? 0;
}

// ============================================
// STALE SPOT RE-VERIFICATION — P2.B
// ============================================

/** Spots not verified in 180+ days, joined with their contributor's WhatsApp number */
export async function getStaleSpotsForVerification(
  limit = 5
): Promise<Array<Spot & { contributor_phone: string }>> {
  const staleThreshold = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();

  const { data: spots } = await supabase
    .from("spots")
    .select("*")
    .not("is_closed", "eq", true)
    .not("needs_review", "eq", true)
    .not("contributor_id", "is", null)
    .or(`last_verified.lt.${staleThreshold},and(last_verified.is.null,created_at.lt.${staleThreshold})`)
    .order("last_verified", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (!spots?.length) return [];

  const contributorIds = [...new Set((spots as any[]).map((s: any) => s.contributor_id as string).filter(Boolean))];
  const { data: contributors } = await supabase
    .from("contributors").select("id, whatsapp_number").in("id", contributorIds);

  const contribMap = new Map(
    (contributors ?? []).map((c: any) => [c.id as string, c.whatsapp_number as string])
  );

  return (spots as any[])
    .map((s: any) => ({ ...s, contributor_phone: contribMap.get(s.contributor_id) }))
    .filter((s: any) => s.contributor_phone) as Array<Spot & { contributor_phone: string }>;
}

/** Refresh last_verified timestamp on a spot — resets the 180-day staleness clock */
export async function markSpotVerified(spotId: string): Promise<void> {
  await supabase.from("spots").update({ last_verified: new Date().toISOString() }).eq("id", spotId);
}
