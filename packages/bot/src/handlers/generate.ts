// Generate flow — Claude suggests candidate spots, admin verifies and enriches

import { extractJSON } from "../llm.js";
import {
  insertSpot,
  findDuplicateSpot,
  updateConversation,
  getOrCreateTraveler,
  type Conversation,
} from "../database.js";
import { getDefaultCity } from "../utils/city-defaults.js";

interface Candidate {
  name: string;
  categories?: string[];
  area?: string;
  address?: string;
  price_range?: string;
  what_to_order?: string[];
  vibe?: string;
  notes?: string;
}

interface GenerateResult {
  candidates: Candidate[];
}

/** Start candidate generation — parse "/generate bangsar dinner" */
export async function startGenerate(
  phoneNumber: string,
  args: string
): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const area = parts[0] || undefined;
  const category = parts[1] || undefined;

  const context = [
    area && `Neighborhood: ${area}`,
    category && `Category: ${category}`,
  ]
    .filter(Boolean)
    .join("\n");

  const traveler = await getOrCreateTraveler(phoneNumber);
  const city = traveler.current_city ?? getDefaultCity();
  const prompt = context || `Suggest a diverse mix of popular ${city} spots`;

  const result = await extractJSON<GenerateResult>("generate", prompt, undefined, {
    templateVars: { CITY: city },
  });
  const candidates = result.candidates ?? [];

  if (candidates.length === 0) {
    return "Couldn't generate candidates for that query. Try something like `/generate bangsar dinner` or `/generate ttdi cafe`.";
  }

  // Store candidates in flow state, present the first one
  await updateConversation(phoneNumber, {
    current_flow: "generate",
    flow_state: {
      stage: "reviewing",
      candidates,
      currentIndex: 0,
    },
  });

  const first = candidates[0];
  return formatCandidate(first, 1, candidates.length);
}

/** Handle admin responses during candidate review */
export async function handleGenerate(
  phoneNumber: string,
  message: string,
  conversation: Conversation
): Promise<string> {
  const state = conversation.flow_state;

  if (state.stage !== "reviewing") {
    await updateConversation(phoneNumber, {
      current_flow: "general",
      flow_state: {},
    });
    return "Generate session ended. Start a new one with `/generate <area> <category>`.";
  }

  const candidates = state.candidates as Candidate[];
  const idx = state.currentIndex as number;
  const current = candidates[idx];
  const lower = message.toLowerCase().trim();

  // Skip this candidate
  if (lower === "skip" || lower === "next" || lower === "no") {
    return advanceToNext(phoneNumber, candidates, idx);
  }

  // Done reviewing
  if (lower === "done" || lower === "stop") {
    await updateConversation(phoneNumber, {
      current_flow: "general",
      flow_state: {},
    });
    return "Generate session ended. Nice work building the graph.";
  }

  // Admin is enriching this candidate — extract and merge
  const extracted = await extractJSON<Record<string, any>>(
    "extraction",
    message,
    `We're enriching this spot: ${JSON.stringify(current)}\nThe admin is providing additional details or corrections. Extract and merge.`,
    { templateVars: { CITY: getDefaultCity() } }
  );

  const { notes: _n, missing_fields: _m, ...currentClean } = current as any;
  const { missing_fields: _m2, ...extractedClean } = extracted;
  const merged = { ...currentClean, ...extractedClean };

  const duplicate = await findDuplicateSpot(merged.name, merged.area);
  if (duplicate) {
    const skipMsg = `*${merged.name}* already exists — skipping.`;
    const nextMsg = await advanceToNext(phoneNumber, candidates, idx);
    return `${skipMsg}\n\n${nextMsg}`;
  }

  await insertSpot({
    ...merged,
    input_method: "generate",
  } as any);

  const savedMsg = `Saved *${merged.name}* to the graph.`;
  const nextMsg = await advanceToNext(phoneNumber, candidates, idx);

  return `${savedMsg}\n\n${nextMsg}`;
}

export function formatCandidate(
  c: Candidate,
  num: number,
  total: number
): string {
  const lines = [`*Candidate ${num}/${total}: ${c.name}*`];
  if (c.area) lines.push(`Neighborhood: ${c.area}`);
  if (c.categories?.length) lines.push(`Category: ${c.categories.join(", ")}`);
  if (c.address) lines.push(`Address: ${c.address}`);
  if (c.price_range) lines.push(`Price: ${c.price_range}`);
  if (c.what_to_order?.length) lines.push(`Known for: ${c.what_to_order.join(", ")}`);
  if (c.vibe) lines.push(`Vibe: ${c.vibe}`);
  if (c.notes) lines.push(`\n_${c.notes}_`);
  lines.push(`\nIs this legit? Enrich it (just type details), "skip", or "done".`);
  return lines.join("\n");
}

async function advanceToNext(
  phoneNumber: string,
  candidates: Candidate[],
  currentIdx: number
): Promise<string> {
  const nextIdx = currentIdx + 1;

  if (nextIdx >= candidates.length) {
    await updateConversation(phoneNumber, {
      current_flow: "general",
      flow_state: {},
    });
    return "That's all the candidates. Run `/generate` again for more.";
  }

  await updateConversation(phoneNumber, {
    flow_state: {
      stage: "reviewing",
      candidates,
      currentIndex: nextIdx,
    },
  });

  return formatCandidate(candidates[nextIdx], nextIdx + 1, candidates.length);
}
