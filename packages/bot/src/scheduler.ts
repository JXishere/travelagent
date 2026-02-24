// Proactive message scheduler — makes Sam reach out like a friend
// Runs on a 5-minute interval, checks for travelers who should hear from Sam

import { sendMessage } from "./whatsapp.js";
import { chat, HAIKU } from "./llm.js";
import {
  getActiveTravelers,
  touchLastProactive,
  markFeedbackAsked,
  getSpotsNeedingFeedback,
  getDailyDigestData,
  hasDailyDigestRunToday,
  hasStalenessCheckRunToday,
  getStaleSpotsForVerification,
  getLatestCoachRun,
  getRecentErrors,
  trackEvent,
  updateConversation,
  getOrCreateConversation,
  type Traveler,
} from "./database.js";
import { getCurrentWeather } from "./weather.js";
import { startFeedbackCollection } from "./handlers/feedback.js";
import { readFileSync } from "fs";
import { join } from "path";

const PROACTIVE_PROMPT = readFileSync(
  join(__dirname, "prompts", "proactive.txt"),
  "utf-8"
);

// KL is UTC+8
const KL_OFFSET_HOURS = 8;

const TICK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const COOLDOWN_HOURS = 8;
const WHATSAPP_WINDOW_HOURS = 23; // 1h buffer from 24h limit

export type ProactiveType =
  | "TRIP_WELCOME"
  | "FEEDBACK_CHECK"
  | "MORNING_NUDGE"
  | "DINNER_NUDGE";

export interface ProactiveResult {
  type: ProactiveType;
  context: string;
}

interface CandidateInfo {
  name?: string;
  trip_dates?: { start: string; end: string };
  last_proactive_at?: string;
  last_user_message_at?: string;
  current_flow: string;
  spots_recommended: string[];
  spots_feedback_asked: string[];
  dietary_restrictions?: string[];
  travel_party?: string;
  current_city?: string;
  preferences?: Record<string, any>;
}

let intervalId: ReturnType<typeof setInterval> | null = null;

// In-memory dedup for bug alerts — keyed by "errorType:contextKey", value = last alerted ms
const alertedAt = new Map<string, number>();
const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour per key

/** Start the proactive message scheduler */
export function startScheduler(): void {
  console.log("[scheduler] Starting proactive message scheduler (5-min interval)");
  // First tick after 10s delay to let the server fully start
  setTimeout(() => tick(), 10_000);
  intervalId = setInterval(() => tick(), TICK_INTERVAL_MS);
}

/** Stop the scheduler (for tests / graceful shutdown) */
export function stopScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[scheduler] Stopped");
  }
}

/** One scheduler tick — check all active travelers */
async function tick(): Promise<void> {
  try {
    const travelers = await getActiveTravelers();
    const now = new Date();
    console.log(`[scheduler] Tick — ${travelers.length} active traveler(s)`);

    for (const traveler of travelers) {
      try {
        const result = evaluateCandidate(traveler, now);
        if (!result) continue;

        console.log(`[scheduler] Sending ${result.type} to ${traveler.whatsapp_number}`);
        await sendProactiveMessage(traveler, result);
        await touchLastProactive(traveler.whatsapp_number);
      } catch (err) {
        console.error(`[scheduler] Error for ${traveler.whatsapp_number}:`, err);
      }
    }
  } catch (err) {
    console.error("[scheduler] Tick error:", err);
  }

  // Run maintenance jobs — fire-and-forget so proactive messaging isn't affected
  maybeRunDailyDigest().catch(err => console.error("[scheduler] Daily digest error:", err));
  maybeRunStalenessCheck().catch(err => console.error("[scheduler] Staleness check error:", err));
  maybeAlertBugs().catch(err => console.error("[scheduler] Bug alert error:", err));
}

// ============================================
// P1.A — DAILY DIGEST
// ============================================

