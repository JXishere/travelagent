// On-trip guidance — real-time recommendations when the user is in KL

import { chat, HAIKU } from "../llm.js";
import {
  querySpots,
  getOrCreateTraveler,
  incrementSpotUseCount,
  markSpotsVisited,
  type Spot,
} from "../database.js";
import { getCurrentWeather } from "../weather.js";
import { formatSpotsForLLM } from "./query.js";
import { readFileSync } from "fs";
import { join } from "path";

const systemPrompt = readFileSync(
  join(__dirname, "..", "prompts", "system.txt"),
  "utf-8"
);

interface IntentDetails {
  neighborhood?: string;
  meal_type?: string;
  time_of_day?: string;
  mood?: string;
  specific_place?: string;
}

/** Build a preference context string for LLM prompts */
function buildPrefContext(traveler: { dietary_restrictions?: string[]; preferences?: Record<string, any> }): string {
  const lines: string[] = [];
  if (traveler.dietary_restrictions?.length)
    lines.push(`Dietary restrictions: ${traveler.dietary_restrictions.join(", ")}`);
  const prefs = traveler.preferences ?? {};
  if (prefs.budget) lines.push(`Budget: ${prefs.budget}`);
  if (prefs.interests?.length)
    lines.push(`Interests: ${prefs.interests.join(", ")}`);
  return lines.length > 0 ? lines.join("\n") : "";
}

/** "I'm hungry" flow — location + time + preferences → recommend spots */
export async function handleHungry(
  phoneNumber: string,
  message: string,
  details: IntentDetails
): Promise<string> {
  const traveler = await getOrCreateTraveler(phoneNumber);
  const weather = await getCurrentWeather();

  const hour = new Date().getUTCHours() + 8; // KL is UTC+8
  const timeOfDay =
    details.time_of_day ??
    (hour < 11 ? "morning" : hour < 15 ? "afternoon" : hour < 20 ? "evening" : "late-night");

  const mealCategories: Record<string, string[]> = {
    morning: ["breakfast", "cafe"],
    afternoon: ["lunch", "cafe"],
    evening: ["dinner"],
    "late-night": ["nightlife", "dinner"],
  };

  const categories = mealCategories[timeOfDay] ?? ["lunch", "dinner"];

  const spots = await querySpots({
    city: "Kuala Lumpur",
    neighborhood: details.neighborhood,
    categories,
    indoor_outdoor: weather?.is_raining ? "indoor" : undefined,
    limit: 5,
  });

  // Filter out visited spots only for travelers (locals may want to revisit favorites)
  let toRecommend: Spot[];
  if (traveler.user_type !== "local") {
    const unvisited = spots.filter(
      (s) => !traveler.spots_visited?.includes(s.id)
    );
    toRecommend = unvisited.length >= 3 ? unvisited.slice(0, 3) : spots.slice(0, 3);
  } else {
    // For locals, filter out disliked spots instead
    const notDisliked = spots.filter(
      (s) => !traveler.spots_disliked?.includes(s.id)
    );
    toRecommend = notDisliked.slice(0, 3);
  }

  for (const spot of toRecommend) {
    incrementSpotUseCount(spot.id);
  }
  await markSpotsVisited(phoneNumber, toRecommend.map(s => s.id));

  // No spots in DB — be honest
  if (toRecommend.length === 0) {
    const prompt = `The user says: "${message}"

You have NO spots in your knowledge graph yet for this query. Do NOT make up or suggest any restaurants, cafes, or places. Be honest that you don't have recommendations yet. Ask what they're in the mood for so you can help when your knowledge grows, or suggest they contribute spots they discover.

Keep it short — this is WhatsApp.`;

    return await chat(systemPrompt, [{ role: "user", content: prompt }], {
      maxTokens: 512,
      model: HAIKU,
    });
  }

  const spotsContext = formatSpotsForLLM(toRecommend);
  const weatherNote = weather?.is_raining
    ? "It's raining right now — prioritize indoor/covered spots."
    : "";

  const tiredNote =
    details.mood === "tired" || details.mood === "chill"
      ? "They're feeling tired — recommend nearby and chill options."
      : "";

  const prefContext = buildPrefContext(traveler);

  const prompt = `The user says: "${message}"

Time: ${timeOfDay} (KL time)
${details.neighborhood ? `They're near: ${details.neighborhood}` : "Location not specified — you can ask."}
${weatherNote}
${tiredNote}
${prefContext}

Here are spots from your knowledge graph:

${spotsContext}

Recommend naturally. Include full operational details. Respect their dietary restrictions — do NOT recommend dishes or spots that conflict. End by asking which one appeals or if they want something different. Keep it concise — this is WhatsApp, not email.`;

  return await chat(systemPrompt, [{ role: "user", content: prompt }], {
    maxTokens: 1024,
  });
}

/** "What should I do today?" flow — build a loose day structure */
export async function handleDayPlan(
  phoneNumber: string,
  message: string,
  details: IntentDetails
): Promise<string> {
  const traveler = await getOrCreateTraveler(phoneNumber);
  const weather = await getCurrentWeather();

  // Get a mix of spots for the day
  const breakfastSpots = await querySpots({ city: "Kuala Lumpur", categories: ["breakfast", "cafe"], limit: 3 });
  const lunchSpots = await querySpots({ city: "Kuala Lumpur", categories: ["lunch"], limit: 3 });
  const activitySpots = await querySpots({ city: "Kuala Lumpur", categories: ["activity", "market"], limit: 3 });
  const dinnerSpots = await querySpots({ city: "Kuala Lumpur", categories: ["dinner"], limit: 3 });

  const allDaySpots = [...breakfastSpots, ...lunchSpots, ...activitySpots, ...dinnerSpots];
  const spotsContext = formatSpotsForLLM(allDaySpots);

  // Mark all recommended spots as visited
  await markSpotsVisited(phoneNumber, allDaySpots.map(s => s.id));

  const prefContext = buildPrefContext(traveler);

  const prompt = `The user asks: "${message}"

${weather ? `Weather: ${weather.summary}` : ""}
${details.mood ? `Their energy/mood: ${details.mood}` : ""}
${prefContext}
Spots they've already visited: ${traveler.spots_visited?.length ?? 0}

Available spots for building a day plan:

${spotsContext}

Build a loose, conversational day structure. NOT a rigid itinerary — more like "here's a nice flow for today." Ask about their energy level if they didn't mention it. Include operational details for each spot. Respect their dietary restrictions — skip dishes that conflict. End with "text me when you're hungry or want to adjust!"`;

  return await chat(systemPrompt, [{ role: "user", content: prompt }], {
    maxTokens: 1500,
  });
}

