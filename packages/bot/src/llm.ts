// Claude API wrapper — manages system prompt, history, and structured outputs

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";
import { getDefaultCity } from "./utils/city-defaults.js";

const client = new Anthropic(); // uses ANTHROPIC_API_KEY env var

export const SONNET = "claude-sonnet-4-5-20250929";
export const HAIKU = "claude-haiku-4-5-20251001";

/** Detect if a message is primarily Malay — checks for common Malay function words */
export function detectLanguage(message: string): "ms" | "en" {
  const malay = /\b(nak|makan|sedap|kat|ada|tak|boleh|macam|mana|bawak|bagi|lah|pun|dah|je|kan|lagi|memang|cari|jumpa|tempat|dalam|dekat|tahu|rasa|pasal|sebab|dengan|untuk|saya|kita|awak|bila|kalau|habis|sekarang|pagi|petang|malam|tengahari)\b/gi;
  return (message.match(malay) ?? []).length >= 2 ? "ms" : "en";
}

/** System prompt suffix to inject when the user writes in Malay */
export function langInstruction(message: string): string {
  return detectLanguage(message) === "ms"
    ? "\n\nIMPORTANT: The user wrote in Malay. You MUST reply entirely in Malay (Bahasa Malaysia). Do not switch to English."
    : "";
}

/** End-of-user-prompt reminder written in Malay — recency reinforcement for multi-block responses */
export function langUserNote(message: string): string {
  return detectLanguage(message) === "ms"
    ? "\n\nPENTING: Balas semua dalam Bahasa Malaysia sahaja. Jangan tukar ke English."
    : "";
}

// --- Per-request token tracking ---
interface UsageBucket {
  input_tokens: number;
  output_tokens: number;
  calls: number;
}
const _usage = new Map<string, UsageBucket>();

/** Start tracking tokens for a session (call at start of processMessage) */
export function startUsageTracking(sessionId: string): void {
  _usage.set(sessionId, { input_tokens: 0, output_tokens: 0, calls: 0 });
}

/** Flush accumulated usage and return it (call at end of processMessage) */
export function flushUsage(sessionId: string): UsageBucket | null {
  const bucket = _usage.get(sessionId);
  _usage.delete(sessionId);
  return bucket ?? null;
}

/** Internal: accumulate tokens for the active session */
function recordUsage(model: string, usage: { input_tokens: number; output_tokens: number }): void {
  // Accumulate into all active buckets (typically just one)
  for (const bucket of _usage.values()) {
    bucket.input_tokens += usage.input_tokens;
    bucket.output_tokens += usage.output_tokens;
    bucket.calls += 1;
  }
}

let promptsDir = join(__dirname, "prompts");

/** Override the prompts directory (for use outside the bot package, e.g. Next.js) */
export function setPromptsDir(dir: string): void {
  promptsDir = dir;
}

/** Load a prompt file by name */
export function loadPrompt(name: string): string {
  return readFileSync(join(promptsDir, `${name}.txt`), "utf-8");
}

export type MessageRole = "user" | "assistant";

export interface ChatMessage {
  role: MessageRole;
  content: string;
}

/** Core chat — send messages to Claude with a system prompt */
export async function chat(
  systemPrompt: string,
  messages: ChatMessage[],
  options?: { maxTokens?: number; temperature?: number; model?: string }
): Promise<string> {
  const model = options?.model ?? HAIKU;
  const response = await client.messages.create({
    model,
    max_tokens: options?.maxTokens ?? 512,
    system: systemPrompt,
    messages,
    temperature: options?.temperature ?? 0.7,
  });

  recordUsage(model, response.usage);

  const block = response.content[0];
  if (block.type === "text") return block.text;
  return "";
}

/** Build the system prompt with city substitution and optional channel addendum */
export function buildSystemPrompt(city: string, channel?: "whatsapp" | "web"): string {
  let prompt = loadPrompt("system").replaceAll("{{CITY}}", city);
  if (channel) {
    try {
      prompt += "\n\n" + loadPrompt(`system-${channel}`);
    } catch { /* no addendum file for this channel — silently skip */ }
  }
  return prompt;
}