/** Send a daily metrics digest to Slack at 9:00–9:05am KL time */
async function maybeRunDailyDigest(): Promise<void> {
  const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!slackWebhookUrl) return;

  const now = new Date();
  const klHour = getKLHour(now);
  const klMinute = getKLMinute(now);

  // Window: 9:00–9:05am KL
  if (klHour !== 9 || klMinute > 5) return;
  if (await hasDailyDigestRunToday()) return;

  const [data, latestCoachRun] = await Promise.all([
    getDailyDigestData(),
    getLatestCoachRun().catch(() => null),
  ]);

  const dateStr = formatKLDate(now);
  const dayName = new Date(now.getTime() + KL_OFFSET_HOURS * 60 * 60 * 1000)
    .toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });

  const totalMessages = data.waMessages + data.webMessages;
  const costStr = `$${data.totalCost.toFixed(2)} (${Math.round(data.totalInputTokens / 1000)}k in · ${Math.round(data.totalOutputTokens / 1000)}k out)`;

  // Spots by area (fall back to city if area is null)
  const byAreaMap: Record<string, number> = {};
  for (const s of data.newSpots) {
    const k = s.area ?? s.city ?? "unknown";
    byAreaMap[k] = (byAreaMap[k] ?? 0) + 1;
  }
  const spotCount = data.newSpots.length;
  const spotDetail = spotCount > 0
    ? ` — ${Object.entries(byAreaMap).map(([a, n]) => `${a}: ${n}`).join(" · ")}`
    : "";

  const lines = [
    `📊 Sam — ${dayName}`,
    ``,
    `Messages: ${totalMessages} (${data.waMessages} WA · ${data.webMessages} web)`,
    `Top intent: ${data.topIntent} × ${data.topIntentCount}`,
    `Cost: ${costStr}`,
    ``,
    `Contributions: ${data.contributions} new spot${data.contributions !== 1 ? "s" : ""}`,
    `Feedback: ${data.feedbacks} rating${data.feedbacks !== 1 ? "s" : ""} received`,
    `New spots in DB: ${spotCount}${spotDetail}`,
  ];

  if (data.reviewQueueCount > 0) {
    lines.push(`Review queue: ${data.reviewQueueCount} pending ⚠️`);
  }

  // Coaching status
  if (latestCoachRun) {
    const cr = latestCoachRun;
    const overallAvg = cr.avg_scores
      ? (Object.values(cr.avg_scores as Record<string, number>).reduce((a, b) => a + b, 0) /
          Object.keys(cr.avg_scores).length).toFixed(1)
      : null;

    let coachLine: string;
    if (cr.reverted) {
      coachLine = `⚠️ Self-coach reverted last change — scores dropped. Prompt restored.`;
    } else if (cr.change_applied) {
      const prevAvg = cr.prev_avg_scores
        ? (Object.values(cr.prev_avg_scores as Record<string, number>).reduce((a, b) => a + b, 0) /
            Object.keys(cr.prev_avg_scores).length).toFixed(1)
        : null;
      const trend = prevAvg && overallAvg ? `${prevAvg}→${overallAvg}/5` : overallAvg ? `${overallAvg}/5` : "";
      coachLine = `🧠 Self-coach: change deployed (${cr.conversations_analyzed} convos${trend ? ", " + trend : ""}). Live.`;
    } else if (cr.conversations_analyzed === 0) {
      coachLine = `🧠 Self-coach: skipped — not enough new convos.`;
    } else if (overallAvg) {
      coachLine = `🧠 Self-coach: all healthy (${overallAvg}/5). No changes.`;
    } else {
      coachLine = `🧠 Self-coach: ran, no changes.`;
    }

    lines.push(``, coachLine);
  }

  const text = lines.join("\n");

  await fetch(slackWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  trackEvent("system", "whatsapp", "daily_digest", { date: dateStr });
  console.log("[scheduler] Daily digest sent to Slack");
}

// ============================================
// P2.B — STALE SPOT RE-VERIFICATION
// ============================================

