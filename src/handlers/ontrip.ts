// On-trip guidance — real-time recommendations when the traveler is in KL

import { chat } from "../llm.js";
import {
  querySpots,
  getOrCreateTraveler,
  incrementSpotUseCount,
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

  // Filter out spots they've already visited
  const unvisited = spots.filter(
    (s) => !traveler.spots_visited?.includes(s.id)
  );
  const toRecommend = unvisited.length >= 3 ? unvisited.slice(0, 3) : spots.slice(0, 3);

  for (const spot of toRecommend) {
    incrementSpotUseCount(spot.id);
  }

  const spotsContext = formatSpotsForLLM(toRecommend);
  const weatherNote = weather?.is_raining
    ? "It's raining right now — prioritize indoor/covered spots."
    : "";

  const tiredNote =
    details.mood === "tired" || details.mood === "chill"
      ? "They're feeling tired — recommend nearby and chill options."
      : "";

  const prompt = `The traveler says: "${message}"

Time: ${timeOfDay} (KL time)
${details.neighborhood ? `They're near: ${details.neighborhood}` : "Location not specified — you can ask."}
${weatherNote}
${tiredNote}
Traveler interests: ${(traveler.preferences as any)?.interests?.join(", ") ?? "food"}

Here are spots from your knowledge graph:

${spotsContext}

Recommend naturally. Include full operational details. End by asking which one appeals or if they want something different.`;

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

  const prompt = `The traveler asks: "${message}"

${weather ? `Weather: ${weather.summary}` : ""}
${details.mood ? `Their energy/mood: ${details.mood}` : ""}
Traveler interests: ${(traveler.preferences as any)?.interests?.join(", ") ?? "food, culture"}
Spots they've already visited: ${traveler.spots_visited?.length ?? 0}

Available spots for building a day plan:

${spotsContext}

Build a loose, conversational day structure. NOT a rigid itinerary — more like "here's a nice flow for today." Ask about their energy level if they didn't mention it. Include operational details for each spot. End with "text me when you're hungry or want to adjust!"`;

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

  const prompt = `The traveler says: "${message}"

${weather ? `Weather: ${weather.summary}` : ""}
${neighborhood ? `They're near: ${neighborhood}` : "Location unclear — ask them."}

Nearby spots from knowledge graph:

${spotsContext}

Give them a quick, varied list of what's nearby — mix food and activities. Include walking distance estimates if you can infer from neighborhood. Keep it casual.`;

  return await chat(systemPrompt, [{ role: "user", content: prompt }], {
    maxTokens: 1024,
  });
}
