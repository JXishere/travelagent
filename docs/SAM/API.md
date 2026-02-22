# API.md — Endpoints Reference

Sam exposes two sets of endpoints: the **WhatsApp webhook** (Express, port 3000) and the **web API** (Next.js, port 3001).

---

## WhatsApp Bot (Express :3000)

### `GET /webhook` — Webhook verification

Used by Meta to verify your webhook URL is real. Only called once during setup.

**Query params** (set by Meta):
- `hub.mode` — always `subscribe`
- `hub.verify_token` — must match `WHATSAPP_VERIFY_TOKEN` env var
- `hub.challenge` — random string Meta expects echoed back

**Response**: `200 <challenge>` on success, `403` if token mismatch.

---

### `POST /webhook` — Incoming WhatsApp messages

Receives all WhatsApp events (messages, read receipts, status updates).

**Request body**: Meta Cloud API webhook payload (JSON). The bot extracts messages via `parseWebhook()`.

**Response**: Always `200` immediately (Meta retries if it doesn't get 200 within ~5s). Message processing happens asynchronously after the response is sent.

**Message types handled**:
- `text` — routed through intent classifier → handler
- `audio` — transcribed via Whisper, then contribution flow
- `image` — caption treated as text if present; otherwise acknowledged
- `location` — routed directly to `handleNearby()`

**Flow**: `parseWebhook()` → `showTyping()` → `processMessage()` → `classifyIntent()` → handler → `sendMessage()`

**Admin shortcuts** (only for `ADMIN_PHONE_NUMBER`):
- Message starting with `add:` → rapid spot ingestion via `extractJSON()`
- Message starting with `/generate` → `startGenerate()` handler

---

### `GET /health` — Health check

```json
{ "status": "ok", "service": "sam-bot", "city": "Kuala Lumpur" }
```

Used by Railway to verify the service is running.

---

## Web API (Next.js :3001)

### `GET /api/chat` — Load conversation history

Returns stored messages for a session.

**Query params**:
- `sessionId` (required) — browser-generated session identifier

**Response**:
```json
{ "messages": [{ "role": "user", "content": "..." }, ...] }
```

Returns `{ "messages": [] }` if session doesn't exist yet (no error).

---

### `POST /api/chat` — Send a message (SSE stream)

Main chat endpoint. Classifies intent, calls the appropriate handler, streams the response as Server-Sent Events.

**Request body**:
```json
{
  "sessionId": "string",       // required — browser session ID
  "message": "string",         // required (unless initFlow is set)
  "initFlow": "contribution"   // optional — initialize a flow without a message
}
```

**`initFlow` mode**: Sets `current_flow` in the conversation without processing a message. Used by the web UI's "Tell Sam" button to pre-initialize the contribution flow.

**Rate limiting**: 20 messages/day per IP (in-memory, resets daily). Localhost is exempt. Returns `429` with a Sam-voiced error message when exceeded.

**Response**: `text/event-stream` (SSE)

**SSE format**:
```
data: {"text": "chunk of response text"}\n\n
data: {"text": "more text"}\n\n
data: [DONE]\n\n
```

**On error**:
```
data: {"error": "Stream error"}\n\n
```

**Headers on success**:
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-RateLimit-Remaining: 17   (remaining messages today)
```

**On rate limit** (`429`):
```json
{
  "error": "You've hit your 20 messages for today...",
  "remaining": 0
}
```

---

## Intent routing

Both the WhatsApp webhook and the web chat route through `classifyIntent()` before dispatching to handlers. The intent determines which handler runs and whether the response is streamed.

| Intent | Handler | Streamed (web)? |
|---|---|---|
| `hungry` | `handleHungry()` | Yes |
| `day_plan` | `handleDayPlan()` | Yes |
| `nearby` | `handleNearby()` | Yes |
| `weather` | inline weather + `chat()` | Yes |
| `spot_info` | `handleSpotInfo()` | Yes (single chunk) |
| `general` | `chatAsSamStream()` | Yes |
| `contribute` | `handleContribution()` | No (multi-turn) |
| `profile` | `startProfileLearning()` | No (multi-turn) |
| `feedback` | `startFeedbackCollection()` | No (multi-turn) |
| `spot_correction` | `handleSpotCorrection()` | No |

Multi-turn intents enter a `current_flow` state in the `conversations` table and subsequent messages are routed to the same handler until the flow completes or the user sends `cancel` / `stop`.

---

## Consuming the SSE stream (JavaScript)

```javascript
const sessionId = crypto.randomUUID();

const response = await fetch("/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ sessionId, message: "hungry near Bangsar" }),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split("\n\n");
  buffer = lines.pop() ?? "";

  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6);
    if (payload === "[DONE]") break;
    const { text } = JSON.parse(payload);
    process.stdout.write(text); // or append to UI
  }
}
```

---

## Web UI routes

| Route | Component | What it does |
|---|---|---|
| `/` | `page.tsx` + `home-client.tsx` | Landing page with prompt input and live feed |
| `/chat` | `chat/page.tsx` + `chat-panel.tsx` | Full chat interface |
| `/review` | `review/page.tsx` + `spot-card.tsx` | Admin: browse, edit, approve, delete spots |

---

## Extract endpoint

### `POST /api/extract` — Text → structured spot fields

Used by the web contribution flow to extract spot data from free-text input before the user confirms.

**Request**: `{ "text": "Fatty Crab in Taman Megah, cash only, best for dinner..." }`

**Response**: JSON object with extracted spot fields (name, area, category, etc.).

This mirrors the `extractJSON("extraction", ...)` call used in the WhatsApp contribution flow.

---

## Enrich endpoint

### `POST /api/enrich-spot` — Web search → missing spot fields

Used by the web contribution flow to fill operational fields (address, hours, price, payment) from a live web search before the contributor confirms.

**Request**: `{ "name": "Fatty Crab", "area": "Taman Megah", "city": "Kuala Lumpur" }`

**Response**: JSON object with any fields found from web search. Web-sourced fields are annotated in the UI and stripped before DB save — only contributor-confirmed data is persisted.

This mirrors the `enrichFromWeb()` call used in the WhatsApp contribution flow's collecting stage.
