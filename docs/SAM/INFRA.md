# INFRA.md — Infrastructure & Deployment Reference

Sam runs as two services: a **WhatsApp bot** (Express on port 3000) and a **web frontend** (Next.js on port 3001). Both share the same codebase via npm workspaces.

---

## Environment Variables

Single `.env.local` at the repo root, shared by both packages. Copy `.env.example` to get started.

| Variable | Used by | Purpose |
|---|---|---|
| `WHATSAPP_TOKEN` | bot | Meta Cloud API bearer token |
| `WHATSAPP_VERIFY_TOKEN` | bot | Webhook verification secret (you choose this) |
| `WHATSAPP_PHONE_NUMBER_ID` | bot | The phone number ID from Meta developer console |
| `SUPABASE_URL` | both | `https://<project>.supabase.co` |
| `SUPABASE_KEY` | both | Service role key (full DB access) |
| `ANTHROPIC_API_KEY` | both | Claude API key |
| `OPENAI_API_KEY` | both | Whisper transcription + pgvector embeddings |
| `OPENWEATHER_API_KEY` | bot | Live weather context |
| `PORT` | bot | Express listen port (default: 3000) |
| `NEXT_PUBLIC_DEFAULT_CITY` | web | City shown on landing page (default: `Kuala Lumpur`) |
| `ADMIN_PHONE_NUMBER` | bot | WhatsApp number with admin commands (`add:`, `/generate`) |

> **Security note**: `SUPABASE_KEY` is the service role key (bypasses RLS). Never expose it client-side.

---

## Local Development

```bash
# Install all dependencies (run from repo root)
npm install

# Start the bot (Express :3000)
npm run dev

# Start the web frontend (Next.js :3001)
npm run dev:web

# Run both together with separate terminals
# Terminal 1: npm run dev
# Terminal 2: npm run dev:web
```

The bot watches for changes via `tsx watch`. The web frontend uses Next.js fast refresh.

---

## WhatsApp Webhook Setup

WhatsApp Cloud API requires a **publicly accessible HTTPS URL** for the webhook. During local development, use a tunnel:

```bash
# Option A: ngrok (most common)
ngrok http 3000
# Gives you: https://abc123.ngrok.io

# Option B: cloudflared tunnel
cloudflare tunnel --url http://localhost:3000
```

Then in the Meta Developer Console:
1. Go to **WhatsApp → Configuration → Webhook**
2. Set **Callback URL**: `https://your-tunnel.ngrok.io/webhook`
3. Set **Verify Token**: same value as `WHATSAPP_VERIFY_TOKEN` in `.env.local`
4. Subscribe to: **messages** (under Webhook Fields)

The bot handles webhook verification automatically at `GET /webhook` — it checks `hub.verify_token` against the env var and returns the challenge.

---

## Deployment (Railway)

Sam is deployed on [Railway](https://railway.app) as two separate services in the `fortunate-friendship` project.

| Service | Railway name | URL |
|---|---|---|
| Bot (`@sam/bot`) | `@sam/bot` | `https://sambot-production-6ab1.up.railway.app` |
| Web (`@sam/web`) | `@sam/web` | See Railway dashboard |

Use the `/deploy` skill for the full flow, or do it manually:

### Manual deploy steps

```bash
# 1. Type check (don't deploy broken code)
npx tsc --noEmit

# 2. Build bot (verify clean compile before pushing)
npm run build:bot

# 3. Push to Railway
railway up --service "@sam/bot"

# 4. Verify health
curl https://sambot-production-6ab1.up.railway.app/health
```

Railway detects the Node.js app automatically. It runs `npm start` which compiles and starts the Express server.

### Railway environment variables

Set all `.env.local` values in Railway's **Variables** tab for each service. Railway injects them at runtime — no `.env` file is deployed.

### Webhook URL after deploy

The permanent WhatsApp webhook URL is:
- `https://sambot-production-6ab1.up.railway.app/webhook`

---

## Service Architecture

```
Meta / WhatsApp Cloud API
         │
         ▼ POST /webhook (HTTPS required)
    Express :3000  ──────────────────► Supabase (DB)
         │                              Claude API (LLM)
         │                              OpenAI (Whisper / embeddings)
         │                              OpenWeather (weather context)
         ▼
    Background scheduler (5-min interval)
    Proactive messages → WhatsApp Cloud API


Browser
    │
    ▼ POST /api/chat (SSE stream)
  Next.js :3001
    │  imports @sam/bot directly (no HTTP hop)
    ▼
  Same handlers as WhatsApp bot
```

The web package imports `@sam/bot` directly via the npm workspace dependency — there's no HTTP indirection between Next.js and the bot logic.

---

## Health Check

```bash
GET /health
# → { "status": "ok", "service": "sam-bot", "city": "Kuala Lumpur" }
```

Use this to verify the bot is running before testing webhooks.

---

## Build

```bash
npm run build       # Build both packages
npm run build:bot   # Bot only (TypeScript → dist/)
npm run build:web   # Web only (Next.js → .next/)
```

The bot compiles to `packages/bot/dist/`. The `npm start` command runs the compiled output.

---

## Database (Supabase)

- Hosted on Supabase (managed PostgreSQL + pgvector)
- Migrations live in `supabase/migrations/` — apply via Supabase dashboard or CLI
- See `SCHEMA.md` for the full data model

```bash
# Apply a migration via Supabase CLI (if configured)
supabase db push

# Or apply manually in Supabase SQL editor
```

---

## Common Issues

| Problem | Fix |
|---|---|
| Webhook verification fails (403) | `WHATSAPP_VERIFY_TOKEN` mismatch — check the value set in Meta console matches `.env.local` |
| Bot doesn't respond to messages | Check webhook is subscribed to the `messages` field in Meta console |
| "Cannot find module @sam/bot" | Run `npm install` from repo root to link workspace packages |
| Type errors on build | Run `npx tsc --noEmit` to see all errors before pushing |
| Supabase connection error | Verify `SUPABASE_URL` and `SUPABASE_KEY` are set correctly |
| Rate limit on web chat | Web chat caps at 20 messages/day per IP; localhost is exempt |
