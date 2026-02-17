// Paul — WhatsApp travel intelligence service for Kuala Lumpur
// Main entry point: Express app + webhook routes + flow routing

import express from "express";
import { parseWebhook, sendMessage, showTyping } from "./whatsapp.js";
import { chatAsP, classifyIntent, extractJSON } from "./llm.js";
import {
  getOrCreateConversation,
  updateConversation,
  appendMessages,
  insertSpot,
  findDuplicateSpot,
} from "./database.js";
import { handleContribution } from "./handlers/contribution.js";
import { handleQuery } from "./handlers/query.js";
import { handleProfile, startProfileLearning } from "./handlers/profile.js";
import { handleStrategic } from "./handlers/strategic.js";
import { handleHungry, handleDayPlan, handleNearby } from "./handlers/ontrip.js";
import { handleFeedback, startFeedbackCollection } from "./handlers/feedback.js";
import { startGenerate, handleGenerate } from "./handlers/generate.js";
import { maybeExtractProfile } from "./handlers/continuous-profile.js";

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
    // Show typing indicator immediately so user knows Paul is thinking
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

  const { from, type, text, audioId, location } = message;
  const conversation = await getOrCreateConversation(from);
  const currentFlow = conversation.current_flow;

  // Location pin → route to nearby handler
  if (type === "location" && location) {
    const response = await handleNearby(from, `I'm at ${location.latitude}, ${location.longitude}`, {
      neighborhood: undefined,
      specific_place: `${location.latitude},${location.longitude}`,
    });
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

  if (!text) return;

  const ADMIN_PHONE = process.env.ADMIN_PHONE_NUMBER;

  // Admin rapid-add: "add: Fatty Crab, Taman Megah, dinner, tier 1. ..."
  if (ADMIN_PHONE && from === ADMIN_PHONE && text.toLowerCase().startsWith("add:")) {
    const spotText = text.slice(4).trim();
    const extracted = await extractJSON<Record<string, any>>("extraction", spotText);

    const criticalMissing = (extracted.missing_fields ?? []).filter((f: string) =>
      ["name", "category", "neighborhood"].includes(f)
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
          if (f === "neighborhood") return "Neighborhood?";
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
    const duplicate = await findDuplicateSpot(spotData.name, spotData.neighborhood);
    if (duplicate) {
      const response = `*${duplicate.name}* (${duplicate.neighborhood}) already exists in the graph.`;
      await appendMessages(from, [
        { role: "user", content: text },
        { role: "assistant", content: response },
      ]);
      await sendMessage(from, response);
      return;
    }

    await insertSpot({ ...spotData, source: "text" });
    const response = `Added *${extracted.name}* (${extracted.neighborhood}, ${extracted.category}) to the graph.`;
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

  let response: string;

  switch (intent) {
    case "hungry":
      response = await handleHungry(from, text, details);
      break;

    case "day_plan":
      response = await handleDayPlan(from, text, details);
      break;

    case "nearby":
      response = await handleNearby(from, text, details);
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

    case "weather": {
      // Weather-aware response — prepend weather summary to query response
      const { getCurrentWeather } = await import("./weather.js");
      const weather = await getCurrentWeather();
      const weatherSummary = weather
        ? `Current weather in KL: ${weather.summary}${weather.is_raining ? " (raining)" : ""}`
        : "";
      const weatherContext = weatherSummary ? `Weather info: ${weatherSummary}` : undefined;
      response = await handleQuery(from, text, {
        ...details,
        ...(weather?.is_raining ? { mood: "indoor" } : {}),
      }, weatherContext);
      break;
    }

    case "general":
    default:
      // General conversation — Paul's personality via Claude
      response = await chatAsP(
        conversation.messages.slice(-10).map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        text
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

    default:
      // Unknown flow — reset to general
      await updateConversation(phoneNumber, {
        current_flow: "general",
        flow_state: {},
      });
      return chatAsP([], text);
  }
}

// ============================================
// HEALTH CHECK
// ============================================
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "paul-bot", city: "Kuala Lumpur" });
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
  console.log(`Paul is running on port ${PORT}`);
  console.log(`Webhook URL: https://your-domain.com/webhook`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
