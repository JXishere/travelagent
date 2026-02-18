// Claude API wrapper — manages system prompt, history, and structured outputs

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";
import { getDefaultCity } from "./utils/city-defaults.js";

const client = new Anthropic(); // uses ANTHROPIC_API_KEY env var

export const SONNET = "claude-sonnet-4-5-20250929";
export const HAIKU = "claude-haiku-4-5-20251001";

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
  const response = await client.messages.create({
    model: options?.model ?? HAIKU,
    max_tokens: options?.maxTokens ?? 1024,
    system: systemPrompt,
    messages,
    temperature: options?.temperature ?? 0.7,
  });

  const block = response.content[0];
  if (block.type === "text") return block.text;
  return "";
}

/** Chat with Sam's personality — the main conversation mode */
export async function chatAsSam(
  history: ChatMessage[],
  userMessage: string,
  options?: { city?: string }
): Promise<string> {
  const city = options?.city ?? getDefaultCity();
  const systemPrompt = loadPrompt("system").replaceAll("{{CITY}}", city);
  const messages: ChatMessage[] = [
    ...history,
    { role: "user", content: userMessage },
  ];
  return chat(systemPrompt, messages);
}

/** Streaming chat — returns an Anthropic MessageStream for token-by-token output */
export function chatStream(
  systemPrompt: string,
  messages: ChatMessage[],
  options?: { maxTokens?: number; temperature?: number; model?: string }
) {
  return client.messages.stream({
    model: options?.model ?? HAIKU,
    max_tokens: options?.maxTokens ?? 1024,
    system: systemPrompt,
    messages,
    temperature: options?.temperature ?? 0.7,
  });
}

/** Streaming chat with Sam's personality */
export function chatAsSamStream(
  history: ChatMessage[],
  userMessage: string,
  options?: { city?: string }
) {
  const city = options?.city ?? getDefaultCity();
  const systemPrompt = loadPrompt("system").replaceAll("{{CITY}}", city);
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
): Promise<"confirm" | "correct" | "unrelated"> {
  const systemPrompt = `You classify a user's response after being shown a spot summary they contributed to a travel knowledge graph.

Classify into exactly one category:
- "confirm": Happy with the summary (e.g. "yes", "looks good", "perfect", "👍", "save it", "nice", "done")
- "correct": Wants to fix or add info about THIS spot (e.g. "actually it's in Bangsar", "they also have great roti canai", "change the vibe")
- "unrelated": Talking about something else entirely (e.g. "I'm hungry", "what should I do today", "hey", "where should I eat")

If the message has BOTH confirmation AND new spot info ("yeah also they close on Mondays"), classify as "correct".

Respond with ONLY one word: confirm, correct, or unrelated`;

  const result = await chat(
    systemPrompt,
    [{ role: "user", content: `Spot summary shown:\n${spotSummary}\n\nUser's response: ${message}` }],
    { temperature: 0.1, model: HAIKU, maxTokens: 10 }
  );

  const cleaned = result.trim().toLowerCase();
  if (cleaned === "confirm" || cleaned === "correct" || cleaned === "unrelated") {
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
  "category": "breakfast|lunch|dinner|cafe|activity|nightlife|market",
  "neighborhood": "area/district name",
  "address": "street address",
  "price_range": "$|$$|$$$",
  "payment_methods": ["cash", "card", etc],
  "what_to_order": ["popular dishes/items"],
  "pro_tips": ["useful tips for visitors"],
  "vibe": "casual|upscale|chaotic|chill|local|touristy",
  "opening_hours": {"monday": "9am-5pm", ...}
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

    // Get the LAST text block — earlier ones are just search narration
    const textBlocks = response.content.filter((b) => b.type === "text");
    const textBlock = textBlocks[textBlocks.length - 1];
    if (!textBlock || textBlock.type !== "text") return {};
    // Try markdown code block first, then bare JSON object anywhere in text
    const fenceMatch = textBlock.text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const bareMatch = textBlock.text.match(/\{[\s\S]*\}/);
    const jsonStr = fenceMatch ? fenceMatch[1].trim() : bareMatch ? bareMatch[0] : textBlock.text.trim();
    return JSON.parse(jsonStr);
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
    | "general";
  details: Record<string, string>;
}> {
  const cityName = city ?? "Kuala Lumpur";
  const systemPrompt = `You are an intent classifier for a travel assistant focused on ${cityName}.

Classify the user's message into exactly one intent:
- "hungry": They want food/drink recommendations (mentions eating, hungry, food, restaurant, cafe, bar, breakfast, lunch, dinner)
- "day_plan": They want help planning their day or activities ("what should I do", "plan my day", "what's good today")
- "nearby": They want to know what's near a specific location ("I'm near", "what's around", "close to")
- "weather": They're asking about weather or it's affecting their plans ("raining", "hot", "weather")
- "contribute": They want to add a spot or share knowledge ("add a spot", "I know a place", "want to contribute")
- "profile": They're telling you about their trip or preferences, or identifying themselves ("planning a trip", "going to ${cityName}", "I like...", "I live here", "I'm local", "just moved to ${cityName}", "I'm from ${cityName}")
- "feedback": They're giving feedback about a spot they visited ("it was great", "didn't like it", rating)
- "general": General conversation, greetings, questions about Sam, off-topic

PRIORITY: If a message contains both profile information ("I live here", "I'm vegetarian", trip dates) AND an action request (food recommendation, day plan, what's nearby), classify by the ACTION — not "profile". Profile facts are captured automatically in the background.

Also extract any relevant details: neighborhood, meal_type, time_of_day, mood/energy, specific_place.

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
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("classifyIntent JSON parse failed:", error, "raw:", result);
    return { intent: "general", details: {} };
  }
}