/** Chat with Sam's personality — the main conversation mode */
export async function chatAsSam(
  history: ChatMessage[],
  userMessage: string,
  options?: { city?: string; channel?: "whatsapp" | "web" }
): Promise<string> {
  const city = options?.city ?? getDefaultCity();
  const systemPrompt = buildSystemPrompt(city, options?.channel) + langInstruction(userMessage);
  const messages: ChatMessage[] = [
    ...history,
    { role: "user", content: userMessage },
  ];
  return chat(systemPrompt, messages);
}

/** Quick Sam-voiced response for conversational glue (Haiku, max 100 tokens) */
export async function samSays(instruction: string, city?: string): Promise<string> {
  const systemPrompt = loadPrompt("system").replaceAll("{{CITY}}", city ?? getDefaultCity());
  return chat(systemPrompt, [{ role: "user", content: instruction }], {
    maxTokens: 100,
    model: HAIKU,
  });
}

/** Streaming chat — returns an Anthropic MessageStream for token-by-token output */
export function chatStream(
  systemPrompt: string,
  messages: ChatMessage[],
  options?: { maxTokens?: number; temperature?: number; model?: string }
) {
  const model = options?.model ?? HAIKU;
  const stream = client.messages.stream({
    model,
    max_tokens: options?.maxTokens ?? 512,
    system: systemPrompt,
    messages,
    temperature: options?.temperature ?? 0.7,
  });

  // Auto-record usage when stream completes
  stream.on('message', (msg) => {
    recordUsage(model, msg.usage);
  });

  return stream;
}

/** Streaming chat with Sam's personality */
export function chatAsSamStream(
  history: ChatMessage[],
  userMessage: string,
  options?: { city?: string; channel?: "whatsapp" | "web" }
) {
  const city = options?.city ?? getDefaultCity();
  const systemPrompt = buildSystemPrompt(city, options?.channel) + langInstruction(userMessage);
  const messages: ChatMessage[] = [
    ...history,
    { role: "user", content: userMessage },
  ];
  return chatStream(systemPrompt, messages);
}

/** Extract structured JSON from text (for voice note extraction, profile learning, etc.) */
export async function extractJSON<T>(
  promptName: string,
  input: string,
  context?: string,
  options?: { model?: string; templateVars?: Record<string, string> }
): Promise<T> {
  let systemPrompt = loadPrompt(promptName);
  if (options?.templateVars) {
    for (const [key, value] of Object.entries(options.templateVars)) {
      systemPrompt = systemPrompt.replaceAll(`{{${key}}}`, value);
    }
  }
  const userContent = context
    ? `Context:\n${context}\n\nInput:\n${input}`
    : input;

  const response = await chat(systemPrompt, [{ role: "user", content: userContent }], {
    temperature: 0.3,
    model: options?.model ?? HAIKU,
  });

  // Parse JSON from the response — handle markdown code blocks
  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : response.trim();
  return JSON.parse(jsonStr) as T;
}

/** Classify a user's response during contribution confirmation */
export async function classifyConfirmation(
  message: string,
  spotSummary: string
): Promise<"confirm" | "correct" | "question" | "unrelated"> {
  const systemPrompt = `You classify a user's response after being shown a spot summary they contributed to a travel knowledge graph.

Classify into exactly one category:
- "confirm": Happy with the summary (e.g. "yes", "looks good", "perfect", "👍", "save it", "nice", "done")
- "correct": Wants to fix or add info about THIS spot (e.g. "actually it's in Bangsar", "they also have great roti canai", "change the vibe")
- "question": Asking about the summary, the data, or the process (e.g. "where did you get this info?", "is this from the web?", "why dinner and not lunch?", "how do you know the hours?")
- "unrelated": Talking about something else entirely (e.g. "I'm hungry", "what should I do today", "hey", "where should I eat")

If the message has BOTH confirmation AND new spot info ("yeah also they close on Mondays"), classify as "correct".

Respond with ONLY one word: confirm, correct, question, or unrelated`;

  const result = await chat(
    systemPrompt,
    [{ role: "user", content: `Spot summary shown:\n${spotSummary}\n\nUser's response: ${message}` }],
    { temperature: 0.1, model: HAIKU, maxTokens: 10 }
  );

  const cleaned = result.trim().toLowerCase();
  if (cleaned === "confirm" || cleaned === "correct" || cleaned === "question" || cleaned === "unrelated") {
    return cleaned;
  }
  return "confirm";
}

