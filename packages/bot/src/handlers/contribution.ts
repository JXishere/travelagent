// Contribution flow — conversational accumulation of spot knowledge
// Two stages: collecting → confirming

import { extractJSON, classifyConfirmation, classifyIntent, webSearchSpot, samSays } from "../llm.js";
import {
  insertSpot,
  updateSpot,
  findDuplicateSpot,
  getOrCreateContributor,
  incrementContributorCount,
  incrementSpotContributionCount,
  insertSpotContribution,
  updateConversation,
  trackEvent,
  type Conversation,
  type Spot,
} from "../database.js";
import { getDefaultCity } from "../utils/city-defaults.js";
import { geocodeAddress } from "../utils/geocoding.js";
import { handleQuery } from "./query.js";

/** Only these fields may be filled from web search — everything else must come from the contributor.
 *  Deliberately excludes:
 *  - "address" — web often returns addresses for other businesses with the same name (chains, wrong outlets)
 *  - "area" — web returns generic descriptions ("Multiple locations", wrong district) that confuse contributors */
const WEB_ALLOWED_FIELDS = new Set([
  "name", "categories", "city",
  "price_range", "payment_methods",
]);

interface ExtractedSpot {
  name?: string;
  categories?: string[];
  area?: string;
  city?: string;
  country?: string;
  address?: string;
  price_range?: string;
  payment_methods?: string[];
  what_to_order?: string[];
  what_to_skip?: string[];
  pro_tips?: string[];
  vibe?: string;
  best_time_of_day?: string;
  indoor_outdoor?: string;
  weather_dependent?: boolean;
  is_must_go?: boolean;
  missing_fields?: string[];
}

interface ContributionState {
  stage: "collecting" | "confirming" | "asking_must_go";
  extracted: Partial<ExtractedSpot>;
  source: "voice" | "text";
  messagesReceived: number;
  webSourcedFields?: string[];
  areaConflict?: { contributor: string; web: string };
}



