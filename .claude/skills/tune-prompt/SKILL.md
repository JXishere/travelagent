---
description: Iterate on a Sam prompt file with test scenarios
argument: Prompt name (e.g. "system", "extraction", "profile", "strategic")
allowed-tools: Read, Edit, Bash
---

# /tune-prompt — Iterate on a Prompt

You are a prompt engineer improving Sam's prompts.

## Input

Prompt to tune: `$ARGUMENTS`

The prompt file is at `src/prompts/$ARGUMENTS.txt`.

## Process

### 1. Read Current Prompt

Read the prompt file and understand its purpose:
- `system.txt` — Sam's personality, core rules, response formatting
- `extraction.txt` — Voice note transcription → structured JSON extraction
- `profile.txt` — Conversational trip profile learning
- `continuous_profile.txt` — Background profile extraction from every message
- `strategic.txt` — Pre-trip strategic planning format
- `generate.txt` — Spot content generation prompt (admin)

Also read `src/llm.ts` to understand how the prompt is used (temperature, max tokens, expected output format).

### 2. Define Test Scenarios

Create 3-5 test scenarios appropriate for the prompt:

**For system.txt:**
- "I'm hungry, near Bangsar" (with 3 matching spots as context)
- "What should I do today?" (with traveler profile as context)
- "Is KL safe?" (general question, no spots needed)
- "Thanks that was amazing" (feedback/casual)

**For extraction.txt:**
- A detailed voice note transcript with clear spot details
- A messy transcript with partial info and filler words
- A transcript mentioning multiple spots

**For profile.txt:**
- "We're coming to KL next month, couple, first time"
- "I was there last year, coming back for the food"
- "Just me, 3 days, on a budget"

**For strategic.txt:**
- Complete profile (dates, party, interests, budget)
- Minimal profile (just dates)
- Specific requests ("want to see Batu Caves")

### 3. Run Tests

For each scenario, run the prompt through Claude using Bash:
```bash
# Use the Anthropic API directly via curl or a quick script
npx tsx -e "
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
const client = new Anthropic();
const prompt = readFileSync('src/prompts/$ARGUMENTS.txt', 'utf-8');
const res = await client.messages.create({
  model: 'claude-sonnet-4-5-20250929',
  max_tokens: 1024,
  system: prompt,
  messages: [{ role: 'user', content: '<TEST_INPUT>' }],
  temperature: 0.7
});
console.log(res.content[0].text);
"
```

### 4. Evaluate Outputs

For each test output, check:
- **Conciseness**: Short enough for WhatsApp? No walls of text?
- **Operational detail**: Includes what to order, hours, tips, payment?
- **No hallucination**: Only references data provided in context, doesn't invent spots?
- **Personality**: Sounds like Sam (warm, opinionated, irreverent) not a search engine?
- **Format**: Appropriate use of line breaks, emojis (sparingly), structure?

### 5. Show Results

Display all test outputs side-by-side with evaluation notes.

### 6. Suggest & Apply Improvements

If improvements are needed:
- Explain what's wrong and why
- Show the specific prompt changes
- Ask the user for approval before editing
- Apply changes with the Edit tool
- Re-run the worst-performing test to verify improvement

## Quality Criteria

Sam's prompts should produce responses that are:
1. **Concise** — 2-4 short paragraphs max for WhatsApp
2. **Operationally rich** — real details, not vibes
3. **Honest** — never fabricate, say "I don't know" when appropriate
4. **Personality-forward** — Sam is a friend, not a chatbot
5. **Actionable** — the reader can act on the recommendation immediately
