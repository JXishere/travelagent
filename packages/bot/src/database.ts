// Supabase client — all database operations

import { createClient } from "@supabase/supabase-js";
import { getDefaultCity } from "./utils/city-defaults.js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
);

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
}

export async function getOrCreateConversation(
  phoneNumber: string
): Promise<Conversation> {
  const { data } = await supabase
    .from("conversations")
    .select("*")
    .eq("whatsapp_number", phoneNumber)
    .single();

  if (data) return data as Conversation;

  const { data: created, error } = await supabase
    .from("conversations")
    .insert({ whatsapp_number: phoneNumber })
    .select()
    .single();

  if (error) throw error;
  return created as Conversation;
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
  const convo = await getOrCreateConversation(phoneNumber);
  const allMessages = [...convo.messages, ...newMessages];
  const trimmed = allMessages.slice(-MAX_CONVERSATION_MESSAGES);
  await updateConversation(phoneNumber, { messages: trimmed });
}

// ============================================
// SPOTS
// ============================================

export interface Spot {
  id: string;
  name: string;
  city: string;
  neighborhood?: string;
  category?: string;
  tier?: number;
  address?: string;
  latitude?: number;
  longitude?: number;
  google_pin_accurate?: boolean;
  payment_methods?: string[];
  opening_hours?: Record<string, string>;
  price_range?: string;
  what_to_order?: string[];
  what_to_skip?: string[];
  pro_tips?: string[];
  vibe?: string;
  weather_dependent?: boolean;
  best_time_of_day?: string;
  indoor_outdoor?: string;
  contributor_id?: string;
  confidence_score?: number;
  use_count?: number;
  source?: string;
}

export async function querySpots(filters: {
  city?: string;
  neighborhood?: string;
  category?: string;
  categories?: string[];
  indoor_outdoor?: string;
  tier?: number;
  limit?: number;
}): Promise<Spot[]> {
  let query = supabase
    .from("spots")
    .select("*")
    .order("tier", { ascending: true })
    .order("confidence_score", { ascending: false });

  if (filters.city) query = query.eq("city", filters.city);
  if (filters.neighborhood)
    query = query.ilike("neighborhood", `%${filters.neighborhood}%`);
  if (filters.category) query = query.eq("category", filters.category);
  if (filters.categories)
    query = query.in("category", filters.categories);
  if (filters.indoor_outdoor)
    query = query.in("indoor_outdoor", [filters.indoor_outdoor, "both"]);
  if (filters.tier) query = query.lte("tier", filters.tier);

  query = query.limit(filters.limit ?? 5);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Spot[];
}

export async function insertSpot(spot: Partial<Spot>): Promise<Spot> {
  const { data, error } = await supabase
    .from("spots")
    .insert({ city: getDefaultCity(), ...spot })
    .select()
    .single();
  if (error) throw error;
  return data as Spot;
}

export async function findDuplicateSpot(
  name: string,
  neighborhood?: string
): Promise<Spot | null> {
  let query = supabase
    .from("spots")
    .select("*")
    .ilike("name", name);

  if (neighborhood) {
    query = query.ilike("neighborhood", `%${neighborhood}%`);
  }

  const { data } = await query.limit(1).maybeSingle();
  return (data as Spot) ?? null;
}

export async function getSpotById(spotId: string): Promise<Spot | null> {
  const { data } = await supabase
    .from("spots")
    .select("*")
    .eq("id", spotId)
    .single();
  return (data as Spot) ?? null;
}

export async function updateSpot(spotId: string, updates: Partial<Spot>): Promise<void> {
  await supabase
    .from("spots")
    .update(updates)
    .eq("id", spotId);
}

export async function incrementSpotUseCount(spotId: string): Promise<void> {
  const { data } = await supabase
    .from("spots")
    .select("use_count")
    .eq("id", spotId)
    .single();

  if (data) {
    await supabase
      .from("spots")
      .update({ use_count: ((data as Pick<Spot, 'use_count'>).use_count ?? 0) + 1 })
      .eq("id", spotId);
  }
}

// ============================================
// TRAVELERS
// ============================================