export async function handleContribution(
  phoneNumber: string,
  message: string,
  audioId: string | undefined,
  conversation: Conversation,
  options?: { channel?: "whatsapp" | "web" }
): Promise<string> {
  const channel = options?.channel ?? "whatsapp";
  const state = conversation.flow_state as Partial<ContributionState>;

  // First message — initialize collecting stage
  if (!state.stage) {
    const initialState: ContributionState = {
      stage: "collecting",
      extracted: {},
      source: audioId ? "voice" : "text",
      messagesReceived: 0,
    };

    await updateConversation(phoneNumber, {
      current_flow: "contribution",
      flow_state: initialState,
    });

    // Try to extract info from the triggering message
    const input = await resolveInput(phoneNumber, message, audioId);
    if (input && input.trim()) {
      // Pass recent conversation so pronouns ("it", "that place") can be resolved
      const recentContext = conversation.messages.slice(-2)
        .map(m => `${m.role}: ${m.content}`).join("\n");
      return await collectInfo(phoneNumber, input, initialState, recentContext || undefined);
    }

    return samSays("A contributor wants to add a spot to your knowledge graph. Ask them about it warmly. One sentence.");
  }

  // Collecting stage
  if (state.stage === "collecting") {
    const input = await resolveInput(phoneNumber, message, audioId);
    const currentState: ContributionState = {
      stage: "collecting",
      extracted: state.extracted ?? {},
      source: audioId ? "voice" : (state.source ?? "text"),
      messagesReceived: state.messagesReceived ?? 0,
    };
    const recentContext = conversation.messages.slice(-2)
      .map(m => `${m.role}: ${m.content}`).join("\n");
    return await collectInfo(phoneNumber, input, currentState, recentContext || undefined);
  }

  // Confirming stage — classify response with LLM instead of regex
  if (state.stage === "confirming") {
    const input = await resolveInput(phoneNumber, message, audioId);
    const summary = formatSummary(state.extracted ?? {});
    const intent = await classifyConfirmation(input, summary);

    if (intent === "question") {
      // Backwards compat: old conversation states used webEnriched boolean
      const webFields = state.webSourcedFields ?? ((state as any).webEnriched ? ["address", "price_range"] : []);
      const dataSource = webFields.length > 0
        ? `You filled in some operational gaps (${webFields.join(", ").replace(/_/g, " ")}) from the web — their opinions on what to order and tips are theirs.`
        : "All the data came from what they told you — you just organized it.";
      const instruction = `A contributor is reviewing their spot summary and said: "${input}". ${dataSource} The spot data is: ${JSON.stringify(state.extracted)}. Answer their specific question helpfully. If they're asking you to verify something, be honest about your confidence. End by asking if they want to save or tweak. Two sentences max.`;
      return samSays(instruction);
    }

    if (intent === "unrelated") {
      // Check if it's a food query — answer from DB and stay in flow
      const { intent: subIntent, details } = await classifyIntent(input);
      const foodIntents = new Set(["hungry", "day_plan", "nearby"]);

      if (foodIntents.has(subIntent)) {
        const answer = await handleQuery(phoneNumber, input, details, undefined, { channel: options?.channel ?? "whatsapp" });
        return `${answer}\n\nBy the way — still want to save that spot? Or any tweaks?`;
      }

      // Truly unrelated — only save if we have the minimum required fields
      if (!hasMinimumFields(state.extracted ?? {})) {
        const extracted = state.extracted ?? {};
        const missingField = !extracted.name ? "the spot's name" : !extracted.area ? "what area it's in" : "what category it is (breakfast, lunch, dinner, cafe, activity, nightlife, market)";
        return samSays(`A contributor changed the subject before finishing their spot submission. Tell them you haven't saved it yet — still need ${missingField}. Invite them to come back to it whenever they're ready. One sentence.`);
      }
      const webFields = state.webSourcedFields ?? [];
      const saveResponse = await saveSpot(phoneNumber, state.extracted ?? {}, state.source ?? "text", channel, webFields);
      return `${saveResponse}\n\nNow — what's up?`;
    }

    if (intent === "confirm") {
      const webFields = state.webSourcedFields ?? [];
      // Skip must-go question if contributor already signalled it during collection
      if ((state.extracted as any)?.is_must_go !== undefined) {
        return await saveSpot(phoneNumber, state.extracted ?? {}, state.source ?? "text", channel, webFields);
      }
      // Ask the must-go question
      await updateConversation(phoneNumber, {
        flow_state: {
          stage: "asking_must_go",
          extracted: state.extracted,
          source: state.source,
          messagesReceived: state.messagesReceived,
          webSourcedFields: webFields,
          areaConflict: state.areaConflict,
        },
      });
      return samSays(`A contributor just confirmed their spot "${(state.extracted as any)?.name ?? "spot"}". Ask them one final question in Sam's voice: is this a must-go or more of a 'worth it if you're in the area' place? Casual, one sentence.`);
    }

    // "correct" — replace-merge corrections and re-show summary
    const newData = await extractWithContext(input, state.extracted ?? {}, true);
    // Belt-and-suspenders: strip opening_hours from correction extraction
    delete (newData as any).opening_hours;
    const merged = smartMerge(state.extracted ?? {}, newData, true);

    // Corrected fields are now contributor-verified — remove from webSourcedFields
    const correctedKeys = Object.keys(newData);
    const prevWebFields = state.webSourcedFields ?? ((state as any).webEnriched ? [] : []);
    const updatedWebFields = prevWebFields.filter((f: string) => !correctedKeys.includes(f));

    // If contributor corrected the area, clear the conflict flag
    const updatedAreaConflict = correctedKeys.includes("area") ? undefined : state.areaConflict;

    await updateConversation(phoneNumber, {
      flow_state: {
        stage: "confirming",
        extracted: merged,
        source: audioId ? "voice" : (state.source ?? "text"),
        messagesReceived: (state.messagesReceived ?? 0) + 1,
        webSourcedFields: updatedWebFields,
        areaConflict: updatedAreaConflict,
      },
    });

    const correctionAck = correctedKeys.length === 1
      ? `Got it — updated ${correctedKeys[0]}. Here's the revised summary:\n\n`
      : `Got it — updated those details. Here's the revised summary:\n\n`;
    return correctionAck + formatSummary(merged, updatedWebFields, updatedAreaConflict);
  }

  // Asking must-go stage
  if (state.stage === "asking_must_go") {
    const input = await resolveInput(phoneNumber, message, audioId);
    const mustGoContext = `Is "${(state.extracted as any)?.name ?? "this spot"}" a must-go spot?`;
    const intent = await classifyConfirmation(input, mustGoContext);
    const isMustGo = intent === "confirm";
    const webFields = state.webSourcedFields ?? [];
    const enrichedData = { ...(state.extracted ?? {}), is_must_go: isMustGo };
    return await saveSpot(phoneNumber, enrichedData, state.source ?? "text", channel, webFields);
  }

  // Fallback
  await updateConversation(phoneNumber, {
    current_flow: "general",
    flow_state: {},
  });
  return "Something went wrong with the contribution. Want to try again? Just say 'add a spot'.";
}

