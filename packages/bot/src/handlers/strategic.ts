// Strategic decisions generation — profile + knowledge graph → pre-trip guide

import { chat, loadPrompt, SONNET } from "../llm.js";
import {
  getOrCreateTraveler,
  querySpots,
  updateConversation,
} from "../database.js";
import { getCurrentWeather } from "../weather.js";
import { formatSpotsForLLM } from "./query.js";
import { getDefaultCity } from "../utils/city-defaults.js";

let _strategicPrompt: string | null = null;
function getStrategicPrompt(): string {
  if (!_strategicPrompt) _strategicPrompt = loadPrompt("strategic");
  return _strategicPrompt;
}

function computeTripDays(tripDates: unknown): number {
  if (!tripDates) return 2;
  const { start, end } = tripDates as { start?: string; end?: string };
  if (!start || !end) return 2;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const days = Math.round(ms / (1000 * 60 * 60 * 24));
  return days >= 1 && days <= 14 ? days : 2;
}

export async function handleStrategic(phoneNumber: string): Promise<string> {
  const traveler = await getOrCreateTraveler(phoneNumber);
  const city = traveler.current_city ?? getDefaultCity();

  if (traveler.user_type === "local") {
    await updateConversation(phoneNumber, { current_flow: "general", flow_state: {} });
    return `You're all set! Just text me whenever you want to find something new in ${city}.`;
  }
  const prefs = traveler.preferences ?? {};
  const excludeIds = traveler.spots_disliked ?? [];
  const tripDays = computeTripDays(traveler.trip_dates);

  // Parallel category queries for better distribution across meal slots
  const [breakfastSpots, lunchSpots, dinnerSpots, nightlifeSpots, activitySpots] =
    await Promise.all([
      querySpots({ city, categories: ["breakfast"], excludeIds, limit: 8 }),
      querySpots({ city, categories: ["lunch"], excludeIds, limit: 8 }),
      querySpots({ city, categories: ["dinner"], excludeIds, limit: 8 }),
      querySpots({ city, categories: ["nightlife"], excludeIds, limit: 6 }),
      querySpots({ city, categories: ["activity", "market", "cafe"], excludeIds, limit: 6 }),
    ]);

  const allSpots = [
    ...breakfastSpots,
    ...lunchSpots,
    ...dinnerSpots,
    ...nightlifeSpots,
    ...activitySpots,
  ];
  const topSpots = allSpots.filter((s) => s.must_go);

  const spotsContext = `
BREAKFAST OPTIONS (${breakfastSpots.length}):
${formatSpotsForLLM(breakfastSpots)}

LUNCH OPTIONS (${lunchSpots.length}):
${formatSpotsForLLM(lunchSpots)}

DINNER OPTIONS (${dinnerSpots.length}):
${formatSpotsForLLM(dinnerSpots)}

NIGHTLIFE / DRINKS (${nightlifeSpots.length}):
${formatSpotsForLLM(nightlifeSpots)}

ACTIVITIES / CAFES / MARKETS (${activitySpots.length}):
${formatSpotsForLLM(activitySpots)}
`.trim();

  const profileSummary = `
Profile:
- Name: ${traveler.name ?? "Unknown"}
- Dates: ${traveler.trip_dates ? `${(traveler.trip_dates as any).start} to ${(traveler.trip_dates as any).end}` : "Not specified"}
- Trip length: ${tripDays} day${tripDays !== 1 ? "s" : ""}
- Party: ${traveler.travel_party ?? "Not specified"}
- Interests: ${(prefs.interests ?? []).join(", ") || "Not specified"}
- Budget: ${prefs.budget ?? "moderate"}
- Pace: ${prefs.pace ?? "moderate"}
- Dietary: ${(traveler.dietary_restrictions ?? []).join(", ") || "None"}
- First time in ${city}: ${traveler.first_time_visitor ? "Yes" : "No"}
${prefs.specific_requests?.length ? `- Specific requests: ${prefs.specific_requests.join(", ")}` : ""}
  `.trim();

  const prompt = `${profileSummary}

Available spots in the knowledge graph (${topSpots.length} must-go spots flagged by contributors):

${spotsContext}

Generate the day-by-day itinerary for ${tripDays} day${tripDays !== 1 ? "s" : ""}. Organize by neighbourhood, cluster nearby spots per day.`;

  const filledPrompt = getStrategicPrompt()
    .replace("{{CITY}}", city.toUpperCase())
    .replace(/\{\{N_DAYS\}\}/g, String(tripDays));
  const strategicMessage = await chat(
    filledPrompt,
    [{ role: "user", content: prompt }],
    { maxTokens: 2048, model: SONNET }
  );

  // Send agreement plan after strategic decisions
  const agreementPlan = `
━━━ WHAT YOU CAN COUNT ON ━━━

✅ I'm available 24/7 while you're here
   Text anytime, response in minutes

✅ If you don't like a spot, I'll fix it immediately
   No questions asked — your time, your call

✅ No rigid schedules, zero pressure
   Use what works, ignore what doesn't

✅ Knowledge stays fresh
   Every spot verified recently by locals

✅ Your data is private
   Conversations never shared, no spam
  `.trim();

  // Transition to general/ontrip flow
  await updateConversation(phoneNumber, {
    current_flow: "general",
    flow_state: { has_strategic_plan: true },
  });

  return `${strategicMessage}\n\n${agreementPlan}`;
}
