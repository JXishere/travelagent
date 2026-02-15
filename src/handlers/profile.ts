// Profile learning flow — conversational interview to learn traveler preferences

import { chat, extractJSON } from "../llm.js";
import {
  getOrCreateTraveler,
  updateTraveler,
  updateConversation,
  type Conversation,
} from "../database.js";
import { readFileSync } from "fs";
import { join } from "path";

const profilePrompt = readFileSync(
  join(__dirname, "..", "prompts", "profile.txt"),
  "utf-8"
);

interface ExtractedProfile {
  name?: string;
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

  // Get Claude's response in Paul's profile-learning mode
  const response = await chat(
    profilePrompt,
    [...history, { role: "user" as const, content: message }],
    { maxTokens: 512 }
  );

  // Check if profile is complete
  if (response.includes("[PROFILE_COMPLETE]")) {
    // Extract the profile from the full conversation
    const fullConvo = [
      ...history,
      { role: "user" as const, content: message },
      { role: "assistant" as const, content: response },
    ]
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const profile = await extractJSON<ExtractedProfile>(
      "profile",
      `Extract a traveler profile from this conversation:\n\n${fullConvo}`,
    );

    // Save to database
    await updateTraveler(phoneNumber, {
      name: profile.name,
      trip_dates: profile.trip_dates as any,
      travel_party: profile.travel_party,
      preferences: {
        interests: profile.interests,
        budget: profile.budget,
        pace: profile.pace,
        specific_requests: profile.specific_requests,
      },
      dietary_restrictions: profile.dietary_restrictions ?? [],
      first_time_visitor: profile.first_time_visitor,
      current_city: "Kuala Lumpur",
    });

    // Transition to strategic decisions flow
    await updateConversation(phoneNumber, {
      current_flow: "strategic",
      flow_state: { profile_just_completed: true },
    });

    // Return Claude's response without the marker
    return response.replace("[PROFILE_COMPLETE]", "").trim();
  }

  return response;
}

/** Kick off the profile learning flow */
export async function startProfileLearning(
  phoneNumber: string
): Promise<string> {
  await updateConversation(phoneNumber, {
    current_flow: "profile_learning",
    flow_state: { stage: "interviewing" },
  });

  // Check if we already have some profile data
  const traveler = await getOrCreateTraveler(phoneNumber);
  if (traveler.preferences && Object.keys(traveler.preferences).length > 0) {
    return "Welcome back! Planning another trip to KL? Tell me what's changed — new dates, different vibe, or just picking up where we left off?";
  }

  return `Hey! I'm Paul — your KL insider. 🇲🇾

Here's how this works:

1️⃣ Tell me about your trip (where, when, who)
2️⃣ I'll ask a few questions about your style
3️⃣ I'll give you strategic decisions (where to stay, what to book ahead)
4️⃣ When you land, text me — I'll guide you day-by-day
5️⃣ After your trip, tell me how spots were

You don't need to plan everything now. I've got you from start to finish.

So — when are you heading to KL?`;
}
