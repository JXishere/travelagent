# Paul — Local Knowledge + Online Data & PoC Notes

**February 2026**

---

## The Core Thesis Shift

Paul is not just a relay for local tips. Paul is not just an AI searching the internet. Paul is the thing in between — a friend who heard something from someone who knows, checked it out himself, and is now telling you with conviction.

The value proposition is the **synthesis** of contributor knowledge + online data + a judgment layer on top. Nobody else is doing this specific combination.

---

## The Trust Stack

A single recommendation gains confidence through layers:

1. **One local says it's good** → Paul knows about it
2. **One local explains why** → Paul can recommend with reasoning
3. **Multiple locals vouch for it** → Paul recommends with conviction
4. **Online data supports it** → Paul's confidence is highest
5. **Online data contradicts it** → Two scenarios:
   - Locals are right, internet hasn't caught up → **hidden gem signal** — this is Paul's sweet spot
   - Recent online data shows something changed (closed, ownership change, health issues) → confidence drops

The contradiction case is Paul's most valuable moment. High local consensus + low online visibility = exactly the kind of place Paul exists to surface.

---

## Confidence Score — Internal, Not User-Facing

The score never surfaces as a number. It shapes Paul's tone:

- **High confidence:** "go to this place. trust me. get the dry version."
- **Medium confidence:** "i've heard good things about this spot, haven't been myself but a couple people i trust swear by it"
- **Low confidence:** "there's this place that might be worth checking out, let me know how it is if you go"

Paul sounds more sure about some things than others — like a real person. This becomes a logic layer that evolves over time and shapes recommendation priority.

---

## The Feedback Loop

1. Contributor shares knowledge → Paul processes and scores internally
2. Paul recommends to traveler with tone matching confidence level
3. Paul asks traveler "how was it?"
4. Traveler feedback adjusts confidence — confirms or downgrades
5. Over time, Paul learns which contributors are consistently reliable

Paul doesn't just relay knowledge. He develops judgment.

---

## PoC Approach — Be Paul Manually

**Don't introduce Paul yet. Don't build anything. You are Paul right now.**

### The Question

> "You have one friend visiting your city for the first time. They text you: where should I eat tonight? What do you tell them — and why that place specifically?"

Send to 15-20 people over WhatsApp. Don't explain you're building something. Just ask like you're genuinely curious.

### The Follow-Up (When Needed)

If someone gives a surface-level answer, one nudge: ask for the location and why it's good. That follow-up is what pulls out the gold.

### What You're Proving

1. People will share usable local knowledge when asked casually over WhatsApp
2. The raw responses contain information Google doesn't have
3. Contributors naturally ask qualifying questions before recommending — validating the conditional knowledge model

---

## Early Findings

### The BKT Response — Gold

One contributor gave unprompted:

- **Specific place** — Sheng Huat BKT Yip + Google Maps pin
- **What makes it special** — dark soup style, thick broth
- **Time constraint** — arrive by 7:30-8pm, sold out by 9pm
- **Operational hack** — can call/WhatsApp to pre-order
- **Social context** — if group is big enough, can order 一枝骨 (whole rib bone)

The 一枝骨 tip is the kind of thing Google will never surface — a menu option unlocked by group size. This is Paul's value layer.

**Key insight:** Gold came after one casual follow-up question. The first response was probably just the name. The reasoning, timing, and hacks came from the nudge.

### The Qualifier Responses

Multiple contributors responded with questions before recommending:

- "Is your friend guai lou? Chinese?"
- "You want halal or non halal food?"

**This is more valuable than it looks.** These people instinctively know the right recommendation depends on context. They won't give an answer until they understand the situation. They're naturally doing what Paul is designed to do — ask before answering.

### What This Means for the Schema

Knowledge isn't just "place + why it's good." It's **"place + why it's good + for whom."** Conditional dimensions include:

- Dietary requirements (halal, vegetarian, pork)
- Cultural background (local Chinese, Malay, Western tourist)
- Language ability (can they order in dialect or English only)
- Group composition (solo, couple, big group)
- Time and context (late night, business dinner, casual)

Contributors already think this way. The schema needs to capture it.

---

## Tagging Responses

As results come in, categorize each:

| Category | Description | Implication |
|---|---|---|
| **Unprompted gold** | Specific place, reasoning, operational details without follow-up | Best future contributors |
| **Gold after one nudge** | Needed the "why" follow-up to open up | Largest group — Paul's follow-up question is essential |
| **Qualifier first** | Asked context questions before recommending | Power contributors — think like Paul already |
| **Vague and stayed vague** | Generic even after follow-up | Shows % of people Paul can't extract from |

---

## The Reframe — Introducing Paul Later

Once 15-20 responses are collected:

> "Remember when I asked you where to send a friend for food? I'm building something that does exactly that conversation — but at scale. You already contributed to it. Want to see how it works?"

Contributors feel ownership because their knowledge is already inside Paul.

---

## Watch For

- **CJ's coffee/F&B network** may give naturally richer responses because F&B people are trained to articulate why something is good. If his responses are noticeably better, F&B professionals may be Paul's ideal contributor profile — not just "anyone who lives in a city."
- **Signal-to-noise ratio** across all responses determines how hard Paul's intake AI actually needs to work.

---

## Open Questions

- How does Paul bootstrap in a new city with one contributor and zero traveler feedback? Confidence on everything would be low.
- Does Paul ask qualifying questions during contributor intake, or only on the traveler side?
- How is the confidence scoring system actually weighted? What inputs matter most?
- At what point does the online data validation layer get built vs. staying manual?

---

*Status: PoC in progress. 10+ people contacted. Waiting on responses from JX's network and CJ's network.*