export interface Traveler {
  id: string;
  whatsapp_number: string;
  name?: string;
  user_type: "local" | "traveler" | "unknown";
  home_neighborhoods: string[];
  preferences: Record<string, any>;
  dietary_restrictions: string[];
  current_city?: string;
  trip_dates?: { start: string; end: string };
  travel_party?: string;
  first_time_visitor?: boolean;
  spots_visited: string[];
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

  if (data) return data as Traveler;

  const { data: created, error } = await supabase
    .from("travelers")
    .insert({ whatsapp_number: phoneNumber })
    .select()
    .single();

  if (error) throw error;
  return created as Traveler;
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

export async function markSpotVisited(
  phoneNumber: string,
  spotId: string
): Promise<void> {
  const traveler = await getOrCreateTraveler(phoneNumber);
  const existing = new Set(traveler.spots_visited ?? []);
  existing.add(spotId);
  await updateTraveler(phoneNumber, { spots_visited: [...existing] });
}

export async function markSpotsVisited(
  phoneNumber: string,
  spotIds: string[]
): Promise<void> {
  const traveler = await getOrCreateTraveler(phoneNumber);
  const existing = new Set(traveler.spots_visited ?? []);
  for (const id of spotIds) existing.add(id);
  await updateTraveler(phoneNumber, { spots_visited: [...existing] });
}

// ============================================
// CONTRIBUTORS
// ============================================

export interface Contributor {
  id: string;
  whatsapp_number: string;
  name?: string;
  spots_contributed: number;
}

export async function getOrCreateContributor(
  phoneNumber: string
): Promise<Contributor> {
  const { data } = await supabase
    .from("contributors")
    .select("*")
    .eq("whatsapp_number", phoneNumber)
    .single();

  if (data) return data as Contributor;

  const { data: created, error } = await supabase
    .from("contributors")
    .insert({ whatsapp_number: phoneNumber })
    .select()
    .single();

  if (error) throw error;
  return created as Contributor;
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
      spots_contributed: contributor.spots_contributed + 1,
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
    (conversations ?? []).map((c: any) => [c.whatsapp_number, c])
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

/** Get spots from spots_visited that haven't been asked about in feedback yet */
export async function getSpotsNeedingFeedback(
  phoneNumber: string
): Promise<Spot[]> {
  const traveler = await getOrCreateTraveler(phoneNumber);
  if (!traveler.spots_visited?.length) return [];

  const asked = new Set(traveler.spots_feedback_asked ?? []);
  const needFeedback = traveler.spots_visited.filter((id) => !asked.has(id));
  if (needFeedback.length === 0) return [];

  const { data } = await supabase
    .from("spots")
    .select("*")
    .in("id", needFeedback.slice(-5));

  return (data ?? []) as Spot[];
}

// ============================================
// FEEDBACK
// ============================================

export interface Feedback {
  id: string;
  spot_id: string;
  traveler_id: string;
  rating: number;
  did_they_go: boolean;
  comments?: string;
  user_tips?: string[];
}

export async function insertFeedback(
  feedback: Omit<Feedback, "id">
): Promise<void> {
  await supabase.from("feedback").insert(feedback);

  // Update spot confidence score based on rating
  if (feedback.rating) {
    const { data: spot } = await supabase
      .from("spots")
      .select("confidence_score")
      .eq("id", feedback.spot_id)
      .single();

    if (spot) {
      // Moving average: nudge confidence toward the rating (normalized 0-1)
      const newConfidence =
        (spot.confidence_score ?? 0.7) * 0.8 + (feedback.rating / 5) * 0.2;
      await supabase
        .from("spots")
        .update({
          confidence_score: Math.round(newConfidence * 100) / 100,
          last_verified: new Date().toISOString(),
        })
        .eq("id", feedback.spot_id);
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

export async function getRecentlyRecommendedSpots(
  phoneNumber: string
): Promise<Spot[]> {
  const traveler = await getOrCreateTraveler(phoneNumber);
  if (!traveler.spots_visited?.length) return [];

  const { data } = await supabase
    .from("spots")
    .select("*")
    .in("id", traveler.spots_visited.slice(-5));

  return (data ?? []) as Spot[];
}
