import { setPromptsDir } from "@sam/bot/llm";
import { resolve } from "path";

// Configure prompts directory before any handler code calls loadPrompt.
// This runs at module initialization — before any request handlers fire.
setPromptsDir(resolve(process.cwd(), "../bot/src/prompts"));

import { NextRequest } from "next/server";
import { checkRateLimit, DAILY_LIMIT } from "@/lib/rate-limit";
import {
  getOrCreateConversation,
  getOrCreateTraveler,
  updateTraveler,
  appendMessages,
  updateConversation,
  trackEvent,
} from "@sam/bot/database";
import {
  classifyIntent,
  chat,
  chatAsSamStream,
  chatStream,
  startUsageTracking,
  flushUsage,
} from "@sam/bot/llm";
import { handleContribution } from "@sam/bot/handlers/contribution";
import { handleQuery } from "@sam/bot/handlers/query";
import { handleProfile, startProfileLearning } from "@sam/bot/handlers/profile";
import { handleStrategic } from "@sam/bot/handlers/strategic";
import {
  handleHungry, handleDayPlan, handleNearby, handleSpotInfo,
  buildHungryPrompt, buildDayPlanPrompt, buildNearbyPrompt, buildSpotInfoPayload,
  isVagueQuery, getClarifyingQuestion,
  isUnclearQuery, UNCLEAR_CLARIFYING_QUESTION,
} from "@sam/bot/handlers/ontrip";
import { handleFeedback, startFeedbackCollection } from "@sam/bot/handlers/feedback";
import { handleSpotCorrection } from "@sam/bot/handlers/spot-correction";
import { maybeExtractProfile } from "@sam/bot/handlers/continuous-profile";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) return Response.json({ messages: [] });

  try {
    const conversation = await getOrCreateConversation(sessionId);
    return Response.json({ messages: conversation.messages });
  } catch {
    return Response.json({ messages: [] });
  }
}

