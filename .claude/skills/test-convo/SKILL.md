---
description: Simulate a WhatsApp conversation flow locally without a live server
argument: Scenario description (e.g. "hungry near Bangsar", "new user first message")
context: fork
agent: general-purpose
allowed-tools: Read, Grep, Bash
---

# /test-convo — Simulate a WhatsApp Conversation

You are testing Sam's conversation flow by tracing through the code logic without running a live server.

## Input

Test scenario: `$ARGUMENTS`

## Process

### 1. Read the Codebase

Read these files to understand the full flow:
- `src/index.ts` — message routing and flow logic
- `src/llm.ts` — intent classification and chat functions
- `src/database.ts` — DB query patterns
- `src/handlers/` — all handler files (query.ts, ontrip.ts, profile.ts, continuous-profile.ts, strategic.ts, contribution.ts, feedback.ts, generate.ts)
- `src/prompts/` — all prompt files (system.txt, extraction.txt, profile.txt, continuous_profile.txt, strategic.txt, generate.txt)

### 2. Simulate the Flow

Trace exactly what would happen for the test scenario:

**Step 1: Intent Classification**
- What would `classifyIntent()` return for this message?
- Show the intent and extracted details

**Step 2: Flow Routing**
- Which handler gets called based on the intent?
- Is there an existing `current_flow` that would override?

**Step 3: Database Query**
- What query would `database.ts` run?
- Based on the seed data in `src/seed.ts`, what spots would match?
- List the matching spots with their key details

**Step 4: LLM Response**
- Which prompt file is loaded?
- What context is sent to Claude (system prompt + user message + spot data)?
- What would the response structure look like?

**Step 5: WhatsApp Message**
- What would actually be sent back to the user?
- Is it concise enough for WhatsApp?

### 3. Report

Output a structured report:

```
## Simulation: [scenario]

### Intent Classification
- Intent: [intent]
- Details: [extracted details]

### Flow
- Handler: [file:function]
- Current flow state: [flow]

### Database Query
- Query: [what gets queried]
- Matching spots: [list with key details]

### Response
- Prompt used: [prompt file]
- Expected response: [simulated response text]

### Issues Found
- [any problems: missing data, wrong flow, poor formatting, etc.]
```

## Edge Cases to Consider

- What if no spots match the query?
- What if the user is in the middle of another flow?
- What if the message is ambiguous (could be multiple intents)?
- Is the response appropriately concise for WhatsApp?
- Does the response include operational details (hours, tips, what to order)?
