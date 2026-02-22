// Sam — WhatsApp travel intelligence service for Kuala Lumpur
// Main entry point: Express app + webhook routes + flow routing

import express from "express";
import { parseWebhook, sendMessage, showTyping } from "./whatsapp.js";
import { chatAsSam, classifyIntent, extractJSON, startUsageTracking, flushUsage, samSays } from "./llm.js";
import {
  getOrCreateConversation,
  updateConversation,
  appendMessages,
  insertSpot,
  findDuplicateSpot,
  touchLastUserMessage,
  trackEvent,
  getOrCreateTraveler,
  getSpotsByIds,
  getPendingCorrections,
  adminApproveCorrection,
  adminRejectCorrection,
  findSpotByName,
  updateSpot,
} from "./database.js";
import { getDefaultCity, isSupportedCity, getSupportedCities } from "./utils/city-defaults.js";
import { handleContribution } from "./handlers/contribution.js";
import { handleQuery } from "./handlers/query.js";
import { handleProfile, startProfileLearning } from "./handlers/profile.js";
import { handleStrategic } from "./handlers/strategic.js";
import { handleHungry, handleDayPlan, handleNearby, handleSpotInfo, isUnclearQuery, UNCLEAR_CLARIFYING_QUESTION } from "./handlers/ontrip.js";
import { handleFeedback, startFeedbackCollection } from "./handlers/feedback.js";
import { handleSpotCorrection } from "./handlers/spot-correction.js";
import { startGenerate, handleGenerate } from "./handlers/generate.js";
import { maybeExtractProfile } from "./handlers/continuous-profile.js";
import { handleSpotVerification } from "./handlers/spot-verification.js";
import { startScheduler } from "./scheduler.js";

const app = express();
app.use(express.json());

const PORT = process.env.PORT ?? 3000;

// ============================================
// WEBHOOK VERIFICATION (GET /webhook)
// Meta verifies your webhook is real by sending a challenge
// ============================================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log("Webhook verified");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ============================================
// MESSAGE HANDLER (POST /webhook)
// Receives all WhatsApp messages and routes to the right flow
// ============================================
app.post("/webhook", async (req, res) => {
  console.log("Webhook POST received:", JSON.stringify(req.body, null, 2));
  // Always respond 200 quickly — WhatsApp retries on timeout
  res.sendStatus(200);

  const message = parseWebhook(req.body);
  if (!message) {
    console.log("parseWebhook returned null — not a user message");
    return;
  }
  console.log("Parsed message:", JSON.stringify(message, null, 2));

  try {
    // Show typing indicator immediately so user knows Sam is thinking
    showTyping(message.messageId).catch(() => {});
    await processMessage(message);
  } catch (error) {
    console.error("Error processing message:", error);
    try {
      await sendMessage(
        message.from,
        "Sorry, something went wrong on my end. Try again in a moment?"
      );
    } catch {
      // Can't even send error message — log and move on
    }
  }
});