/** Search the web for spot details and return structured data */
export async function webSearchSpot(
  spotName: string,
  city: string,
  category?: string
): Promise<Record<string, any>> {
  const categoryHint = category ? ` (${category})` : "";
  const systemPrompt = `You are a research assistant. Search for "${spotName}"${categoryHint} in ${city} and return a JSON object with any details you can find. Use this exact shape (omit fields you can't find):

{
  "name": "official name",
  "categories": ["breakfast"],
  "area": "area/district name",
  "address": "street address",
  "opening_hours": { "Monday": "9:00 AM - 10:00 PM", "Tuesday": "...", ... },
  "price_range": "$|$$|$$$",
  "payment_methods": ["cash", "card", etc],
  "what_to_order": ["popular dishes/items"],
  "pro_tips": ["useful tips for visitors"],
  "vibe": "casual|upscale|chaotic|chill|local|touristy",
}

Return ONLY the JSON object, no markdown fences or extra text.`;

  try {
    const response = await client.messages.create({
      model: HAIKU,
      max_tokens: 1024,
      temperature: 0.2,
      system: systemPrompt,
      messages: [{ role: "user", content: `Look up ${spotName} in ${city}` }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }],
    });

    recordUsage(HAIKU, response.usage);

    // Get the LAST text block — earlier ones are just search narration
    const textBlocks = response.content.filter((b) => b.type === "text");
    const textBlock = textBlocks[textBlocks.length - 1];
    if (!textBlock || textBlock.type !== "text") return {};
    // Try markdown code block first, then bare JSON object anywhere in text
    const fenceMatch = textBlock.text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const bareMatch = textBlock.text.match(/\{[\s\S]*\}/);
    const jsonStr = fenceMatch ? fenceMatch[1].trim() : bareMatch ? bareMatch[0] : textBlock.text.trim();
    const parsed = JSON.parse(jsonStr);
    return parsed;
  } catch (error) {
    console.error("webSearchSpot failed:", error);
    return {};
  }
}

