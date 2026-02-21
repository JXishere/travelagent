// Sam — WhatsApp travel intelligence service for Kuala Lumpur
// Main entry point: Express app + webhook routes + flow routing

import express from "express";
import { parseWebhook, sendMessage, showTyping } from "./whatsapp.js";
import { chatAsSam, classifyIntent, extractJSON, startUsageTracking, flushUsage } from "./llm.js";
import {
  getOrCreateConversation,
  updateConversation,
  appendMessages,
  insertSpot,
  findDuplicateSpot,
  touchLastUserMessage,
  trackEvent,
} from "./database.js";
import { getDefaultCity } from "./utils/city-defaults.js";
import { handleContribution } from "./handlers/contribution.js";
import { handleQuery } from "./handlers/query.js";
import { handleProfile, startProfileLearning } from "./handlers/profile.js";
import { handleStrategic } from "./handlers/strategic.js";
import { handleHungry, handleDayPlan, handleNearby, handleSpotInfo, isUnclearQuery, UNCLEAR_CLARIFYING_QUESTION } from "./handlers/ontrip.js";
import { handleFeedback, startFeedbackCollection } from "./handlers/feedback.js";
import { handleSpotCorrection } from "./handlers/spot-correction.js";
import { startGenerate, handleGenerate } from "./handlers/generate.js";
import { maybeExtractProfile } from "./handlers/continuous-profile.js";
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
      ["name", "category", "area"].includes(f)
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
          if (f === "category") return "Category? (breakfast/lunch/dinner/cafe/activity/nightlife/market)";
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

    await insertSpot({ ...spotData, source: "text" });
    const response = `Added *${extracted.name}* (${extracted.area}, ${(extracted.categories ?? []).join("/")}) to the graph.`;
    await appendMessages(from, [
      { role: "user", content: text },
      { role: "assistant", content: response },
    ]);
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
      response = await handleSpotCorrection(from, text, details, { channel: "whatsapp" });
      break;

    case "weather": {
      // Weather-aware response — prepend weather summary to query response
      const { getCurrentWeather } = await import("./weather.js");
      const weather = await getCurrentWeather();
      const weatherSummary = weather
        ? `Current weather in ${getDefaultCity()}: ${weather.summary}${weather.is_raining ? " (raining)" : ""}`
        : "";
      const weatherContext = weatherSummary ? `Weather info: ${weatherSummary}` : undefined;
      response = await handleQuery(from, text, {
        ...details,
        ...(weather?.is_raining ? { mood: "indoor" } : {}),
      }, weatherContext);
      break;
    }

    case "spot_info": {
      const spotName = details.spot_name ?? text;
      const city = getDefaultCity();
      response = await handleSpotInfo(from, text, spotName, city, { channel: "whatsapp" });
      break;
    }

    case "general":
    default:
      // General conversation — Sam's personality via Claude
      response = await chatAsSam(
        conversation.messages.slice(-10).map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        text,
        { channel: "whatsapp" }
      );
      break;
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

    case "generate":
      return handleGenerate(phoneNumber, text, conversation);

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
