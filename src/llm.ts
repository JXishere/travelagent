// Claude API wrapper — manages system prompt, history, and structured outputs

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";

const client = new Anthropic(); // uses ANTHROPIC_API_KEY env var

export const SONNET = "claude-sonnet-4-5-20250929";
export const HAIKU = "claude-haiku-4-5-20251001";

const PROMPTS_DIR = join(__dirname, "prompts");

function loadPrompt(name: string): string {
  return readFileSync(join(PROMPTS_DIR, `${name}.txt`), "utf-8");
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
    model: options?.model ?? SONNET,
    max_tokens: options?.maxTokens ?? 1024,
    system: systemPrompt,
    messages,
    temperature: options?.temperature ?? 0.7,
  });

  const block = response.content[0];
  if (block.type === "text") return block.text;
  return "";
}

/** Chat with Paul's personality — the main conversation mode */
export async function chatAsP(
  history: ChatMessage[],
  userMessage: string
): Promise<string> {
  const systemPrompt = loadPrompt("system");
  const messages: ChatMessage[] = [
    ...history,
    { role: "user", content: userMessage },
  ];
  return chat(systemPrompt, messages);
}

/** Extract structured JSON from text (for voice note extraction, profile learning, etc.) */
export async function extractJSON<T>(
  promptName: string,
  input: string,
  context?: string,
  options?: { model?: string }
): Promise<T> {
  const systemPrompt = loadPrompt(promptName);
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

/** Classify user intent */
export async function classifyIntent(
  message: string,
  conversationContext?: string
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
  const systemPrompt = `You are an intent classifier for a travel assistant focused on Kuala Lumpur.

Classify the user's message into exactly one intent:
- "hungry": They want food/drink recommendations (mentions eating, hungry, food, restaurant, cafe, bar, breakfast, lunch, dinner)
- "day_plan": They want help planning their day or activities ("what should I do", "plan my day", "what's good today")
- "nearby": They want to know what's near a specific location ("I'm near", "what's around", "close to")
- "weather": They're asking about weather or it's affecting their plans ("raining", "hot", "weather")
- "contribute": They want to add a spot or share knowledge ("add a spot", "I know a place", "want to contribute")
- "profile": They're telling you about their trip or preferences ("planning a trip", "going to KL", "I like...")
- "feedback": They're giving feedback about a spot they visited ("it was great", "didn't like it", rating)
- "general": General conversation, greetings, questions about Paul, off-topic

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

  const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : result.trim();
  return JSON.parse(jsonStr);
}
