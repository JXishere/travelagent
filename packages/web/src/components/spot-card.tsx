"use client";

import { useState } from "react";
import type { Spot } from "../lib/supabase";

interface SpotCardProps {
  spot: Spot;
  onApprove: (id: string) => void;
  onDelete: (id: string) => void;
  onSave: (id: string, updates: Partial<Spot>) => void;
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

export function SpotCard({ spot, onApprove, onDelete, onSave }: SpotCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notes, setNotes] = useState("");
  const [parsing, setParsing] = useState(false);
  const [draft, setDraft] = useState({
    tier: spot.tier,
    category: spot.category,
    vibe: spot.vibe ?? "",
    what_to_order: (spot.what_to_order ?? []).join("\n"),
    pro_tips: (spot.pro_tips ?? []).join("\n"),
    address: spot.address ?? "",
    price_range: spot.price_range ?? "",
  });

  const approved = (spot.confidence_score ?? 0) >= 0.85;
  const tierLabel = spot.tier === 1 ? "T1" : spot.tier === 2 ? "T2" : "T3";
  const tierColor =
    spot.tier === 1
      ? "var(--green)"
      : spot.tier === 2
        ? "#60a5fa"
        : "var(--muted)";

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
      if (parsed.category && parsed.category !== spot.category) updates.category = parsed.category;
      if (parsed.tier && parsed.tier !== spot.tier) updates.tier = parsed.tier;

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

  const handleSave = () => {
    onSave(spot.id, {
      tier: draft.tier,
      category: draft.category,
      vibe: draft.vibe || null,
      what_to_order: draft.what_to_order
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      pro_tips: draft.pro_tips
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      address: draft.address || null,
      price_range: draft.price_range || null,
    });
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
        <span style={{ fontWeight: "bold", flex: "1 1 auto" }}>{spot.name}</span>
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
          {spot.category}
        </span>
        <span style={{ color: tierColor, fontWeight: "bold", fontSize: "0.8rem" }}>
          {tierLabel}
        </span>
        <span style={{ color: "var(--muted)", fontSize: "0.75rem" }}>
          {((spot.confidence_score ?? 0) * 100).toFixed(0)}%
        </span>
        <span style={{ color: "var(--muted)", fontSize: "0.7rem" }}>
          {spot.source ?? "—"}
        </span>
        {approved && (
          <span style={{ color: "var(--green)", fontSize: "0.8rem" }}>✓</span>
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
                Category
                <select
                  value={draft.category}
                  onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                  style={inputStyle}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label style={labelStyle}>
                Tier
                <select
                  value={draft.tier}
                  onChange={(e) =>
                    setDraft({ ...draft, tier: Number(e.target.value) })
                  }
                  style={inputStyle}
                >
                  <option value={1}>1 — must-do</option>
                  <option value={2}>2 — should-do</option>
                  <option value={3}>3 — hidden gem</option>
                </select>
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
              <DetailRow
                label="Hours"
                value={
                  spot.opening_hours
                    ? Object.entries(spot.opening_hours)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(" | ")
                    : null
                }
              />
              <DetailRow
                label="Lat/Lng"
                value={
                  spot.latitude && spot.longitude
                    ? `${spot.latitude}, ${spot.longitude}`
                    : null
                }
              />

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
                {!approved && (
                  <button onClick={() => onApprove(spot.id)} style={btnGreen}>
                    Approve
                  </button>
                )}
                <button onClick={() => setEditing(true)} style={btnMuted}>
                  Edit
                </button>
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
  backgroundColor: "#ef4444",
  color: "white",
};
