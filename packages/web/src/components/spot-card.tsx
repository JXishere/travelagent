"use client";

import { useState } from "react";
import type { Spot } from "../lib/supabase";

interface SpotCardProps {
  spot: Spot;
  onApprove: (id: string) => void;
  onMustGo: (id: string, current: boolean) => void;
  onDelete: (id: string) => void;
  onSave: (id: string, updates: Partial<Spot>) => void;
  onPublish?: (id: string) => void;
}

const CATEGORIES = [
  "breakfast",
  "lunch",
  "dinner",
  "cafe",
  "activity",
  "nightlife",
  "market",
];
const VIBES = ["casual", "upscale", "chaotic", "chill", "local", "touristy"];

export function SpotCard({ spot, onApprove, onMustGo, onDelete, onSave, onPublish }: SpotCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notes, setNotes] = useState("");
  const [parsing, setParsing] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestedHours, setSuggestedHours] = useState<Record<string, string> | null>(null);
  const [draft, setDraft] = useState({
    must_go: spot.must_go,
    categories: spot.categories ?? [],
    vibe: spot.vibe ?? "",
    what_to_order: (spot.what_to_order ?? []).join("\n"),
    what_to_skip: (spot.what_to_skip ?? []).join("\n"),
    pro_tips: (spot.pro_tips ?? []).join("\n"),
    address: spot.address ?? "",
    price_range: spot.price_range ?? "",
  });

  const approved = spot.verified;

  const isThin = (!spot.what_to_order || spot.what_to_order.length === 0)
    && (!spot.pro_tips || spot.pro_tips.length === 0);

  const score = spot.confidence_score ?? null;
  const confidenceDotColor =
    score === null ? null :
    score >= 75 ? "#22c55e" :
    score >= 40 ? "#eab308" :
    "#ef4444";
  const highConfidence = score !== null && score >= 75;

  const handleParseAndSave = async () => {
    if (!notes.trim()) return;
    setParsing(true);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: notes, spotName: spot.name, city: spot.city }),
      });
      if (!res.ok) throw new Error("Extract failed");
      const parsed = await res.json();

      // Merge: append arrays, fill gaps for scalars
      const updates: Partial<Spot> = {};
      if (parsed.what_to_order?.length) {
        updates.what_to_order = [
          ...new Set([...(spot.what_to_order ?? []), ...parsed.what_to_order]),
        ];
      }
      if (parsed.pro_tips?.length) {
        updates.pro_tips = [
          ...new Set([...(spot.pro_tips ?? []), ...parsed.pro_tips]),
        ];
      }
      if (parsed.what_to_skip?.length) {
        updates.what_to_skip = [
          ...new Set([...(spot.what_to_skip ?? []), ...parsed.what_to_skip]),
        ];
      }
      // Scalars: only fill if currently empty
      if (parsed.vibe && !spot.vibe) updates.vibe = parsed.vibe;
      if (parsed.price_range && !spot.price_range) updates.price_range = parsed.price_range;
      if (parsed.address && !spot.address) updates.address = parsed.address;
      if (parsed.best_time_of_day && !spot.best_time_of_day) updates.best_time_of_day = parsed.best_time_of_day;
      if (parsed.indoor_outdoor && !spot.indoor_outdoor) updates.indoor_outdoor = parsed.indoor_outdoor;
      if (parsed.categories?.length) {
        const merged = [...new Set([...(spot.categories ?? []), ...parsed.categories])];
        if (merged.join() !== (spot.categories ?? []).join()) updates.categories = merged;
      }

      if (Object.keys(updates).length > 0) {
        onSave(spot.id, updates);
      }
      setNotes("");
    } catch (err) {
      console.error("Parse failed:", err);
    } finally {
      setParsing(false);
    }
  };

  const handleSuggestIntel = async () => {
    setSuggesting(true);
    try {
      const res = await fetch("/api/enrich-spot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotName: spot.name, city: spot.city }),
      });
      if (!res.ok) throw new Error();
      const { suggestions } = await res.json();

      setDraft(prev => ({
        ...prev,
        what_to_order:   prev.what_to_order   || (suggestions.what_to_order  ?? []).join("\n"),
        pro_tips:        prev.pro_tips        || (suggestions.pro_tips       ?? []).join("\n"),
        address:         prev.address         || suggestions.address         || "",
        price_range:     prev.price_range     || suggestions.price_range     || "",
        vibe:            prev.vibe            || suggestions.vibe            || "",
      }));

      setEditing(true);
    } catch {
      alert("Web search failed — try adding notes manually.");
    } finally {
      setSuggesting(false);
    }
  };

  const handleSave = () => {
    const updates: Partial<Spot> = {
      must_go: draft.must_go,
      categories: draft.categories,
      vibe: draft.vibe || null,
      what_to_order: draft.what_to_order
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      what_to_skip: draft.what_to_skip
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      pro_tips: draft.pro_tips
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      address: draft.address || null,
      price_range: draft.price_range || null,
    };
    onSave(spot.id, updates);
    setSuggestedHours(null);
    setEditing(false);
  };

  return (
    <div
      style={{
        backgroundColor: "var(--bar-bg)",
        borderRadius: "8px",
        border: approved ? "1px solid var(--green)" : "1px solid transparent",
        overflow: "hidden",
      }}
    >
      {/* Summary row */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.75rem 1rem",
          cursor: "pointer",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontWeight: "bold", flex: "1 1 auto", display: "flex", alignItems: "center", gap: "0.4rem" }}>
          {spot.name}
          {confidenceDotColor && (
            <span
              title={`Confidence: ${score}%`}
              style={{
                display: "inline-block",
                width: "7px",
                height: "7px",
                borderRadius: "50%",
                backgroundColor: confidenceDotColor,
                flexShrink: 0,
              }}
            />
          )}
        </span>
        <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>
          {spot.area}
        </span>
        <span
          style={{
            fontSize: "0.75rem",
            padding: "2px 6px",
            borderRadius: "4px",
            backgroundColor: "var(--bg)",
          }}
        >
          {(spot.categories ?? []).join(" · ")}
        </span>
        {spot.must_go && (
          <span style={{ color: "var(--green)", fontWeight: "bold", fontSize: "0.75rem" }}>
            must-go
          </span>
        )}
        {spot.needs_review && (
          <span style={{ color: "var(--red)", fontSize: "0.75rem", fontWeight: "bold" }}>
            needs review
          </span>
        )}
        <span style={{ color: "var(--muted)", fontSize: "0.7rem" }}>
          {spot.contribution_count ? `${spot.contribution_count}c` : "—"}
        </span>
        <span style={{ color: "var(--muted)", fontSize: "0.7rem" }}>
          {spot.input_method ?? "—"}
        </span>
        {approved && (
          <span style={{ color: "var(--green)", fontSize: "0.8rem" }}>✓</span>
        )}
        {!approved && highConfidence && (
          <button
            onClick={(e) => { e.stopPropagation(); onApprove(spot.id); }}
            style={{
              padding: "0.2rem 0.6rem",
              fontSize: "0.75rem",
              borderRadius: "4px",
              border: "1px solid var(--green)",
              background: "transparent",
              color: "var(--green)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            Verify
          </button>
        )}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div
          style={{
            padding: "0 1rem 1rem",
            borderTop: "1px solid var(--bg)",
            fontSize: "0.85rem",
          }}
        >
          {editing ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.75rem" }}>
              <label style={labelStyle}>
                Categories
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.25rem" }}>
                  {CATEGORIES.map((c) => (
                    <label key={c} style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.8rem", cursor: "pointer", color: "var(--fg)" }}>
                      <input
                        type="checkbox"
                        checked={draft.categories.includes(c)}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...draft.categories, c]
                            : draft.categories.filter((x) => x !== c);
                          setDraft({ ...draft, categories: next });
                        }}
                      />
                      {c}
                    </label>
                  ))}
                </div>
              </label>
              <label style={{ ...labelStyle, flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
                <input
                  type="checkbox"
                  checked={draft.must_go ?? false}
                  onChange={(e) => setDraft({ ...draft, must_go: e.target.checked })}
                />
                Must-go spot
              </label>
              <label style={labelStyle}>
                Vibe
                <select
                  value={draft.vibe}
                  onChange={(e) => setDraft({ ...draft, vibe: e.target.value })}
                  style={inputStyle}
                >
                  <option value="">—</option>
                  {VIBES.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label style={labelStyle}>
                Address
                <input
                  value={draft.address}
                  onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                Price range
                <input
                  value={draft.price_range}
                  onChange={(e) =>
                    setDraft({ ...draft, price_range: e.target.value })
                  }
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                What to order (one per line)
                <textarea
                  value={draft.what_to_order}
                  onChange={(e) =>
                    setDraft({ ...draft, what_to_order: e.target.value })
                  }
                  rows={4}
                  style={{ ...inputStyle, resize: "vertical" }}
                />
              </label>
              <label style={labelStyle}>
                What to skip (one per line)
                <textarea
                  value={draft.what_to_skip}
                  onChange={(e) =>
                    setDraft({ ...draft, what_to_skip: e.target.value })
                  }
                  rows={3}
                  style={{ ...inputStyle, resize: "vertical" }}
                />
              </label>
              <label style={labelStyle}>
                Pro tips (one per line)
                <textarea
                  value={draft.pro_tips}
                  onChange={(e) =>
                    setDraft({ ...draft, pro_tips: e.target.value })
                  }
                  rows={4}
                  style={{ ...inputStyle, resize: "vertical" }}
                />
              </label>
              {suggestedHours && (
                <p style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                  Hours pre-filled from web — verify before saving.
                </p>
              )}
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                <button onClick={handleSave} style={btnGreen}>
                  Save
                </button>
                <button onClick={() => setEditing(false)} style={btnMuted}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: "0.75rem" }}>
              <DetailRow label="Address" value={spot.address} />
              <DetailRow label="City" value={spot.city} />
              <DetailRow label="Price" value={spot.price_range} />
              <DetailRow label="Vibe" value={spot.vibe} />
              <DetailRow label="Best time" value={spot.best_time_of_day} />
              <DetailRow label="Indoor/outdoor" value={spot.indoor_outdoor} />
              {spot.latitude && spot.longitude ? (
                <div style={{ display: "flex", gap: "0.5rem", fontSize: "0.8rem", marginBottom: "0.25rem" }}>
                  <span style={{ color: "var(--muted)", minWidth: "5rem" }}>Maps</span>
                  <a
                    href={`https://maps.google.com/?q=${spot.latitude},${spot.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--accent, #4a9eff)" }}
                  >
                    Open in Maps
                  </a>
                </div>
              ) : null}

              {spot.what_to_order && spot.what_to_order.length > 0 && (
                <div style={{ marginTop: "0.5rem" }}>
                  <span style={{ color: "var(--muted)" }}>What to order:</span>
                  <ul style={{ margin: "0.25rem 0 0 1rem", padding: 0 }}>
                    {spot.what_to_order.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {spot.pro_tips && spot.pro_tips.length > 0 && (
                <div style={{ marginTop: "0.5rem" }}>
                  <span style={{ color: "var(--muted)" }}>Pro tips:</span>
                  <ul style={{ margin: "0.25rem 0 0 1rem", padding: 0 }}>
                    {spot.pro_tips.map((tip, i) => (
                      <li key={i}>{tip}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Freeform notes */}
              <div style={{ marginTop: "0.75rem" }}>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="What do you remember? e.g. &quot;the dry chilli pan mee is insane, always packed on weekends, go before 11am&quot;"
                  rows={3}
                  style={{
                    ...inputStyle,
                    width: "100%",
                    resize: "vertical",
                    boxSizing: "border-box",
                  }}
                />
                {notes.trim() && (
                  <button
                    onClick={handleParseAndSave}
                    disabled={parsing}
                    style={{ ...btnGreen, marginTop: "0.5rem" }}
                  >
                    {parsing ? "Parsing..." : "Parse & Save"}
                  </button>
                )}
              </div>

              {/* Actions */}
              <div
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  marginTop: "0.75rem",
                  borderTop: "1px solid var(--bg)",
                  paddingTop: "0.75rem",
                }}
              >
                {spot.needs_review && onPublish && (
                  <button onClick={() => onPublish(spot.id)} style={btnGreen}>
                    Publish
                  </button>
                )}
                {!approved && (
                  <button onClick={() => onApprove(spot.id)} style={btnGreen}>
                    Verify
                  </button>
                )}
                <button
                  onClick={() => onMustGo(spot.id, spot.must_go)}
                  style={spot.must_go ? btnGreen : btnMuted}
                >
                  {spot.must_go ? "★ must-go" : "☆ must-go?"}
                </button>
                <button onClick={() => setEditing(true)} style={btnMuted}>
                  Edit
                </button>
                {isThin && (
                  <button onClick={handleSuggestIntel} disabled={suggesting} style={btnMuted}>
                    {suggesting ? "Searching..." : "Suggest intel"}
                  </button>
                )}
                {confirmDelete ? (
                  <>
                    <button
                      onClick={() => onDelete(spot.id)}
                      style={btnDanger}
                    >
                      Confirm delete
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      style={btnMuted}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    style={btnDanger}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  if (!value) return null;
  return (
    <div style={{ marginTop: "0.25rem" }}>
      <span style={{ color: "var(--muted)" }}>{label}:</span> {value}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
  color: "var(--muted)",
  fontSize: "0.8rem",
};

const inputStyle: React.CSSProperties = {
  padding: "0.4rem 0.6rem",
  backgroundColor: "var(--bg)",
  color: "var(--fg)",
  border: "1px solid var(--muted)",
  borderRadius: "4px",
  fontFamily: "inherit",
  fontSize: "0.85rem",
};

const btnBase: React.CSSProperties = {
  padding: "0.4rem 0.75rem",
  borderRadius: "4px",
  border: "none",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "0.8rem",
};

const btnGreen: React.CSSProperties = {
  ...btnBase,
  backgroundColor: "var(--green)",
  color: "var(--bg)",
};

const btnMuted: React.CSSProperties = {
  ...btnBase,
  backgroundColor: "var(--bar-bg)",
  color: "var(--fg)",
  border: "1px solid var(--muted)",
};

const btnDanger: React.CSSProperties = {
  ...btnBase,
  backgroundColor: "var(--red)",
  color: "white",
};