/** Ping original contributors for spots not verified in 180+ days (10am–12pm KL) */
async function maybeRunStalenessCheck(): Promise<void> {
  const now = new Date();
  const klHour = getKLHour(now);

  // Window: 10am–12pm KL
  if (klHour < 10 || klHour >= 12) return;
  if (await hasStalenessCheckRunToday()) return;

  const staleSpots = await getStaleSpotsForVerification(5);
  if (staleSpots.length === 0) return;

  // Record that we ran today before sending to prevent double-fire
  const ADMIN_PHONE = process.env.ADMIN_PHONE_NUMBER ?? "system";
  trackEvent(ADMIN_PHONE, "whatsapp", "staleness_check", {
    date: formatKLDate(now),
    count: staleSpots.length,
  });

  for (const spot of staleSpots) {
    const areaNote = spot.area ? ` (${spot.area})` : "";
    const message = `Hey! A quick check — you added *${spot.name}*${areaNote} a while back.\n\nStill accurate? Just reply "yes" or tell me if anything changed 🙏`;
    try {
      await sendMessage(spot.contributor_phone, message);
      await updateConversation(spot.contributor_phone, {
        current_flow: "spot_verification",
        flow_state: { stage: "awaiting_response", spotId: spot.id, spotName: spot.name },
      });
      console.log(`[scheduler] Staleness ping → ${spot.contributor_phone} for "${spot.name}"`);
    } catch (err) {
      console.error(`[scheduler] Staleness ping failed for spot ${spot.id}:`, err);
    }
  }
}

// ============================================
// BUG ALERTER
// ============================================

/** Fire Slack if error events cross alert thresholds in the last 5 minutes */
async function maybeAlertBugs(): Promise<void> {
  const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!slackWebhookUrl) return;

  const errors = await getRecentErrors(5);
  if (errors.length === 0) return;

  const now = Date.now();

  // Group process_crash events — any 1+ triggers an alert
  const crashes = errors.filter(e => e.event_data?.error_type === "process_crash");
  if (crashes.length > 0) {
    const key = "process_crash:webhook";
    const last = alertedAt.get(key) ?? 0;
    if (now - last > ALERT_COOLDOWN_MS) {
      alertedAt.set(key, now);
      const lines = crashes.map(e =>
        `  ${e.event_data.handler} | ${e.event_data.message}`
      );
      await fetch(slackWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `🚨 Sam bug — process_crash × ${crashes.length} (last 5 min)\n${lines.join("\n")}`,
        }),
      });
      console.log(`[scheduler] Bug alert: ${crashes.length} process_crash(es)`);
    }
  }

  // Group zero_results by city+categories — alert if 3+ for same combo
  const zeroResults = errors.filter(e => e.event_data?.error_type === "zero_results");
  const comboCounts = new Map<string, typeof zeroResults>();
  for (const e of zeroResults) {
    const ctx = e.event_data.context ?? {};
    const comboKey = `${ctx.city ?? "unknown"}:${(ctx.categories ?? []).join(",")}`;
    const group = comboCounts.get(comboKey) ?? [];
    group.push(e);
    comboCounts.set(comboKey, group);
  }

  for (const [comboKey, group] of comboCounts) {
    if (group.length < 3) continue;
    const alertKey = `zero_results:${comboKey}`;
    const last = alertedAt.get(alertKey) ?? 0;
    if (now - last > ALERT_COOLDOWN_MS) {
      alertedAt.set(alertKey, now);
      const sample = group[0].event_data;
      const ctx = sample.context ?? {};
      const detail = `${sample.handler} | city: ${ctx.city ?? "?"}, categories: ${(ctx.categories ?? []).join(", ")}${ctx.area ? `, area: ${ctx.area}` : ""}`;
      await fetch(slackWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: `🚨 Sam bug — zero_results × ${group.length} (last 5 min)\n  ${detail}`,
        }),
      });
      console.log(`[scheduler] Bug alert: ${group.length} zero_results for ${comboKey}`);
    }
  }
}