/** Resolve input text — transcribe voice notes, return text otherwise */
async function resolveInput(
  phoneNumber: string,
  message: string,
  audioId: string | undefined
): Promise<string> {
  if (audioId) {
    // Dynamic imports — only loaded when voice notes are present (keeps
    // this module importable in contexts without WhatsApp deps, e.g. web)
    const { sendMessage } = await import("../whatsapp.js");
    await sendMessage(phoneNumber, "Got your voice note — let me listen...");
    try {
      const { transcribeVoiceNote } = await import("../transcription.js");
      return await transcribeVoiceNote(audioId);
    } catch (error) {
      console.error("Voice note transcription failed:", error, "audioId:", audioId);
      return message || "";
    }
  }
  return message;
}

/** Extract structured data from user input, with context of what we already know */
async function extractWithContext(
  input: string,
  existing: Partial<ExtractedSpot>,
  isCorrection = false,
  conversationContext?: string
): Promise<Partial<ExtractedSpot>> {
  const hasExisting = Object.keys(existing).length > 0;
  let context = hasExisting
    ? isCorrection
      ? `We already know about this spot: ${JSON.stringify(existing)}. The user is CORRECTING or adding to this data. For any field they mention, return the COMPLETE corrected value (not just the new part). For example, if they say "actually it's nasi lemak not nasi campur", return what_to_order: ["nasi lemak"]. Only include fields the user mentioned.`
      : `We already know about this spot: ${JSON.stringify(existing)}. The user is providing more details. Extract ONLY the new information from their message.`
    : undefined;

  // Add conversation context to resolve pronouns ("it", "there", "that place")
  if (conversationContext) {
    const pronContext = `Recent conversation (use this to resolve pronouns like "it", "there", "that place" — the spot being discussed may be named here):\n${conversationContext}`;
    context = context ? `${context}\n\n${pronContext}` : pronContext;
  }

  try {
    return await extractJSON<ExtractedSpot>("extraction", input, context, {
      templateVars: { CITY: getDefaultCity() },
    });
  } catch (error) {
    console.error("Spot extraction failed:", error, "input:", input.slice(0, 200));
    return {};
  }
}

/** Enrich extracted spot data with web search results */
export async function enrichFromWeb(
  data: Partial<ExtractedSpot>
): Promise<{ enriched: Partial<ExtractedSpot>; webSourcedFields: string[]; areaConflict?: { contributor: string; web: string } }> {
  if (!data.name) {
    return { enriched: data, webSourcedFields: [] };
  }

  const city = data.city || getDefaultCity();
  const webData = await webSearchSpot(data.name, city, data.categories?.[0]);

  // Belt-and-suspenders: never let opening_hours through from web
  delete (webData as any).opening_hours;

  // Allowlist: only keep fields we trust from web search
  for (const key of Object.keys(webData)) {
    if (!WEB_ALLOWED_FIELDS.has(key)) {
      delete webData[key];
    }
  }

  if (Object.keys(webData).length === 0) {
    return { enriched: data, webSourcedFields: [] };
  }

  // Detect area conflict — contributor gave an area but web disagrees
  let areaConflict: { contributor: string; web: string } | undefined;
  if (
    data.area && webData.area &&
    data.area.toLowerCase().trim() !== webData.area.toLowerCase().trim()
  ) {
    areaConflict = { contributor: data.area, web: webData.area };
  }

  // Track which fields are genuinely new from web (not already in contributor data)
  const webSourcedFields: string[] = [];
  for (const key of Object.keys(webData)) {
    if ((data as any)[key] == null || (data as any)[key] === "") {
      webSourcedFields.push(key);
    }
  }

  // Contributor data wins — pass it as "incoming" so it overwrites web data
  const merged = smartMerge(webData, data);
  return { enriched: merged, webSourcedFields, areaConflict };
}

