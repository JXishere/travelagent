# SKILLS.md — Claude Code Skills Reference

Sam has 8 Claude Code skills (slash commands) that automate common engineering and content workflows. Skills are defined in `.claude/skills/` and invoked via Claude Code.

---

## Quick Reference

| Skill | What it does | Key args |
|---|---|---|
| `/add-spot` | Research and add a spot to the knowledge graph | Spot name + optional city |
| `/analytics` | Query the `events` table for usage analytics | `today` \| `week` \| `funnel` \| `cities` \| `contributors` |
| `/city` | Expand to a new city or audit coverage | `add <City>` \| `audit <City>` \| `list` |
| `/db` | Natural language database queries | Free-text (e.g. "spots in Bangsar") |
| `/deploy` | Build, type-check, and deploy to Railway | (no args) |
| `/eval` | Run scenario evaluation suite | `--intent <intent>`, `--fast` |
| `/test-convo` | Live conversation testing with real API calls | Test scenario or message |
| `/tune-prompt` | Iterate on a prompt file with test scenarios | Prompt name (e.g. `system`) |

---

## `/add-spot`

**Definition**: `.claude/skills/add-spot/`

Research a spot from the web and insert it into the Supabase knowledge graph. Also appends to the appropriate city seed file for future re-seeds.

```
/add-spot Restoran Nasi Kandar Line Clear, Penang
/add-spot Fatty Crab, Taman Megah
/add-spot Fatt Kee Roast Meat, KL
```

**Process**: Web research → duplicate check → structure to schema → insert to DB + append to seed file.

**Quality standards**: Never fabricates. If hours or payment info can't be found, marks as unknown. Requires `name`, `area`, `category` at minimum.

---

## `/analytics`

**Definition**: `.claude/skills/analytics/`

Pre-baked SQL queries against the `events` table. Uses Supabase MCP (or falls back to `npx tsx`).

```
/analytics today
/analytics week
/analytics funnel
/analytics cities
/analytics contributors
```

| Shortcut | Returns |
|---|---|
| `today` | Intents by count, unique sessions, channel split, new users |
| `week` | 7-day rolling: messages/day, sessions/day, top intents |
| `funnel` | Contribution funnel: started → confirmed → saved (drop-off %) |
| `cities` | Spot use_count by city, total recommendations served |
| `contributors` | Top 10 contributors by spots_contributed |

---

## `/city`

**Definition**: `.claude/skills/city/`

City management: coverage audits and new city scaffolding. See `CITY-GUIDE.md` for the full step-by-step on adding a city.

```
/city list
/city audit Kuala Lumpur
/city add Bangkok
```

- **`list`**: Shows all cities with spot counts and embedding coverage %
- **`audit <City>`**: Category breakdown, tier distribution, data quality signals (embeddings %, recently verified %, field coverage)
- **`add <City>`**: Adds entry to `city-defaults.ts` + creates seed stub

---

## `/db`

**Definition**: `.claude/skills/db/`

Natural language → SQL. Translates queries, runs via Supabase MCP, returns markdown tables.

```
/db spots in Bangsar
/db count by category
/db stats
/db tier 1 dinner spots
/db travelers who have visited KL
```

The `stats` shortcut runs a full summary: total spots, by category, by area, by tier, traveler count, contributor count.

**Fallback**: If Supabase MCP is unavailable, uses `npx tsx --env-file .env.local` with the JS client.

---

## `/deploy`

**Definition**: `.claude/skills/deploy/`

Build → type-check → deploy to Railway → verify health.

```
/deploy
```

**Steps**:
1. `npx tsc --noEmit` — stop on type errors
2. `git status` — offer to commit if there are changes
3. Deploy via Railway MCP or `railway up`
4. Hit `/health` to verify the deployed service is responding

Requires Railway CLI (`npm install -g @railway/cli`) or Railway MCP to be configured.

---

## `/eval`

**Definition**: `.claude/skills/eval/`

Run the scenario evaluation suite against the live web endpoint. Requires `npm run dev:web` running on `:3001`.

```
/eval
/eval --intent hungry
/eval --scenario birthday_dinner
/eval --fast
```

**How it works**: Sends real messages to `POST /api/chat`, then uses Claude Sonnet as an LLM judge to score routing correctness, response quality, and hallucination risk.

**Output**: Pass/fail/warn table grouped by intent. On failure, identifies the responsible handler or prompt file.

**`--fast` mode**: Skips LLM judge — shows raw Sam responses only. Useful for quick smoke tests.

Scenarios are defined in `scripts/conversation-scenarios.ts`. See `TESTING.md` for how to add new scenarios.

---

## `/test-convo`

**Definition**: `.claude/skills/test-convo/`

Send real messages to Sam via `POST /api/chat` and analyze responses. Used for debugging specific conversation flows. Requires `npm run dev:web` on `:3001`.

```
/test-convo hungry near Bangsar
/test-convo birthday dinner japanese food
/test-convo multi-turn profile then food request
```

**Process**:
1. Designs 2–5 test messages covering the scenario + edge cases
2. Sends each message via the SSE API, captures responses
3. Evaluates: intent correctness, data quality (real DB spots vs fabricated), response quality, flow continuity
4. For failures: reads source files, identifies root cause, makes fixes, re-runs

**Default tests** (run with no arguments): birthday dinner scenario, follow-up area clarification, trip planning profile start, ramen near Bangsar, spot contribution trigger.

---

## `/tune-prompt`

**Definition**: `.claude/skills/tune-prompt/`

Iterative prompt improvement. Runs test scenarios through the current prompt, evaluates outputs, suggests changes, applies on approval.

```
/tune-prompt system
/tune-prompt extraction
/tune-prompt profile
/tune-prompt strategic
```

**Prompt files**:
| Name | File | Purpose |
|---|---|---|
| `system` | `packages/bot/src/prompts/system.txt` | Sam's personality + core rules |
| `extraction` | `packages/bot/src/prompts/extraction.txt` | Voice note → JSON |
| `profile` | `packages/bot/src/prompts/profile.txt` | Conversational profile learning |
| `continuous_profile` | `packages/bot/src/prompts/continuous_profile.txt` | Background profile extraction |
| `strategic` | `packages/bot/src/prompts/strategic.txt` | Pre-trip planning format |
| `generate` | `packages/bot/src/prompts/generate.txt` | Admin spot content generation |
| `coach` | `packages/bot/src/prompts/coach.txt` | Coaching evaluation criteria |

**Quality criteria**: Concise (phone-readable), operationally rich (what to order / hours / tips), no hallucination, Sam's voice (warm + opinionated), actionable.

---

## Skill file format

Each skill is a directory in `.claude/skills/<name>/` containing a markdown file with YAML frontmatter:

```markdown
---
description: Short description shown in skill picker
argument: What $ARGUMENTS contains
allowed-tools: Read, Edit, Write, Bash, WebSearch, ...
---

# /skill-name — Title

Full prompt instructions...
```

The `$ARGUMENTS` placeholder is substituted with whatever the user typed after the slash command.