// ============================================
// CORE MESSAGE PROCESSING
// ============================================
async function processMessage(message: ReturnType<typeof parseWebhook>) {
  if (!message) return;

  const { from, audioId, location } = message;
  let { type, text } = message;
  const conversation = await getOrCreateConversation(from);
  touchLastUserMessage(from).catch(() => {});
  const currentFlow = conversation.current_flow;

  startUsageTracking(from);
  let usageIntent: string = currentFlow;

  try {
  // Location pin → route to nearby handler
  if (type === "location" && location) {
    usageIntent = "nearby";
    const response = await handleNearby(from, `I'm at ${location.latitude}, ${location.longitude}`, {
      area: undefined,
      specific_place: `${location.latitude},${location.longitude}`,
    }, undefined, { channel: "whatsapp" });
    await appendMessages(from, [
      { role: "user", content: `[shared location: ${location.latitude}, ${location.longitude}]` },
      { role: "assistant", content: response },
    ]);
    await sendMessage(from, response);
    return;
  }

  // If we're mid-flow, continue that flow
  if (currentFlow !== "general") {
    const response = await routeToCurrentFlow(
      from,
      text ?? "",
      audioId,
      conversation
    );
    await appendMessages(from, [
      { role: "user", content: text ?? "[voice note]" },
      { role: "assistant", content: response },
    ]);
    await sendMessage(from, response);
    maybeExtractProfile(from, [
      { role: "user", content: text ?? "[voice note]" },
      { role: "assistant", content: response },
    ], currentFlow).catch(() => {});
    return;
  }

  // Voice note outside of contribution flow — treat as contribution or transcribe
  if (type === "audio" && audioId) {
    const response = await handleContribution(from, "", audioId, {
      ...conversation,
      flow_state: {},
    });
    await sendMessage(from, response);
    return;
  }

  // Image message — process caption as text if present, otherwise acknowledge
  if (type === "image") {
    if (message.imageCaption) {
      text = message.imageCaption;
      type = "text";
    } else {
      await sendMessage(from, "Nice pic! I can't process images yet though — send me a text or voice note and I'll help you out.");
      return;
    }
  }

  if (!text) return;

  const ADMIN_PHONE = process.env.ADMIN_PHONE_NUMBER;

  // Admin rapid-add: "add: Fatty Crab, Taman Megah, dinner, tier 1. ..."
  if (ADMIN_PHONE && from === ADMIN_PHONE && text.toLowerCase().startsWith("add:")) {
    const spotText = text.slice(4).trim();
    const extracted = await extractJSON<Record<string, any>>("extraction", spotText, undefined, {
      templateVars: { CITY: getDefaultCity() },
    });

    const criticalMissing = (extracted.missing_fields ?? []).filter((f: string) =>
      ["name", "categories", "area"].includes(f)
    );

    if (criticalMissing.length > 0) {
      // Ask one clarifying question, then save on next message
      await updateConversation(from, {
        current_flow: "contribution",
        flow_state: { stage: "clarifying", extracted, missing: criticalMissing },
      });
      const question = criticalMissing
        .map((f: string) => {
          if (f === "name") return "Name?";
          if (f === "categories") return "Category? (breakfast/lunch/dinner/cafe/activity/nightlife/market)";
          if (f === "area") return "Area?";
          return f + "?";
        })
        .join(" ");
      const response = `Almost — missing: ${question}`;
      await appendMessages(from, [
        { role: "user", content: text },
        { role: "assistant", content: response },
      ]);
      await sendMessage(from, response);
      return;
    }

    const { missing_fields, ...spotData } = extracted;

    // Check for duplicate
    const duplicate = await findDuplicateSpot(spotData.name, spotData.area);
    if (duplicate) {
      const response = `*${duplicate.name}* (${duplicate.area}) already exists in the graph.`;
      await appendMessages(from, [
        { role: "user", content: text },
        { role: "assistant", content: response },
      ]);
      await sendMessage(from, response);
      return;
    }

    await insertSpot({ ...spotData, input_method: "text" });
    const response = `Added *${extracted.name}* (${extracted.area}, ${(extracted.categories ?? []).join("/")}) to the graph.`;
    await appendMessages(from, [
      { role: "user", content: text },
      { role: "assistant", content: response },
    ]);
    await sendMessage(from, response);
    return;
  }

  // Admin correction commands: /approve, /reject, /corrections
  if (ADMIN_PHONE && from === ADMIN_PHONE && text.startsWith("/approve ")) {
    const spotName = text.slice("/approve ".length).trim();
    const spot = await findSpotByName(spotName);
    if (!spot) {
      await sendMessage(from, `Couldn't find a spot matching "${spotName}".`);
      return;
    }
    await adminApproveCorrection(spot.id);
    const response = `${spot.name} marked as closed and hidden from recommendations.`;
    await appendMessages(from, [{ role: "user", content: text }, { role: "assistant", content: response }]);
    await sendMessage(from, response);
    return;
  }

  if (ADMIN_PHONE && from === ADMIN_PHONE && text.startsWith("/reject ")) {
    const spotName = text.slice("/reject ".length).trim();
    const spot = await findSpotByName(spotName);
    if (!spot) {
      await sendMessage(from, `Couldn't find a spot matching "${spotName}".`);
      return;
    }
    await adminRejectCorrection(spot.id);
    const response = `Correction dismissed. ${spot.name} restored to verified.`;
    await appendMessages(from, [{ role: "user", content: text }, { role: "assistant", content: response }]);
    await sendMessage(from, response);
    return;
  }

  if (ADMIN_PHONE && from === ADMIN_PHONE && text.trim() === "/corrections") {
    const pending = await getPendingCorrections();
    let response: string;
    if (pending.length === 0) {
      response = "No pending corrections.";
    } else {
      // Group by spot to show one entry per spot with a report count
      const bySpot = new Map<string, { name: string; area: string | null; types: Set<string>; count: number }>();
      for (const c of pending) {
        const entry = bySpot.get(c.spot_id) ?? { name: c.spot_name, area: c.spot_area, types: new Set(), count: 0 };
        entry.types.add(c.correction_type);
        entry.count++;
        bySpot.set(c.spot_id, entry);
      }
      const lines = [...bySpot.values()].map((s, i) => {
        const loc = s.area ? ` (${s.area})` : "";
        const types = [...s.types].join(", ");
        return `${i + 1}. ${s.name}${loc} — ${types} — ${s.count} report${s.count !== 1 ? "s" : ""}`;
      });
      response = `Pending corrections (${bySpot.size}):\n${lines.join("\n")}`;
    }
    await appendMessages(from, [{ role: "user", content: text }, { role: "assistant", content: response }]);
    await sendMessage(from, response);
    return;
  }

  // Admin /publish command: "/publish <spot name>" — approve spot from review queue
  if (ADMIN_PHONE && from === ADMIN_PHONE && text.startsWith("/publish ")) {
    const spotName = text.slice("/publish ".length).trim();
    const spot = await findSpotByName(spotName);
    if (!spot) {
      await sendMessage(from, `Couldn't find a spot matching "${spotName}".`);
      return;
    }
    await updateSpot(spot.id, { needs_review: false });
    const response = `${spot.name} published — now live in recommendations.`;
    await appendMessages(from, [{ role: "user", content: text }, { role: "assistant", content: response }]);
    await sendMessage(from, response);
    return;
  }

  // Admin /generate command: "/generate bangsar dinner"
  if (ADMIN_PHONE && from === ADMIN_PHONE && text.startsWith("/generate")) {
    const args = text.slice("/generate".length).trim();
    const response = await startGenerate(from, args);
    await appendMessages(from, [
      { role: "user", content: text },
      { role: "assistant", content: response },
    ]);
    await sendMessage(from, response);
    return;
  }

  // Classify intent
  const recentContext = conversation.messages
    .slice(-6)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const { intent, details } = await classifyIntent(text, recentContext);
  usageIntent = intent;

  trackEvent(from, "whatsapp", "message", { intent });

  let response: string;

  switch (intent) {
    case "hungry": {
      const alreadyAsked = conversation.flow_state?.asked_clarifying;
      if (!alreadyAsked && isUnclearQuery(details, recentContext, text)) {
        await updateConversation(from, {
          current_flow: "query_clarifying",
          flow_state: { pending_query: text, pending_details: details, asked_clarifying: true },
        });
        response = UNCLEAR_CLARIFYING_QUESTION;
      } else {
        response = await handleHungry(from, text, details, recentContext, { channel: "whatsapp" });
      }
      break;
    }

    case "day_plan":
      response = await handleDayPlan(from, text, details, recentContext, { channel: "whatsapp" });
      break;

    case "nearby":
      response = await handleNearby(from, text, details, recentContext, { channel: "whatsapp" });
      break;

    case "contribute":
      response = await handleContribution(from, text, audioId, conversation);
      break;

    case "profile":
      response = await startProfileLearning(from, text);
      break;

    case "feedback":
      response = await startFeedbackCollection(from);
      break;

    case "spot_correction":
      response = await handleSpotCorrection(from, text, details, { channel: "whatsapp", conversation });
      break;

    case "weather": {
      const { getCurrentWeather } = await import("./weather.js");
      // Phase 1a: use traveler's city, not the global default
      const travelerForWeather = await getOrCreateTraveler(from);
      const cityName = travelerForWeather.current_city ?? getDefaultCity();

      // Unsupported city: don't silently fall back to KL weather — be honest
      if (travelerForWeather.current_city && !isSupportedCity(travelerForWeather.current_city)) {
        const supported = getSupportedCities().join(", ");
        response = await samSays(
          `Respond honestly and warmly: you don't have coverage in ${travelerForWeather.current_city} yet, but you're great for ${supported}. One to two sentences. Do not give weather data for the wrong city.`,
          getDefaultCity()
        );
        break;
      }

      const weather = await getCurrentWeather(travelerForWeather.current_city);

      // Phase 1c: pure weather question → respond directly; hybrid → route to food handler
      const hasFoodIntent = !!(details.meal_type || details.cuisine || details.area);
      if (!hasFoodIntent && weather) {
        // Standalone weather response — Sam-voiced, no spot recommendations
        response = await samSays(
          `Respond with today's weather in ${cityName}: ${weather.summary} One or two casual sentences. Don't recommend any spots.`,
          cityName
        );
      } else {
        // Hybrid query: weather context injected into food recommendation
        const weatherSummary = weather
          ? `Current weather in ${cityName}: ${weather.summary}`
          : "";
        const recentCtxForWeather = conversation.messages
          .slice(-6)
          .map((m) => `${m.role}: ${m.content}`)
          .join("\n");
        response = await handleHungry(
          from,
          weatherSummary ? `${text}\n\n[Context: ${weatherSummary}]` : text,
          {
            ...details,
            ...(weather?.is_raining ? { mood: "indoor" } : {}),
          },
          recentCtxForWeather,
          { channel: "whatsapp" }
        );
      }
      break;
    }

    case "spot_info": {
      const spotName = details.spot_name ?? text;
      const city = getDefaultCity();
      response = await handleSpotInfo(from, text, spotName, city, { channel: "whatsapp" });
      break;
    }

    case "general":
    default: {
      // General conversation — Sam's personality via Claude
      // Only load recommendation history when the user is asking about past recommendations
      let systemContext: string | undefined;
      // Detect activity/sightseeing queries — give Sam's honest "food is my thing" framing
      const askingAboutActivities = /\b(activity|activities|sightseeing|things to do|what to do|museums?|attractions?|temples?|tours?|besides (eating|food)|non-food)\b/i.test(text);
      if (askingAboutActivities) {
        systemContext = "The user is asking about activities or sightseeing. Be honest: your strength is food and dining. You have some activity spots in your knowledge graph but limited coverage. Acknowledge this warmly, mention you can help with food-focused day plans, and suggest they check Google Maps or TripAdvisor for full activities coverage. Don't pretend you have comprehensive activities data.";
      }
      const askingAboutHistory = /recommend|suggest|told me|what did you|remember|your picks|list/i.test(text);
      if (askingAboutHistory) {
        const traveler = await getOrCreateTraveler(from);
        if (traveler.spots_recommended?.length) {
          const recentIds = traveler.spots_recommended.slice(-15);
          const spots = await getSpotsByIds(recentIds);
          if (spots.length) {
            const names = spots.map(s => `${s.name}${s.area ? ` (${s.area})` : ""}`).join(", ");
            systemContext = `Spots you have previously recommended to this user: ${names}. If they ask what you've recommended, list these naturally.`;
          }
        }
      }
      response = await chatAsSam(
        conversation.messages.slice(-10).map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        text,
        { channel: "whatsapp", systemContext }
      );
      break;
    }
  }

  // Save conversation history
  await appendMessages(from, [
    { role: "user", content: text },
    { role: "assistant", content: response },
  ]);

  await sendMessage(from, response);
  maybeExtractProfile(from, [
    { role: "user", content: text },
    { role: "assistant", content: response },
  ], intent).catch(() => {});

  } finally {
    const usage = flushUsage(from);
    if (usage && usage.calls > 0) {
      trackEvent(from, "whatsapp", "llm_usage", {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        calls: usage.calls,
        intent: usageIntent,
      });
    }
  }
}