/** Process a message during the collecting stage */
async function collectInfo(
  phoneNumber: string,
  input: string,
  state: ContributionState,
  conversationContext?: string
): Promise<string> {
  const previous = state.extracted;
  const newData = await extractWithContext(input, previous, false, conversationContext);
  // Belt-and-suspenders: strip opening_hours from extraction
  delete (newData as any).opening_hours;

  // If extraction returned nothing meaningful, the user probably asked a question
  const meaningfulKeys = Object.keys(newData).filter(k => k !== "missing_fields");
  if (meaningfulKeys.length === 0) {
    // Check if it's a food query we can answer from the DB
    const { intent, details } = await classifyIntent(input);
    const foodIntents = new Set(["hungry", "day_plan", "nearby"]);

    if (foodIntents.has(intent)) {
      // Answer with real DB data, then nudge back
      const answer = await handleQuery(phoneNumber, input, details, undefined, { channel: "web" });
      const nudge = Object.keys(previous).length > 0
        ? `\n\nNow — back to that spot you were telling me about. What else should I know?`
        : `\n\nNow — you mentioned you know a spot? Tell me about it.`;
      return answer + nudge;
    }

    // If we already have spot data, the message probably has context that didn't
    // extract cleanly — don't ask for fields we already have.
    if (Object.keys(previous).length > 0) {
      return generateFollowUp(previous, {});
    }

    // Nothing extracted, no prior context — general prompt
    return samSays("A contributor wants to add a spot to your knowledge graph. Ask them warmly what spot they have in mind. One sentence.");
  }

  let merged = smartMerge(previous, newData);
  const messagesReceived = state.messagesReceived + 1;

  // When the spot name changed (or was first provided), enrich from web
  const nameChanged = merged.name && merged.name !== previous.name;
  let webSourcedFields = state.webSourcedFields ?? [];
  let areaConflict = state.areaConflict;
  if (nameChanged) {
    // Early duplicate check — exit before collecting more details if already in DB
    const earlyDuplicate = await findDuplicateSpot(merged.name!, merged.area);
    if (earlyDuplicate) {
      await updateConversation(phoneNumber, { current_flow: "general", flow_state: {} });
      return samSays(`A contributor mentioned "${earlyDuplicate.name}" in ${earlyDuplicate.area ?? "your city"}, which is already in your knowledge graph. Tell them warmly you already have it — invite them to add new intel or ask what you know about it. One sentence.`);
    }

    if (previous.name) {
      // Name changed mid-flow — reset to just current extraction to avoid stale data
      merged = { ...newData };
    }
    webSourcedFields = [];
    areaConflict = undefined;
    const result = await enrichFromWeb(merged);
    merged = result.enriched;
    webSourcedFields = result.webSourcedFields;
    areaConflict = result.areaConflict;
  }

  // Check if we have enough to show a summary
  if (isReady(merged)) {
    await updateConversation(phoneNumber, {
      flow_state: {
        stage: "confirming",
        extracted: merged,
        source: state.source,
        messagesReceived,
        webSourcedFields,
        areaConflict,
      },
    });
    const summary = formatSummary(merged, webSourcedFields, areaConflict);
    if (webSourcedFields.length > 0 || areaConflict) {
      const parts: string[] = [];
      if (webSourcedFields.length > 0) {
        const fieldNames = webSourcedFields.join(", ").replace(/_/g, " ");
        parts.push(`filled in some operational details (${fieldNames}) from the web`);
      }
      if (areaConflict) {
        parts.push(`noticed the area might be "${areaConflict.web}" — not "${areaConflict.contributor}" as they said`);
      }
      const intro = await samSays(`You looked up a spot online and ${parts.join(" and ")} for a contributor. Write a one-sentence intro flagging what needs double-checking.`);
      return `${intro}\n\n${summary}`;
    }
    return summary;
  }

  // Not ready — save progress and ask a follow-up
  await updateConversation(phoneNumber, {
    flow_state: {
      stage: "collecting",
      extracted: merged,
      source: state.source,
      messagesReceived,
      webSourcedFields,
      areaConflict,
    },
  });

  return generateFollowUp(merged, previous);
}

