// Profile learning flow — conversational interview to learn user preferences

import { chat, chatAsSam, extractJSON, loadPrompt, HAIKU } from "../llm.js";
import {
  getOrCreateTraveler,
  updateTraveler,
  updateConversation,
  trackEvent,
  type Conversation,
} from "../database.js";
import { getDefaultCity } from "../utils/city-defaults.js";

let _profilePrompt: string | null = null;
function getProfilePrompt(): string {
  if (!_profilePrompt) _profilePrompt = loadPrompt("profile");
  return _profilePrompt;
}

interface ExtractedProfile {
  name?: string;
  user_type?: "local" | "traveler";
  home_neighborhoods?: string[];
  cuisine_preferences?: string[];
  trip_dates?: { start: string; end: string };
  travel_party?: string;
  interests?: string[];
  budget?: string;
  pace?: string;
  dietary_restrictions?: string[];
  first_time_visitor?: boolean;
  specific_requests?: string[];
}

export async function handleProfile(
  phoneNumber: string,
  message: string,
  conversation: Conversation
): Promise<string> {
  // Build the conversation history for Claude
  const history = conversation.messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  // Get Claude's response in Sam's profile-learning mode
  const response = await chat(
    getProfilePrompt(),
    [...history, { role: "user" as const, content: message }],
    { maxTokens: 512, model: HAIKU }
  );

  // Check if profile is complete — case-insensitive, flexible format
  if (/\[PROFILE[_\s]?COMPLETE\]/i.test(response)) {
    // Extract the profile from the full conversation
    const fullConvo = [
      ...history,
      { role: "user" as const, content: message },
      { role: "assistant" as const, content: response },
    ]
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    // Reuse continuous_profile prompt — same extraction schema, just applied to the full
    // interview conversation instead of a single message exchange
    const profile = await extractJSON<ExtractedProfile>(
      "continuous_profile",
      `Extract a user profile from this conversation. Determine if they are a "local" or "traveler" based on context. For locals, extract home_neighborhoods and cuisine_preferences. For travelers, extract trip_dates, travel_party, first_time_visitor.\n\n${fullConvo}`,
      undefined,
      { templateVars: { CITY: getDefaultCity() } },
    );

    // Save to database
    const traveler = await getOrCreateTraveler(phoneNumber);
    const travelerUpdates: Record<string, any> = {
      name: profile.name,
      user_type: profile.user_type ?? "unknown",
      preferences: {
        interests: profile.interests,
        budget: profile.budget,
        pace: profile.pace,
        cuisine_preferences: profile.cuisine_preferences,
        specific_requests: profile.specific_requests,
      },
      dietary_restrictions: profile.dietary_restrictions ?? [],
      current_city: traveler.current_city ?? getDefaultCity(),
    };

    if (profile.user_type === "local") {
      travelerUpdates.home_neighborhoods = profile.home_neighborhoods ?? [];
    } else {
      travelerUpdates.trip_dates = profile.trip_dates;
      travelerUpdates.travel_party = profile.travel_party;
      travelerUpdates.first_time_visitor = profile.first_time_visitor;
    }

    await updateTraveler(phoneNumber, travelerUpdates);

    trackEvent(phoneNumber, "whatsapp", "flow_complete", {
      flow: "profile",
      user_type: profile.user_type,
    });

    // Branch flow based on user type
    if (profile.user_type === "local") {
      // Locals skip strategic guide — go straight to general
      await updateConversation(phoneNumber, {
        current_flow: "general",
        flow_state: {},
      });
    } else {
      // Travelers get the strategic decisions flow
      await updateConversation(phoneNumber, {
        current_flow: "strategic",
        flow_state: { profile_just_completed: true },
      });
    }

    // Return Claude's response without the marker
    return response.replace(/\[PROFILE[_\s]?COMPLETE\]/i, "").trim();
  }

  return response;
}

/** Kick off the profile learning flow */
export async function startProfileLearning(
  phoneNumber: string,
  initialMessage?: string
): Promise<string> {
  // Check if we already have some profile data
  const traveler = await getOrCreateTraveler(phoneNumber);
  if (traveler.preferences && Object.keys(traveler.preferences).length > 0) {
    // Returning user — don't trap them in interview mode.
    // Continuous profile extraction will capture any updates from their message.
    if (initialMessage) {
      return await chatAsSam([], initialMessage);
    }
    if (traveler.user_type === "local") {
      return "Hey, welcome back! Anything new you want to explore?";
    }
    return "Welcome back! What can I help you find?";
  }

  // New user — start the profile learning flow
  await updateConversation(phoneNumber, {
    current_flow: "profile_learning",
    flow_state: { stage: "interviewing" },
  });

  // If the user's first message already has profile info, respond to it
  if (initialMessage) {
    return await chat(
      getProfilePrompt(),
      [{ role: "user", content: initialMessage }],
      { maxTokens: 512, model: HAIKU }
    );
  }

  const city = getDefaultCity();
  return `Hey! I'm Sam — your ${city} insider.

Whether you're visiting or you live here, I'll point you to the best spots. Quick question: are you planning a trip to ${city}, or do you live here?`;
}
