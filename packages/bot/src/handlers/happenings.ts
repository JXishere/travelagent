// Happenings handler — events, festivals, markets, what's on this week

import { chat, buildSystemPrompt, webSearchHappenings, langInstruction } from "../llm.js";
import { getOrCreateTraveler, queryHappenings, type Happening } from "../database.js";
import { getDefaultCity } from "../utils/city-defaults.js";

export interface HappeningsPayload {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
}

/**
 * Build the happenings prompt payload (DB 7-day lookahead + web search).
 * Used by both handleHappenings (WhatsApp) and the web streaming route.
 */
export async function buildHappeningsPayload(
  userId: string,
  message: string,
  recentContext: string,
  options: { channel: "whatsapp" | "web" }
): Promise<HappeningsPayload> {
  const traveler = await getOrCreateTraveler(userId);
  const city = traveler.current_city ?? getDefaultCity();
  const todayDate = new Date().toISOString().split("T")[0];

  // DB (7-day lookahead) + web search in parallel
  const [dbHappenings, webHappenings] = await Promise.all([
    queryHappenings(city, todayDate, 7).catch(() => [] as Happening[]),
    webSearchHappenings(city, todayDate).catch(() => []),
  ]);

  // De-duplicate: drop web results whose name matches a DB entry
  const dbNames = new Set(dbHappenings.map(h => h.name.toLowerCase()));
  const uniqueWebHappenings = webHappenings.filter(
    h => !dbNames.has(h.name.toLowerCase())
  );

  const systemPrompt = buildSystemPrompt(city, options.channel) + langInstruction(message);

  if (dbHappenings.length === 0 && uniqueWebHappenings.length === 0) {
    const userPrompt = `The user asked: "${message}"\n\nYou don't have specific events or happenings in your knowledge base for ${city} this week. Be honest and warm — let them know, and suggest they check local listings like Time Out KL or KLUE for what's on. Two or three sentences.`;
    return { systemPrompt, userPrompt, maxTokens: 150 };
  }

  const formatDbHappening = (h: Happening): string => {
    const parts: string[] = [h.name];
    if (h.area) parts.push(`in ${h.area}`);
    if (h.description) parts.push(h.description);
    if (h.recurring && h.recurrence_rule) parts.push(`(${h.recurrence_rule})`);
    else if (h.start_date && h.start_date !== todayDate) {
      const end = h.end_date ? ` to ${h.end_date}` : "";
      parts.push(`${h.start_date}${end}`);
    }
    if (h.categories?.length) parts.push(`[${h.categories.join(", ")}]`);
    return parts.join(" — ");
  };

  const formatWebHappening = (h: (typeof webHappenings)[0]): string => {
    const parts: string[] = [`${h.name} (from web, unverified)`];
    if (h.area) parts.push(`in ${h.area}`);
    if (h.description) parts.push(h.description);
    if (h.date_range) parts.push(`when: ${h.date_range}`);
    if (h.recurring && h.recurrence_rule) parts.push(`(${h.recurrence_rule})`);
    if (h.categories?.length) parts.push(`[${h.categories.join(", ")}]`);
    return parts.join(" — ");
  };

  const allHappenings = [
    ...dbHappenings.map((h, i) => `${i + 1}. ${formatDbHappening(h)}`),
    ...uniqueWebHappenings.map((h, i) => `${dbHappenings.length + i + 1}. ${formatWebHappening(h)}`),
  ].join("\n");

  const userPrompt = `The user asked: "${message}"
${recentContext ? `\nRecent conversation:\n${recentContext}\n` : ""}
Here are the happenings and events in ${city} this week:

${allHappenings}

Pick out the most interesting ones and tell the user about them as Sam — warm, opinionated, conversational. Web-sourced events (marked "from web, unverified") should be lightly flagged as worth double-checking before heading out. Don't just recite the list — give it some personality.`;

  return { systemPrompt, userPrompt, maxTokens: 400 };
}

/** Handle a happenings query — returns a Sam-voiced response string (WhatsApp / non-streaming) */
export async function handleHappenings(
  userId: string,
  message: string,
  recentContext: string,
  options: { channel: "whatsapp" | "web" }
): Promise<string> {
  const { systemPrompt, userPrompt, maxTokens } = await buildHappeningsPayload(
    userId,
    message,
    recentContext,
    options
  );
  return chat(systemPrompt, [{ role: "user", content: userPrompt }], { maxTokens });
}