/** Route to the current active flow */
async function routeToCurrentFlow(
  phoneNumber: string,
  text: string,
  audioId: string | undefined,
  conversation: ReturnType<typeof getOrCreateConversation> extends Promise<infer T> ? T : never
): Promise<string> {
  const flow = conversation.current_flow;

  // Allow user to exit any flow
  if (text.toLowerCase() === "cancel" || text.toLowerCase() === "stop") {
    await updateConversation(phoneNumber, {
      current_flow: "general",
      flow_state: {},
    });
    return "No worries! What else can I help with?";
  }

  switch (flow) {
    case "contribution":
      return handleContribution(phoneNumber, text, audioId, conversation);

    case "profile_learning":
      return handleProfile(phoneNumber, text, conversation);

    case "strategic":
      // Profile just completed — generate strategic decisions
      if (conversation.flow_state.profile_just_completed) {
        return handleStrategic(phoneNumber);
      }
      return handleProfile(phoneNumber, text, conversation);

    case "feedback":
      return handleFeedback(phoneNumber, text, conversation);

    case "spot_correction":
      return handleSpotCorrection(phoneNumber, text, {}, { channel: "whatsapp", conversation });

    case "generate":
      return handleGenerate(phoneNumber, text, conversation);

    case "spot_verification":
      return handleSpotVerification(phoneNumber, text, conversation);

    case "query_clarifying": {
      const { pending_query, pending_details } = conversation.flow_state;
      const recentCtx = conversation.messages.slice(-6).map(m => `${m.role}: ${m.content}`).join("\n");
      await updateConversation(phoneNumber, { current_flow: "general", flow_state: {} });
      // Re-classify the clarifying answer to capture fresh signals (area, meal_type, etc.)
      const { details: freshDetails } = await classifyIntent(text, recentCtx);
      const mergedDetails = { ...pending_details, ...freshDetails };
      return handleHungry(phoneNumber, `${pending_query}. ${text}`, mergedDetails, recentCtx, { channel: "whatsapp" });
    }

    default:
      // Unknown flow — reset to general
      await updateConversation(phoneNumber, {
        current_flow: "general",
        flow_state: {},
      });
      return chatAsSam([], text);
  }
}

// ============================================
// HEALTH CHECK
// ============================================
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "sam-bot", city: getDefaultCity() });
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
  console.log(`Sam is running on port ${PORT}`);
  console.log(`Webhook URL: https://your-domain.com/webhook`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  startScheduler();
});
