# Spot Review Guide

How to use the `/review` UI to curate the knowledge graph.

---

## Getting There

- **Local**: `npm run dev:web` → `http://localhost:3001/review`
- **Production**: Railway web service URL → `/review`

No login required — the route is public but unlinked from the landing page.

---

## Reading the Header

At the top you'll see a stats line:

```
739 total · 312 approved · 5 needs review · 84 thin · dinner 280 · lunch 210 · ...
```

| Stat | Meaning |
|------|---------|
| **approved** | Spots marked `verified` — safe to recommend with confidence |
| **needs review** (red) | New contributions that haven't been published yet |
| **thin** | No `what_to_order` AND no `pro_tips` — Sam can surface these but can't give useful detail |

Start with **needs review**, then work through **thin** spots.

---

## The Confidence Dot

Every spot name has a coloured dot:

| Colour | Score | What it means |
|--------|-------|---------------|
| 🟢 Green | ≥ 75 | High quality — likely safe to verify without reading every field |
| 🟡 Yellow | 40–74 | Moderate — worth expanding to check what's missing |
| 🔴 Red | < 40 | Low quality — thin data, missing fields, or unverified seed |
| — (none) | null | Score hasn't been calculated yet |

---

## The Review Workflow

### Step 1 — Clear the needs-review queue

Filter: no filter needed — `needs review` spots show a red tag in the list.

For each flagged spot:
1. Click to expand
2. Check: does the name, area, and category look right?
3. Read `what_to_order` and `pro_tips` — does it sound like real local knowledge?
4. If good → **Publish** (makes it live in recommendations)
5. If junk or duplicate → **Delete**

### Step 2 — Verify high-confidence spots

Filter: leave filters clear; look for 🟢 dots on unverified spots.

High-confidence spots (≥ 75) show a **Verify** button directly on the collapsed row — you don't need to expand. One click marks them `verified`.

If you want to spot-check first: expand → read the fields → **Verify** from expanded view.

### Step 3 — Enrich thin spots

Filter: toggle **Thin only**.

Thin spots have no ordering intel, so Sam can name them but can't say what to get. Two ways to fix:

**Option A — You know the spot:**
1. Expand the card
2. Type raw notes in the freeform box: _"the dry chilli pan mee is insane, cash only, go before 11am"_
3. Hit **Parse & Save** — the LLM extracts structured fields and merges them in

**Option B — You don't know the spot:**
1. Expand the card
2. Hit **Suggest intel** — does a web search and pre-fills what_to_order, pro_tips, price, vibe into the edit form
3. Review the suggestions (they're from the web, not a contributor — treat as a starting point)
4. **Save** if they look right

### Step 4 — Spot-edit anything that looks off

On any expanded card → **Edit** opens all editable fields:
- Categories (checkboxes)
- Must-go flag
- Vibe
- Address
- Price range
- What to order (one per line)
- What to skip (one per line)
- Pro tips (one per line)

Hit **Save** when done.

---

## The Corrections Tab

Switch to the **Corrections** tab to see user-reported issues. Each entry shows:
- Spot name + area
- Correction type (e.g. `closed`, `wrong_hours`, `wrong_info`)
- The user's note
- Reporter ID + date

Actions:
- **Approve (close)** — marks the spot as closed, hides it from recommendations
- **Dismiss** — rejects the correction, restores the spot to verified

If a correction says wrong hours or wrong info (not closed), dismiss it but then manually edit the spot to fix the data.

---

## Batch Web-Validate

If there are many thin spots and you don't want to enrich them one by one:

1. Hit **"Web-validate N thin spots"** button at the top
2. Confirm the modal (shows estimated time — ~1.5s per spot)
3. A progress bar runs through all unverified thin spots, enriching each via web search
4. Spot list refreshes when done

This only fills **empty** fields — it never overwrites existing contributor data.

Use this as a first pass to reduce the thin count, then go back and manually review anything that still looks sparse.

---

## Filters Reference

| Filter | Use it for |
|--------|-----------|
| Category | Focus on one meal type at a time |
| Area | Review all spots in a neighbourhood before visiting |
| Must-go only | Audit your best-in-class picks |
| Verified only | Confirm the verified pool looks clean |
| Thin only | Target spots that need enrichment |
| Source | Review seed spots vs contributor spots vs generated spots separately |
| Search | Find a specific spot by name or area |

---

## Priority Order (Quick Reference)

1. **Needs review** → publish or delete
2. **Corrections tab** → approve or dismiss
3. **Thin spots, 🟢 green** → Suggest intel or Parse & Save
4. **Unverified, 🟢 green** → Verify
5. **Thin spots, 🟡 yellow** → enrich before verifying
6. **🔴 red** → decide: enrich, or delete if it's a weak entry

---

## Quality Standards

Before verifying a spot, it should have:

- [ ] Correct name and area
- [ ] At least one category
- [ ] At least one `what_to_order` item
- [ ] At least one `pro_tip` (hours, payment, when to go, what to avoid)
- [ ] A vibe

`must_go` is a strong signal — reserve it for spots you'd personally tell a friend to go out of their way for. If in doubt, leave it unchecked.