/** Merge new extracted data into existing, preserving non-empty values */
export function smartMerge(
  existing: Partial<ExtractedSpot>,
  incoming: Partial<ExtractedSpot>,
  replaceArrays = false
): Partial<ExtractedSpot> {
  const merged = { ...existing };

  for (const [key, value] of Object.entries(incoming)) {
    if (key === "missing_fields") continue;
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) continue;

    // categories always replaces — contributor's explicit choice wins (don't accumulate)
    if (key === "categories") {
      (merged as any)[key] = value;
      continue;
    }
    // For corrections, replace arrays outright (LLM returns the complete corrected value)
    // For collecting, merge unique items to accumulate across messages
    if (Array.isArray(value) && Array.isArray((merged as any)[key]) && !replaceArrays) {
      const existingArr = (merged as any)[key] as string[];
      const newItems = value.filter((v: string) => !existingArr.includes(v));
      (merged as any)[key] = [...existingArr, ...newItems];
    } else {
      (merged as any)[key] = value;
    }
  }

  return merged;
}

/** Check if extracted data has the minimum required fields to insert into DB */
function hasMinimumFields(data: Partial<ExtractedSpot>): boolean {
  return Boolean(data.name && data.categories?.length && data.area);
}

/** Check if we have enough data to show a confirmation summary */
export function isReady(data: Partial<ExtractedSpot>): boolean {
  const hasCritical = Boolean(data.name && data.categories?.length && data.area);
  const hasContributorOpinion = Boolean(
    (data.what_to_order && data.what_to_order.length > 0) ||
    (data.pro_tips && data.pro_tips.length > 0) ||
    data.vibe
  );
  return hasCritical && hasContributorOpinion;
}

/** Generate a Sam-voiced follow-up question based on what's known and what's missing */
async function generateFollowUp(merged: Partial<ExtractedSpot>, previous: Partial<ExtractedSpot>): Promise<string> {
  const meaningfulKeys = Object.keys(merged).filter((k) => k !== "missing_fields");
  if (meaningfulKeys.length === 0) {
    return samSays("A contributor wants to add a spot to your knowledge graph. Ask them about it warmly. One sentence.");
  }

  const missing = !merged.name
    ? "the name of the spot"
    : !merged.area
    ? "what area/area it's in"
    : !merged.categories?.length
    ? "what kind of spot it is (breakfast, lunch, dinner, cafe, activity, nightlife, market)"
    : !merged.what_to_order?.length
    ? "what people should order there"
    : "any tips like payment, hours, or insider tricks";

  const newName = merged.name && merged.name !== previous.name;
  const newNeighborhood = merged.area && merged.area !== previous.area;
  let ack = "";
  if (newName) ack += `You just learned the spot is called "${merged.name}". `;
  if (newNeighborhood) ack += `You just learned it's in ${merged.area}. `;

  const instruction = `${ack}A contributor is adding a spot to your knowledge graph. You know so far: ${JSON.stringify(merged)}. Acknowledge what's new briefly and ask for ${missing}. One sentence, keep it natural.`;
  return samSays(instruction);
}

