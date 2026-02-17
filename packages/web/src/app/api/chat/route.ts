import { setPromptsDir } from "@sam/bot/llm";
import { resolve } from "path";

// Configure prompts directory before any handler code calls loadPrompt.
// This runs at module initialization — before any request handlers fire.
setPromptsDir(resolve(process.cwd(), "../bot/src/prompts"));

import { NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  getOrCreateConversation,
  appendMessages,
  updateConversation,
} from "@sam/bot/database";
import {
  classifyIntent,
  chatAsSamStream,
  chatStream,
} from "@sam/bot/llm";
import { handleContribution } from "@sam/bot/handlers/contribution";
import { handleQuery } from "@sam/bot/handlers/query";
import { handleProfile, startProfileLearning } from "@sam/bot/handlers/profile";
import { handleStrategic } from "@sam/bot/handlers/strategic";
import {
  handleHungry, handleDayPlan, handleNearby,
  buildHungryPrompt, buildDayPlanPrompt, buildNearbyPrompt,
} from "@sam/bot/handlers/ontrip";
import { handleFeedback, startFeedbackCollection } from "@sam/bot/handlers/feedback";
import { maybeExtractProfile } from "@sam/bot/handlers/continuous-profile";

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { allowed, remaining } = checkRateLimit(ip);

  if (!allowed) {
    return new Response(
      JSON.stringify({
        error:
          "You've hit your 30 messages for today — I need a breather! Catch me on WhatsApp for unlimited chat.",
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

  const { sessionId, message } = (await req.json()) as {
    sessionId: string;
    message: string;
  };

  if (!sessionId || !message) {
    return new Response(
      JSON.stringify({ error: "sessionId and message required" }),
      { status: 400 }
    );
  }

  try {
    const conversation = await getOrCreateConversation(sessionId);
    const currentFlow = conversation.current_flow;

    // --- Mid-flow routing (multi-turn conversations) ---
    if (currentFlow !== "general") {
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

      return sseTextResponse(response, remaining);
    }

    // --- Fresh intent classification ---
    const recentContext = conversation.messages
      .slice(-6)
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const { intent, details } = await classifyIntent(message, recentContext);
    console.log("[web-chat] intent:", intent, "details:", details);

    // Intents that produce long responses → stream them
    const streamableIntents = new Set([
      "hungry",
      "day_plan",
      "nearby",
      "weather",
      "general",
    ]);

    if (streamableIntents.has(intent)) {
      return streamHandlerResponse(sessionId, message, intent, details, conversation, remaining);
    }

    // Multi-turn intents → call handler, return as single SSE chunk
    let response: string;

    switch (intent) {
      case "contribute":
        response = await handleContribution(sessionId, message, undefined, conversation);
        break;

      case "profile":
        response = await startProfileLearning(sessionId, message);
        break;

      case "feedback":
        response = await startFeedbackCollection(sessionId);
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

    return sseTextResponse(response, remaining);
  } catch (error) {
    console.error("[web-chat] Error:", error);
    return sseTextResponse("Sorry, something went wrong on my end. Try again?");
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
      return handleContribution(sessionId, message, undefined, conversation);

    case "profile_learning":
      return handleProfile(sessionId, message, conversation);

    case "strategic":
      if (conversation.flow_state.profile_just_completed) {
        return handleStrategic(sessionId);
      }
      return handleProfile(sessionId, message, conversation);

    case "feedback":
      return handleFeedback(sessionId, message, conversation);

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
  // Use prompt builders for structured handlers, then stream the LLM call
  switch (intent) {
    case "hungry": {
      const payload = await buildHungryPrompt(sessionId, message, details);
      const stream = chatStream(
        payload.systemPrompt,
        [{ role: "user", content: payload.userPrompt }],
        { maxTokens: payload.maxTokens }
      );
      return streamSSE(stream, sessionId, message, intent, rateLimitRemaining);
    }
    case "day_plan": {
      const payload = await buildDayPlanPrompt(sessionId, message, details);
      const stream = chatStream(
        payload.systemPrompt,
        [{ role: "user", content: payload.userPrompt }],
        { maxTokens: payload.maxTokens }
      );
      return streamSSE(stream, sessionId, message, intent, rateLimitRemaining);
    }
    case "nearby": {
      const payload = await buildNearbyPrompt(sessionId, message, details);
      const stream = chatStream(
        payload.systemPrompt,
        [{ role: "user", content: payload.userPrompt }],
        { maxTokens: payload.maxTokens }
      );
      return streamSSE(stream, sessionId, message, intent, rateLimitRemaining);
    }
    case "weather": {
      // Weather-aware: use handleQuery (non-streamed, returns complete string)
      const response = await handleQuery(sessionId, message, { ...details });
      await appendMessages(sessionId, [
        { role: "user", content: message },
        { role: "assistant", content: response },
      ]);
      maybeExtractProfile(sessionId, [
        { role: "user", content: message },
        { role: "assistant", content: response },
      ], intent).catch(() => {});
      return sseTextResponse(response, rateLimitRemaining);
    }
    case "general":
    default: {
      // Stream general chat token-by-token
      const history = conversation.messages.slice(-10).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      const stream = chatAsSamStream(history, message);
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
    message
  );
}

// --- SSE helpers ---

/** Stream a Claude MessageStream as SSE, save conversation after */
function streamSSE(
  stream: ReturnType<typeof chatAsSamStream>,
  sessionId: string,
  message: string,
  intent: string,
  rateLimitRemaining?: number
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

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();

        await appendMessages(sessionId, [
          { role: "user", content: message },
          { role: "assistant", content: fullResponse },
        ]);

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

/** Send a complete text response as a single SSE chunk */
function sseTextResponse(text: string, rateLimitRemaining?: number): Response {
  const encoder = new TextEncoder();
  const body = encoder.encode(
    `data: ${JSON.stringify({ text })}\n\ndata: [DONE]\n\n`
  );

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