/** Pure function: determine if/what proactive message to send */
export function evaluateCandidate(
  candidate: CandidateInfo,
  now: Date
): ProactiveResult | null {
  // Gate 1: WhatsApp 24h window
  if (!candidate.last_user_message_at) return null;
  const lastMsg = new Date(candidate.last_user_message_at);
  const hoursSinceMsg = (now.getTime() - lastMsg.getTime()) / (1000 * 60 * 60);
  if (hoursSinceMsg > WHATSAPP_WINDOW_HOURS) return null;

  // Gate 2: Cooldown (8 hours since last proactive)
  if (candidate.last_proactive_at) {
    const lastProactive = new Date(candidate.last_proactive_at);
    const hoursSinceProactive =
      (now.getTime() - lastProactive.getTime()) / (1000 * 60 * 60);
    if (hoursSinceProactive < COOLDOWN_HOURS) return null;
  }

  // Gate 3: Flow safety — don't interrupt mid-flow
  if (candidate.current_flow !== "general") return null;

  // Gate 4: Active trip
  if (!candidate.trip_dates?.start || !candidate.trip_dates?.end) return null;
  const tripDay = calculateTripDay(candidate.trip_dates, now);
  const totalDays = calculateTotalDays(candidate.trip_dates);
  if (tripDay < 1 || tripDay > totalDays) return null;

  // Gate 5: Daytime only (8am-10pm KL time)
  const klHour = getKLHour(now);
  if (klHour < 8 || klHour >= 22) return null;

  const context = buildProactiveContext({
    name: candidate.name,
    tripDay,
    totalDays,
    travelParty: candidate.travel_party,
    dietaryRestrictions: candidate.dietary_restrictions,
    city: candidate.current_city ?? "Kuala Lumpur",
    klHour,
    preferences: candidate.preferences,
    spotsRecommendedCount: candidate.spots_recommended?.length ?? 0,
  });

  // Priority 1: TRIP_WELCOME — day 1, never proactively messaged
  if (tripDay === 1 && !candidate.last_proactive_at) {
    return { type: "TRIP_WELCOME", context };
  }

  // Priority 2: FEEDBACK_CHECK — has unasked spots, during check windows
  const hasUnaskedSpots =
    (candidate.spots_recommended?.length ?? 0) > 0 &&
    candidate.spots_recommended.some(
      (id) => !(candidate.spots_feedback_asked ?? []).includes(id)
    );
  if (hasUnaskedSpots && ((klHour >= 10 && klHour < 12) || (klHour >= 19 && klHour < 21))) {
    return { type: "FEEDBACK_CHECK", context };
  }

  // Priority 3: MORNING_NUDGE — day 2+, 8-10am
  if (tripDay >= 2 && klHour >= 8 && klHour < 10) {
    return { type: "MORNING_NUDGE", context };
  }

  // Priority 4: DINNER_NUDGE — day 2+, 5-7pm
  if (tripDay >= 2 && klHour >= 17 && klHour < 19) {
    return { type: "DINNER_NUDGE", context };
  }

  return null;
}

/** Build the context string passed to the LLM prompt */
export function buildProactiveContext(params: {
  name?: string;
  tripDay: number;
  totalDays: number;
  travelParty?: string;
  dietaryRestrictions?: string[];
  city: string;
  klHour: number;
  preferences?: Record<string, any>;
  spotsRecommendedCount?: number;
  recentMessages?: string;
}): string {
  const lines: string[] = [];
  if (params.name) lines.push(`Name: ${params.name}`);
  lines.push(`City: ${params.city}`);
  lines.push(`Trip day: ${params.tripDay} of ${params.totalDays}`);
  lines.push(`Local time: ~${params.klHour}:00`);
  if (params.travelParty) lines.push(`Travel party: ${params.travelParty}`);
  if (params.dietaryRestrictions?.length) {
    lines.push(`Dietary restrictions: ${params.dietaryRestrictions.join(", ")}`);
  }
  // Traveler preferences — used for personalized nudges
  const prefs = params.preferences ?? {};
  if (prefs.budget) lines.push(`Budget style: ${prefs.budget}`);
  if (prefs.interests?.length) lines.push(`Interests: ${(prefs.interests as string[]).join(", ")}`);
  if (prefs.pace) lines.push(`Pace: ${prefs.pace}`);
  if (params.spotsRecommendedCount != null) {
    lines.push(`Spots recommended so far this trip: ${params.spotsRecommendedCount}`);
  }
  if (params.recentMessages) {
    lines.push(`\nRecent conversation (last few messages):\n${params.recentMessages}`);
  }
  return lines.join("\n");
}

/** Calculate which day of the trip it is (1-indexed) */
export function calculateTripDay(
  tripDates: { start: string; end: string },
  now: Date
): number {
  const start = toKLMidnight(tripDates.start);
  const today = toKLMidnight(formatKLDate(now));
  const diffMs = today.getTime() - start.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
}