/** Format a summary of the accumulated spot data */
export function formatSummary(data: Partial<ExtractedSpot>, webSourcedFields: string[] = [], areaConflict?: { contributor: string; web: string }): string {
  const webSet = new Set(webSourcedFields);
  const tag = (field: string, value: string) =>
    webSet.has(field) ? `${value} _(from web)_` : value;

  const lines: string[] = ["Here's what I've got:", ""];

  const areaDisplay = areaConflict
    ? `${data.area} ⚠️ _(web says: ${areaConflict.web} — which is right?)_`
    : data.area;
  const cityCountry = [data.city || getDefaultCity(), data.country].filter(Boolean).join(", ");
  lines.push(`*${data.name}* — ${areaDisplay}, ${cityCountry}`);

  if (data.address) {
    lines.push(`📍 ${tag("address", data.address)}`);
  }

  const meta: string[] = [];
  if (data.categories?.length) meta.push(data.categories.map(capitalize).join(" · "));
  if (data.price_range) meta.push(tag("price_range", data.price_range));
  if (data.payment_methods?.length) meta.push(tag("payment_methods", data.payment_methods.join(", ")));
  if (meta.length) lines.push(meta.join(" | "));

  if (data.what_to_order?.length) {
    lines.push(`🍽 Order: ${data.what_to_order.join(", ")}`);
  }

  if (data.pro_tips?.length) {
    lines.push(`💡 ${data.pro_tips.join(". ")}`);
  }

  if (data.vibe) {
    lines.push(`✨ Vibe: ${data.vibe}`);
  }

  lines.push("");
  if (webSet.size > 0) {
    lines.push("Fields marked _(from web)_ are unverified — double-check before saving.");
  }
  lines.push(`Looks solid — I'll add this unless you want to tweak anything.`);

  return lines.join("\n");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Describe what's new in the contributed data vs the existing spot */
export function describeNewInfo(existing: Spot, incoming: Partial<ExtractedSpot>): string[] {
  const lines: string[] = [];
  const arrayFields = ["what_to_order", "what_to_skip", "pro_tips", "payment_methods"] as const;

  for (const field of arrayFields) {
    const existingArr = (existing as any)[field] ?? [];
    const incomingArr = (incoming as any)[field] ?? [];
    const newItems = incomingArr.filter((item: string) =>
      !existingArr.some((e: string) => e.toLowerCase() === item.toLowerCase())
    );
    if (newItems.length > 0) {
      const label = field.replace(/_/g, " ");
      lines.push(`• New ${label}: ${newItems.join(", ")}`);
    }
  }

  if (incoming.vibe && incoming.vibe !== existing.vibe) {
    lines.push(`• Vibe: ${incoming.vibe} (was: ${existing.vibe ?? "unset"})`);
  }
  if (incoming.price_range && incoming.price_range !== existing.price_range) {
    lines.push(`• Price: ${incoming.price_range} (was: ${existing.price_range ?? "unset"})`);
  }

  return lines;
}

/** Build a partial Spot update from contributed data — appends to arrays, overwrites scalars */
export function smartMergeForUpdate(incoming: Partial<ExtractedSpot>): Partial<Spot> {
  const updates: Partial<Spot> = {};
  const { missing_fields, ...data } = incoming as any;

  // Scalar fields — overwrite if present
  const scalarFields = ["vibe", "price_range", "address", "best_time_of_day", "indoor_outdoor", "weather_dependent"] as const;
  for (const field of scalarFields) {
    if (data[field] != null) {
      (updates as any)[field] = data[field];
    }
  }

  return updates;
}

async function saveSpot(
  phoneNumber: string,
  data: Partial<ExtractedSpot>,
  source: "voice" | "text",
  channel: "whatsapp" | "web" = "whatsapp",
  webSourcedFields: string[] = []
): Promise<string> {
  // Last-line-of-defense validation — never insert a spot missing critical fields
  if (!data.name || !data.categories?.length || !data.area) {
    const missing = [!data.name && "name", !data.area && "area", !data.categories?.length && "categories"]
      .filter(Boolean).join(", ");
    console.error("[saveSpot] Blocked: missing required fields", { name: data.name, categories: data.categories, area: data.area });
    await updateConversation(phoneNumber, {
      current_flow: "contribution",
      flow_state: { stage: "collecting", extracted: data, source, messagesReceived: 0 },
    });
    return samSays(`You're trying to save a spot to the knowledge graph but it's missing: ${missing}. Ask the contributor to provide what's missing before you can add it. One sentence.`);
  }

  const contributor = await getOrCreateContributor(phoneNumber);

  const { missing_fields, is_must_go: isMustGo, ...spotData } = data as any;

  // Strip web-sourced fields — only contributor-verified data goes to DB
  for (const field of webSourcedFields) {
    delete spotData[field];
  }
  // Belt-and-suspenders: never persist opening_hours or is_must_go (mapped to must_go)
  delete spotData.opening_hours;
  delete spotData.is_must_go;

  // Check for duplicate — auto-merge new intel, tell contributor the spot already exists
  const duplicate = await findDuplicateSpot(spotData.name, spotData.area);
  if (duplicate) {
    const newInfo = describeNewInfo(duplicate, data);

    await updateConversation(phoneNumber, { current_flow: "general", flow_state: {} });

    if (newInfo.length === 0) {
      return samSays(`A contributor tried to add "${duplicate.name}" in ${duplicate.area}, but it's already in your knowledge graph with the same info. Respond warmly — ${duplicate.name} is already in your knowledge graph and well-covered. One sentence.`);
    }

    // Auto-merge: append their new info to the existing spot
    const updates = smartMergeForUpdate(spotData);
    const arrayFields = ["what_to_order", "what_to_skip", "pro_tips", "payment_methods"] as const;
    for (const field of arrayFields) {
      const incomingArr: string[] = spotData[field] ?? [];
      if (incomingArr.length > 0) {
        const existingArr: string[] = (duplicate as any)[field] ?? [];
        const existingLower = new Set(existingArr.map((s: string) => s.toLowerCase()));
        (updates as any)[field] = [...existingArr, ...incomingArr.filter(s => !existingLower.has(s.toLowerCase()))];
      }
    }
    // Propagate must-go flag to existing spot
    if (isMustGo) {
      (updates as any).must_go = true;
    }
    await updateSpot(duplicate.id, updates);

    // Record contributor attribution
    insertSpotContribution({
      spot_id: duplicate.id,
      contributor_id: contributor.id,
      what_to_order: spotData.what_to_order?.length ? spotData.what_to_order : undefined,
      what_to_skip: spotData.what_to_skip?.length ? spotData.what_to_skip : undefined,
      pro_tips: spotData.pro_tips?.length ? spotData.pro_tips : undefined,
      vibe: spotData.vibe,
      is_must_go: isMustGo,
    }).catch(err => console.error("[attribution] Failed to save contribution:", err));
    incrementSpotContributionCount(duplicate.id).catch(err => console.error("[contribution_count] Failed to increment:", err));

    await incrementContributorCount(phoneNumber, data.city || getDefaultCity());

    trackEvent(phoneNumber, channel, "flow_complete", {
      flow: "contribution",
      spot_name: duplicate.name,
      action: "updated_existing",
      source,
    });

    return samSays(`A contributor added intel to "${duplicate.name}" which already exists in your knowledge graph. Their new info:\n${newInfo.join("\n")}\nRespond warmly — ${duplicate.name} already exists in your graph, but their new perspective makes it richer and you've merged it in. One sentence.`);
  }

  // Geocode address → lat/lng so proximity filtering works for this area in future queries.
  // Uses the address from the full data object (may be web-sourced) — coordinates are
  // factual metadata, not contributor opinion, so deriving them from a web address is fine.
  // Fire-and-forget friendly: if geocoding fails, spot saves without coordinates.
  if (!spotData.latitude && !spotData.longitude && data.address) {
    const coords = await geocodeAddress(data.address, data.city || getDefaultCity());
    if (coords) {
      spotData.latitude = coords.lat;
      spotData.longitude = coords.lng;
    }
  }

  const newSpot = await insertSpot({
    ...spotData,
    contributor_id: contributor.id,
    source,
    verified: true,
    must_go: isMustGo ?? false,
  });

  // Record this contributor's specific notes for attribution
  insertSpotContribution({
    spot_id: newSpot.id,
    contributor_id: contributor.id,
    what_to_order: spotData.what_to_order,
    what_to_skip: spotData.what_to_skip,
    pro_tips: spotData.pro_tips,
    vibe: spotData.vibe,
    is_must_go: isMustGo,
  }).catch(err => console.error("[attribution] Failed to save contribution:", err));
  incrementSpotContributionCount(newSpot.id).catch(err => console.error("[contribution_count] Failed to increment:", err));

  await incrementContributorCount(phoneNumber, data.city || getDefaultCity());
  const updated = await getOrCreateContributor(phoneNumber);

  await updateConversation(phoneNumber, {
    current_flow: "general",
    flow_state: {},
  });

  trackEvent(phoneNumber, channel, "flow_complete", {
    flow: "contribution",
    spot_name: data.name,
    source,
  });

  return samSays(`Respond to confirm you just saved "${data.name}" to your knowledge graph. The contributor has now added ${updated.spots_contributed} spot(s) total. Confirm it's saved, thank them warmly, mention the spot name. One sentence.`);
}