const LOCALHOST_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  // "unknown" is NOT localhost — treat as its own rate-limit bucket to prevent bypass
  const isLocalhost = LOCALHOST_IPS.has(ip);
  const { allowed, remaining } = isLocalhost
    ? { allowed: true, remaining: 9999 }
    : checkRateLimit(ip);

  if (!allowed) {
    return new Response(
      JSON.stringify({
        error:
          `You've hit your ${DAILY_LIMIT} messages for today — I need a breather! Catch me on WhatsApp for unlimited chat.`,
        remaining: 0,
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "X-RateLimit-Remaining": "0",
        },
      }
    );
  }

  const { sessionId, message, initFlow } = (await req.json()) as {
    sessionId: string;
    message?: string;
    initFlow?: string;
  };

  if (!sessionId) {
    return new Response(
      JSON.stringify({ error: "sessionId required" }),
      { status: 400 }
    );
  }

  // Initialize a flow without processing a message (e.g. "Tell Sam" sets contribution flow)
  if (initFlow && !message) {
    await getOrCreateConversation(sessionId);
    await updateConversation(sessionId, {
      current_flow: initFlow,
      flow_state: { stage: "collecting", extracted: {}, source: "text", messagesReceived: 0 },
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  if (!message) {
    return new Response(
      JSON.stringify({ error: "message required" }),
      { status: 400 }
    );
  }

  try {
    startUsageTracking(sessionId);
    const conversation = await getOrCreateConversation(sessionId);
    const currentFlow = conversation.current_flow;

    // --- Mid-flow routing (multi-turn conversations) ---
    if (currentFlow !== "general") {
      trackEvent(sessionId, "web", "message", { flow: currentFlow });

      const response = await routeToFlow(
        sessionId,
        message,
        conversation
      );

      await appendMessages(sessionId, [
        { role: "user", content: message },
        { role: "assistant", content: response },
      ]);

      maybeExtractProfile(
        sessionId,
        [
          { role: "user", content: message },
          { role: "assistant", content: response },
        ],
        currentFlow
      ).catch(() => {});

      flushAndTrackUsage(sessionId, currentFlow);
      return sseTextResponse(response || "Got it — something went sideways on my end, but try sending that again?", remaining);
    }

    // --- Fresh intent classification ---
    const recentContext = conversation.messages
      .slice(-6)
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const { intent, details: rawDetails } = await classifyIntent(message, recentContext);
    const details = rawDetails ?? {};
    console.log("[web-chat] intent:", intent, "details:", details);

    // Persist city resolved from area so follow-up queries without an explicit area stay in context.
    // Must await getOrCreateTraveler first — updateTraveler uses UPDATE (not upsert) and is a
    // no-op if the row doesn't exist yet. On fresh sessions the row is created here.
    if (details.area) {
      const { resolveCityFromArea } = await import("@sam/bot/utils/city-defaults");
      const resolvedCity = resolveCityFromArea(details.area as string);
      if (resolvedCity) {
        await getOrCreateTraveler(sessionId);
        updateTraveler(sessionId, { current_city: resolvedCity }).catch(() => {});
      }
    }

    trackEvent(sessionId, "web", "message", { intent });

    // Intents that produce long responses → stream them
    const streamableIntents = new Set([
      "hungry",
      "day_plan",
      "nearby",
      "weather",
      "general",
      "spot_info",
    ]);

    if (streamableIntents.has(intent)) {
      return streamHandlerResponse(sessionId, message, intent, details, conversation, remaining);
    }

    // Multi-turn intents → call handler, return as single SSE chunk
    let response: string;

    switch (intent) {
      case "contribute":
        response = await handleContribution(sessionId, message, undefined, conversation, { channel: "web" });
        break;

      case "profile":
        response = await startProfileLearning(sessionId, message);
        break;

      case "feedback":
        response = await startFeedbackCollection(sessionId, message);
        break;

      case "spot_correction":
        response = await handleSpotCorrection(sessionId, message, details, { channel: "web" });
        break;

      default:
        response = await handleGeneral(sessionId, message, conversation);
        break;
    }

    await appendMessages(sessionId, [
      { role: "user", content: message },
      { role: "assistant", content: response },
    ]);

    maybeExtractProfile(
      sessionId,
      [
        { role: "user", content: message },
        { role: "assistant", content: response },
      ],
      intent
    ).catch(() => {});

    flushAndTrackUsage(sessionId, intent);
    return sseTextResponse(response || "Got it — something went sideways on my end, but try sending that again?", remaining);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[web-chat] Error:", msg, error);
    flushUsage(sessionId); // Clean up tracking bucket
    return sseTextResponse("Sorry, something went wrong on my end. Try sending that again?");
  }
}

// --- Flow router (mirrors WhatsApp index.ts routeToCurrentFlow) ---

async function routeToFlow(
  sessionId: string,
  message: string,
  conversation: Awaited<ReturnType<typeof getOrCreateConversation>>
): Promise<string> {
  const flow = conversation.current_flow;

  // Allow user to exit any flow
  if (message.toLowerCase() === "cancel" || message.toLowerCase() === "stop") {
    await updateConversation(sessionId, {
      current_flow: "general",
      flow_state: {},
    });
    return "No worries! What else can I help with?";
  }

  switch (flow) {
    case "contribution":
      return handleContribution(sessionId, message, undefined, conversation, { channel: "web" });

    case "profile_learning":
      return handleProfile(sessionId, message, conversation, { channel: "web" });

    case "strategic":
      if (conversation.flow_state.profile_just_completed) {
        return handleStrategic(sessionId);
      }
      return handleProfile(sessionId, message, conversation, { channel: "web" });

    case "feedback":
      return handleFeedback(sessionId, message, conversation, { channel: "web" });

    case "query_clarifying": {
      const { pending_query, pending_details } = conversation.flow_state;
      const recentCtx = conversation.messages.slice(-6).map(m => `${m.role}: ${m.content}`).join("\n");
      await updateConversation(sessionId, { current_flow: "general", flow_state: {} });
      // Re-classify the clarifying answer to capture fresh signals (area, meal_type, etc.)
      const { details: freshDetails } = await classifyIntent(message, recentCtx);
      const mergedDetails = { ...pending_details, ...freshDetails };
      return handleHungry(sessionId, `${pending_query}. ${message}`, mergedDetails, recentCtx, { channel: "web" });
    }

    default:
      await updateConversation(sessionId, {
        current_flow: "general",
        flow_state: {},
      });
      return handleGeneral(sessionId, message, conversation);
  }
}

// --- Streaming handler for recommendation intents ---

async function streamHandlerResponse(
  sessionId: string,
  message: string,
  intent: string,
  details: Record<string, string>,
  conversation: Awaited<ReturnType<typeof getOrCreateConversation>>,
  rateLimitRemaining?: number
): Promise<Response> {
  const recentHistory = conversation.messages
    .slice(-6)
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  // Use prompt builders for structured handlers, then stream the LLM call
  switch (intent) {
    case "hungry": {
      const alreadyAsked = conversation.flow_state?.asked_clarifying;
      // If the user is telling Sam to stop asking questions, skip clarification entirely
      const isImpatient = /\b(stop ask|just tell|just give|just show|no more question|enough question|don't ask|quit asking|stop with the question)\b/i.test(message);
      // Skip clarifying question for cities we don't cover — let buildHungryPrompt return
      // an honest no-coverage response instead of asking "what are you feeling?"
      const { isSupportedCity } = await import("@sam/bot/utils/city-defaults");
      const travelerForCity = await getOrCreateTraveler(sessionId);
      const inUnsupportedCity = !!(travelerForCity.current_city && !isSupportedCity(travelerForCity.current_city));
      // In multi-turn conversations Sam has enough context to make a recommendation — don't ask again
      const hasConversationContext = recentHistory.trim().length > 0;
      if (!inUnsupportedCity && !alreadyAsked && !isImpatient && !hasConversationContext && (isVagueQuery(details) || isUnclearQuery(details, recentHistory, message))) {
        const question = isVagueQuery(details)
          ? getClarifyingQuestion(details)
          : UNCLEAR_CLARIFYING_QUESTION;
        await updateConversation(sessionId, {
          current_flow: "query_clarifying",
          flow_state: { pending_query: message, pending_details: details, asked_clarifying: true },
        });
        await appendMessages(sessionId, [
          { role: "user", content: message },
          { role: "assistant", content: question },
        ]);
        maybeExtractProfile(sessionId, [{ role: "user", content: message }, { role: "assistant", content: question }], "hungry").catch(() => {});
        flushAndTrackUsage(sessionId, "hungry");
        return sseTextResponse(question, rateLimitRemaining);
      }
      const payload = await buildHungryPrompt(sessionId, message, details, recentHistory, { channel: "web" });
      const stream = chatStream(
        payload.systemPrompt,
        [{ role: "user", content: payload.userPrompt }],
        { maxTokens: payload.maxTokens }
      );
      return streamSSE(stream, sessionId, message, intent, rateLimitRemaining, payload.spotIds);
    }
    case "day_plan": {
      const payload = await buildDayPlanPrompt(sessionId, message, details, recentHistory, { channel: "web" });
      const stream = chatStream(
        payload.systemPrompt,
        [{ role: "user", content: payload.userPrompt }],
        { maxTokens: payload.maxTokens }
      );
      return streamSSE(stream, sessionId, message, intent, rateLimitRemaining, payload.spotIds);
    }
    case "nearby": {
      const payload = await buildNearbyPrompt(sessionId, message, details, recentHistory, { channel: "web" });
      const stream = chatStream(
        payload.systemPrompt,
        [{ role: "user", content: payload.userPrompt }],
        { maxTokens: payload.maxTokens }
      );
      return streamSSE(stream, sessionId, message, intent, rateLimitRemaining, payload.spotIds);
    }
    case "weather": {
      // Return actual weather data — not a food recommendation
      const { getCurrentWeather } = await import("@sam/bot/weather");
      const { getDefaultCity } = await import("@sam/bot/utils/city-defaults");
      const { chat, buildSystemPrompt } = await import("@sam/bot/llm");
      const travelerForWeather = await getOrCreateTraveler(sessionId);
      const weatherCity = travelerForWeather.current_city ?? getDefaultCity();
      const weather = await getCurrentWeather(weatherCity);
      const weatherPrompt = weather
        ? `User asks: "${message}". Answer directly and casually about the weather in ${weatherCity} right now: ${weather.temp}°C, feels like ${weather.feels_like}°C, ${weather.description}, humidity ${weather.humidity}%.${weather.is_raining ? " It's raining — mention bringing an umbrella." : ""} One or two sentences.`
        : `User asks: "${message}". You don't have live weather data right now — say so honestly in one sentence.`;
      const weatherResponse = await chat(buildSystemPrompt(weatherCity, "web"), [{ role: "user", content: weatherPrompt }], { maxTokens: 150 });
      await appendMessages(sessionId, [
        { role: "user", content: message },
        { role: "assistant", content: weatherResponse },
      ]);
      flushAndTrackUsage(sessionId, "weather");
      return sseTextResponse(weatherResponse, rateLimitRemaining);
    }
    case "spot_info": {
      const { getDefaultCity } = await import("@sam/bot/utils/city-defaults");
      const spotName = details.spot_name ?? message;
      const travelerForSpot = await getOrCreateTraveler(sessionId);
      const city = travelerForSpot.current_city ?? getDefaultCity();
      const payload = await buildSpotInfoPayload(sessionId, message, spotName, city, { channel: "web" });
      const response = await chat(payload.systemPrompt, [{ role: "user", content: payload.userPrompt }], { maxTokens: payload.maxTokens });
      await appendMessages(sessionId, [
        { role: "user", content: message },
        { role: "assistant", content: response },
      ]);
      maybeExtractProfile(sessionId, [{ role: "user", content: message }, { role: "assistant", content: response }], intent).catch(() => {});
      flushAndTrackUsage(sessionId, intent);
      return sseTextResponse(response, rateLimitRemaining, payload.spotIds);
    }
    case "general":
    default: {
      // Stream general chat token-by-token
      const history = conversation.messages.slice(-10).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      const stream = chatAsSamStream(history, message, { channel: "web" });
      return streamSSE(stream, sessionId, message, intent, rateLimitRemaining);
    }
  }
}

// --- General chat fallback ---

async function handleGeneral(
  sessionId: string,
  message: string,
  conversation: Awaited<ReturnType<typeof getOrCreateConversation>>
): Promise<string> {
  const { chatAsSam } = await import("@sam/bot/llm");
  return chatAsSam(
    conversation.messages.slice(-10).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    message,
    { channel: "web" }
  );
}

// --- Usage tracking helper ---

function flushAndTrackUsage(sessionId: string, intent: string) {
  const usage = flushUsage(sessionId);
  if (usage && usage.calls > 0) {
    trackEvent(sessionId, "web", "llm_usage", {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      calls: usage.calls,
      intent,
    });
  }
}

// --- SSE helpers ---

/** Stream a Claude MessageStream as SSE, save conversation after */
function streamSSE(
  stream: ReturnType<typeof chatAsSamStream>,
  sessionId: string,
  message: string,
  intent: string,
  rateLimitRemaining?: number,
  spotIds?: string[]
): Response {
  const encoder = new TextEncoder();
  let fullResponse = "";

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            const text = event.delta.text;
            fullResponse += text;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text })}\n\n`)
            );
          }
        }

        // Flush token usage tracking after stream completes
        flushAndTrackUsage(sessionId, intent);

        // Save history BEFORE sending [DONE] so the next request sees it immediately
        await appendMessages(sessionId, [
          { role: "user", content: message },
          { role: "assistant", content: fullResponse },
        ]);

        // Emit spot IDs so eval clients can query DB for ground-truth hallucination checking
        if (spotIds && spotIds.length > 0) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ spotIds })}\n\n`)
          );
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();

        maybeExtractProfile(
          sessionId,
          [
            { role: "user", content: message },
            { role: "assistant", content: fullResponse },
          ],
          intent
        ).catch(() => {});
      } catch (error) {
        console.error("[web-chat] Stream error:", error);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: "Stream error" })}\n\n`
          )
        );
        controller.close();
      }
    },
  });

  const headers: Record<string, string> = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  };
  if (rateLimitRemaining !== undefined) {
    headers["X-RateLimit-Remaining"] = String(rateLimitRemaining);
  }

  return new Response(readable, { headers });
}

/** Send a complete text response as a single SSE chunk, optionally with spotIds */
function sseTextResponse(text: string, rateLimitRemaining?: number, spotIds?: string[]): Response {
  const encoder = new TextEncoder();
  const parts = [`data: ${JSON.stringify({ text })}\n\n`];
  if (spotIds && spotIds.length > 0) {
    parts.push(`data: ${JSON.stringify({ spotIds })}\n\n`);
  }
  parts.push("data: [DONE]\n\n");
  const body = encoder.encode(parts.join(""));

  const headers: Record<string, string> = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  };
  if (rateLimitRemaining !== undefined) {
    headers["X-RateLimit-Remaining"] = String(rateLimitRemaining);
  }

  return new Response(body, { headers });
}