/** Calculate total trip length in days */
export function calculateTotalDays(tripDates: {
  start: string;
  end: string;
}): number {
  const start = toKLMidnight(tripDates.start);
  const end = toKLMidnight(tripDates.end);
  const diffMs = end.getTime() - start.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
}

/** Send the proactive message */
async function sendProactiveMessage(
  traveler: Traveler & { current_flow: string; last_user_message_at?: string },
  result: ProactiveResult
): Promise<void> {
  const phone = traveler.whatsapp_number;

  if (result.type === "FEEDBACK_CHECK") {
    // Delegate to existing feedback flow
    const spots = await getSpotsNeedingFeedback(phone);
    if (spots.length === 0) return;

    const message = await startFeedbackCollection(phone);
    await sendMessage(phone, message);
    await markFeedbackAsked(phone, spots.map((s) => s.id));
    return;
  }

  // Fetch recent conversation context for personalization (last 3 messages)
  let recentMessages = "";
  try {
    const convo = await getOrCreateConversation(phone);
    const lastMsgs = (convo.messages ?? []).slice(-3);
    if (lastMsgs.length > 0) {
      recentMessages = lastMsgs
        .map(m => `${m.role === "user" ? "Traveler" : "Sam"}: ${m.content.slice(0, 120)}`)
        .join("\n");
    }
  } catch {
    // Non-fatal — proceed without conversation context
  }

  // Re-build context with recent messages included
  const tripDates = traveler.trip_dates;
  const tripDay = tripDates ? calculateTripDay(tripDates, new Date()) : 1;
  const totalDays = tripDates ? calculateTotalDays(tripDates) : 1;
  const klHour = getKLHour(new Date());
  const enrichedContext = buildProactiveContext({
    name: (traveler as any).name,
    tripDay,
    totalDays,
    travelParty: traveler.travel_party,
    dietaryRestrictions: traveler.dietary_restrictions,
    city: traveler.current_city ?? "Kuala Lumpur",
    klHour,
    preferences: traveler.preferences,
    spotsRecommendedCount: traveler.spots_recommended?.length ?? 0,
    recentMessages: recentMessages || undefined,
  });

  // LLM-generated message
  // MORNING_NUDGE: use forecast so Sam can hint at afternoon weather
  let weatherLine = "";
  if (result.type === "MORNING_NUDGE") {
    const { getDayForecast } = await import("./weather.js");
    const forecast = await getDayForecast(traveler.current_city).catch(() => null);
    if (forecast) {
      weatherLine = `\nWeather today: ${forecast.summary} Best outdoor window: ${forecast.best_window}.`;
    } else {
      const weather = await getCurrentWeather(traveler.current_city).catch(() => null);
      if (weather) weatherLine = `\nWeather: ${weather.summary}`;
    }
  } else {
    const weather = await getCurrentWeather(traveler.current_city).catch(() => null);
    if (weather) weatherLine = `\nWeather: ${weather.summary}`;
  }

  const prompt = PROACTIVE_PROMPT
    .replace("{{MESSAGE_TYPE}}", result.type)
    .replace("{{CONTEXT}}", enrichedContext + weatherLine);

  const message = await chat(prompt, [{ role: "user", content: "Generate the proactive message." }], {
    temperature: 0.8,
    model: HAIKU,
    maxTokens: 256,
  });

  await sendMessage(phone, message);
}

// ============================================
// HELPERS
// ============================================

function getKLHour(now: Date): number {
  const utcHour = now.getUTCHours();
  return (utcHour + KL_OFFSET_HOURS) % 24;
}

function getKLMinute(now: Date): number {
  return new Date(now.getTime() + KL_OFFSET_HOURS * 60 * 60 * 1000).getUTCMinutes();
}

/** Convert a date string (YYYY-MM-DD) to a Date at midnight KL time */
function toKLMidnight(dateStr: string): Date {
  // Parse as UTC midnight, then adjust for KL offset
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
}

/** Format a Date as a YYYY-MM-DD string in KL timezone */
function formatKLDate(now: Date): string {
  const klTime = new Date(now.getTime() + KL_OFFSET_HOURS * 60 * 60 * 1000);
  return klTime.toISOString().split("T")[0];
}