/** Classify user intent */
export async function classifyIntent(
  message: string,
  conversationContext?: string,
  city?: string
): Promise<{
  intent:
    | "hungry"
    | "day_plan"
    | "nearby"
    | "weather"
    | "contribute"
    | "profile"
    | "feedback"
    | "spot_info"
    | "spot_correction"
    | "general";
  details: Record<string, string>;
}> {
  const cityName = city ?? "Kuala Lumpur";
  const systemPrompt = `You are an intent classifier for a travel assistant focused on ${cityName}.

Classify the user's message into exactly one intent:

- "spot_correction": They are reporting that a specific spot has incorrect or outdated information — it closed, moved, changed, is wrong, or no longer exists. Triggers: "that place closed", "it's closed now", "they moved", "wrong address", "that's outdated", "doesn't exist anymore", "shut down", "not there anymore", "[place] closed down". Extract the place name into spot_name and the correction detail into correction. Do NOT confuse with negative feedback about a visit ("it was bad") — that's "feedback".
- "spot_info": They are asking about a specific, named place — hours, address, payment, what to order, or want more detail about a place. Triggers: "is [place] open", "address for [place]", "cash only at [place]", "tell me more about [place]", "what's [place] like", "does [place] take card". Extract the place name into spot_name. PRIORITY: Use this when a specific venue name is present in the question.
- "hungry": They want food, drink, or dining recommendations. Triggers include:
  - Direct: hungry, eat, eating, food, restaurant, cafe, bar, breakfast, lunch, dinner, supper, brunch
  - Cuisine types: japanese, korean, chinese, thai, indian, malay, italian, western, mexican, vietnamese, sushi, ramen, noodles, curry, pizza, burger, seafood, bbq, steak, dessert, pastry, coffee, cocktail
  - Phrases: "place to eat", "place to go" (when food/dining context), "grab some", "birthday dinner", "birthday lunch", "want to try", "looking for a spot", "looking for food", "where to eat", "recommend me", "any good", "chill dinner", "nice place for"
  - ANY message that implies wanting a specific food recommendation, even if wrapped in context like occasions, moods, or companions
- "day_plan": They want help planning their day or activities ("what should I do", "plan my day", "what's good today")
- "nearby": They want to know what's near a specific location ("I'm near", "what's around", "close to")
- "weather": They're asking about weather or it's affecting their plans ("raining", "hot", "weather")
- "contribute": They want to add a spot or share knowledge ("add a spot", "I know a place", "want to contribute")
- "profile": ONLY when the message is purely about trip planning or self-identification with NO food/activity request ("planning a trip", "going to ${cityName} next week", "I live here", "I'm local"). Do NOT classify as profile if there is any food, dining, or activity request in the message.
- "feedback": They're giving feedback about a SPECIFIC SPOT they visited ("it was great", "didn't like it", rating). ONLY use this when they reference a specific place they went to. General frustration with Sam ("this is useless", "you don't know KL", "this doesn't work") is "general", NOT feedback.
- "general": General conversation, greetings, questions about Sam, off-topic

Examples of "spot_correction":
- "hey that place you recommended closed down" → spot_correction
- "Fatty Crab moved from Taman Megah" → spot_correction, spot_name: "Fatty Crab"
- "Village Park shut down" → spot_correction, spot_name: "Village Park"
- "that address for Dewakan is wrong" → spot_correction, spot_name: "Dewakan"

PRIORITY RULES:
1. If a message contains ANY food/dining request — even alongside profile info, occasions, or companions — classify as "hungry". Profile facts are captured automatically in the background.
2. CONTINUATION: If the recent conversation shows the user asked about food/dining and Sam responded with a clarifying question (e.g., "what area?", "where are you?", "where are you based?", "what part of KL?"), then the user's answer is a CONTINUATION of the food request — classify as "hungry". This applies even if the user's reply is just a location name like "PJ" or "Bangsar" or "maybe KL".
3. ALTERNATIVES: If the user is asking for more options or alternatives to what Sam already recommended (e.g. "other choices?", "other options?", "anything else?", "what else?", "what else you got?", "not feeling that", "something different?", "any other spots?", "got more?", "how about something different?", "other recs?", "give me more"), classify as "hungry". Look at the most recent food query in the conversation history and copy its area, cuisine, and meal_type into details — do NOT return empty details if context is available.
4. REFINEMENTS: If the user is adding constraints to a prior food request — timing ("open after 9pm"), occasion ("first date"), vibe ("something light", "not heavy"), dietary, etc. — WITHOUT specifying a new area, classify as "hungry" and carry forward the area from the most recent food query in the conversation history into details.area.
5. Only use "profile" for messages with ZERO actionable food/activity requests AND no recent food conversation context.
5. "nearby" is ONLY for when the user says they are physically AT a location and want to see what's around them (e.g., "I'm near KLCC", "what's around Bukit Bintang"). Do NOT use "nearby" for follow-up answers to food questions.

Examples:
- "is Village Park open for lunch?" → spot_info, spot_name: "Village Park"
- "what's the address for Fatty Crab?" → spot_info, spot_name: "Fatty Crab"
- "does Ilham take cash?" → spot_info, spot_name: "Ilham"
- "tell me more about Nasi Kandar Pelita" → spot_info, spot_name: "Nasi Kandar Pelita"
- "what should I order at Bijan?" → spot_info, spot_name: "Bijan"
- "i need a place to go for my birthday, thinking some place chill, japanese food with my close friend" → hungry (birthday dinner + japanese food)
- "this is useless" → general (frustration with the service, not feedback about a visited spot)
- "you don't actually know KL" → general (challenge/frustration, not spot feedback)
- "i went to one of your spots and it was terrible" → feedback (they visited a specific spot and had a bad experience)
- "grab some ramen tonight" → hungry
- "I'm vegetarian and want dinner in Bangsar" → hungry (dietary info + food request)
- "planning a trip to KL next week" → profile (no food/activity request)
- "PJ/KL" (after Sam asked "what area?" about food) → hungry (continuation)
- "maybe around PJ or KL" (after Sam asked "where are you?" about food) → hungry (continuation — extract area)
- "Bangsar" (after Sam asked "where are you heading?") → hungry (continuation)
- "I like spicy food and street markets" → profile (preferences, no specific request)
- "other choices?" (after nasi lemak recs in PJ) → hungry, area: "PJ", cuisine: "nasi lemak"
- "anything else nearby?" (after dinner recs in Bangsar) → hungry, area: "Bangsar", meal_type: "dinner"
- "what else you got?" (after cafe recs) → hungry, meal_type: "cafe"

Extract relevant details with these exact field names:
- area: neighbourhood(s) or district(s) they want — if multiple, comma-separated (e.g. "Bangsar", "SS2", "SS2, SS23, Bangsar, Taman Megah")
- meal_type: category of food/drink — only use known categories: breakfast, brunch, lunch, dinner, coffee, cafe, dessert, drinks, bar, supper
- cuisine: specific dish or food type they want (e.g. "roti canai", "laksa", "sushi", "nasi lemak") — use this when it's NOT a meal category
- time_of_day: morning, afternoon, evening, late-night
- specific_place: a landmark or venue they're currently AT (not where they want to eat)
- mood: chill, adventurous, tired, celebratory
- budget: cheap, moderate, splurge — extract when the user signals a price constraint (e.g. "cheap", "budget", "affordable", "murah", "under RM30", "splurge", "fancy", "special occasion spend")
- spot_name: name of a specific venue (for spot_info and spot_correction)
- correction: brief description of what's wrong (for spot_correction, e.g. "closed", "moved", "wrong address")

Examples with budget:
- "cheap makan near Chow Kit" → hungry, area: "Chow Kit", budget: "cheap"
- "something affordable for lunch" → hungry, budget: "cheap"
- "want to splurge on dinner" → hungry, budget: "splurge"
- "mid-range dinner spot" → hungry, budget: "moderate"

Respond in JSON only:
{ "intent": "...", "details": { ... } }`;

  const result = await chat(
    systemPrompt,
    [{
      role: "user",
      content: conversationContext
        ? `Recent conversation:\n${conversationContext}\n\nNew message: ${message}`
        : message,
    }],
    { temperature: 0.2, model: HAIKU }
  );

  try {
    const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : result.trim();
    const parsed = JSON.parse(jsonStr);
    // Normalize details: the LLM sometimes returns arrays (e.g. area: ["SS2", "Bangsar"])
    // area arrays join with ", " to preserve multi-area format; other arrays join with " or ".
    if (parsed.details) {
      for (const [key, value] of Object.entries(parsed.details)) {
        if (Array.isArray(value)) {
          parsed.details[key] = key === "area" ? value.join(", ") : value.join(" or ");
        }
      }
    }
    return parsed;
  } catch (error) {
    console.error("classifyIntent JSON parse failed:", error, "raw:", result);
    return { intent: "general", details: {} };
  }
}