/** "I'm near X" flow — nearby recommendations */
export async function handleNearby(
  phoneNumber: string,
  message: string,
  details: IntentDetails
): Promise<string> {
  const traveler = await getOrCreateTraveler(phoneNumber);
  const weather = await getCurrentWeather();

  const neighborhood = details.neighborhood ?? details.specific_place;

  const spots = await querySpots({
    city: "Kuala Lumpur",
    neighborhood,
    indoor_outdoor: weather?.is_raining ? "indoor" : undefined,
    limit: 5,
  });

  const spotsContext = formatSpotsForLLM(spots);

  // Track usage and mark as visited
  for (const spot of spots) {
    incrementSpotUseCount(spot.id);
  }
  await markSpotsVisited(phoneNumber, spots.map(s => s.id));

  const prefContext = buildPrefContext(traveler);

  const prompt = `The user says: "${message}"

${weather ? `Weather: ${weather.summary}` : ""}
${neighborhood ? `They're near: ${neighborhood}` : "Location unclear — ask them."}
${prefContext}

Nearby spots from knowledge graph:

${spotsContext}

Give them a quick, varied list of what's nearby — mix food and activities. Respect their dietary restrictions. Include walking distance estimates if you can infer from neighborhood. Keep it casual.`;

  return await chat(systemPrompt, [{ role: "user", content: prompt }], {
    maxTokens: 1024,
  });
}
