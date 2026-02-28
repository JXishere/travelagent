"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { getAllSpots, updateSpot, deleteSpot, getPendingCorrections, approveCorrection, rejectCorrection, type Spot, type PendingCorrection } from "../../lib/supabase";
import { SpotFilters } from "../../components/spot-filters";
import { SpotCard } from "../../components/spot-card";

interface ValidateProgress {
  done: number;
  total: number;
  name: string;
}

export default function ReviewPage() {
  const [spots, setSpots] = useState<Spot[]>([]);
  const [corrections, setCorrections] = useState<PendingCorrection[]>([]);
  const [showCorrections, setShowCorrections] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showValidateModal, setShowValidateModal] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validateProgress, setValidateProgress] = useState<ValidateProgress | null>(null);
  const [validateDone, setValidateDone] = useState<{ count: number; ts: string } | null>(null);
  const [filters, setFilters] = useState({
    category: "",
    area: "",
    must_go: false,
    verified: false,
    thin_only: false,
    input_method: "",
    search: "",
  });

  useEffect(() => {
    Promise.all([getAllSpots(), getPendingCorrections()]).then(([spotsData, correctionsData]) => {
      setSpots(spotsData);
      setCorrections(correctionsData);
      setLoading(false);
    });
  }, []);

  const categories = useMemo(
    () => [...new Set(spots.flatMap((s) => s.categories ?? []))].sort(),
    [spots]
  );
  const areas = useMemo(
    () => [...new Set(spots.map((s) => s.area))].sort(),
    [spots]
  );
  const sources = useMemo(
    () => [...new Set(spots.map((s) => s.input_method).filter(Boolean))].sort() as string[],
    [spots]
  );

  const filtered = useMemo(() => {
    return spots.filter((s) => {
      if (filters.category && !(s.categories ?? []).includes(filters.category)) return false;
      if (filters.area && s.area !== filters.area) return false;
      if (filters.must_go && !s.must_go) return false;
      if (filters.verified && !s.verified) return false;
      if (filters.thin_only) {
        const noOrder = !s.what_to_order || s.what_to_order.length === 0;
        const noTips  = !s.pro_tips || s.pro_tips.length === 0;
        if (!(noOrder && noTips)) return false;
      }
      if (filters.input_method && s.input_method !== filters.input_method) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (
          !s.name.toLowerCase().includes(q) &&
          !s.area.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [spots, filters]);

  const stats = useMemo(() => {
    const byCat: Record<string, number> = {};
    const approved = spots.filter((s) => s.verified).length;
    const needsReviewCount = spots.filter((s) => s.needs_review).length;
    const thinCount = spots.filter((s) => {
      const noOrder = !s.what_to_order || s.what_to_order.length === 0;
      const noTips  = !s.pro_tips || s.pro_tips.length === 0;
      return noOrder && noTips;
    }).length;
    for (const s of spots) {
      for (const cat of s.categories ?? []) {
        byCat[cat] = (byCat[cat] ?? 0) + 1;
      }
    }
    return { byCat, approved, needsReviewCount, thinCount, total: spots.length };
  }, [spots]);

  const handleApprove = useCallback(async (id: string) => {
    const ok = await updateSpot(id, { verified: true });
    if (ok) {
      setSpots((prev) =>
        prev.map((s) => (s.id === id ? { ...s, verified: true } : s))
      );
    }
  }, []);

  const handleMustGo = useCallback(async (id: string, current: boolean) => {
    const ok = await updateSpot(id, { must_go: !current });
    if (ok) {
      setSpots((prev) =>
        prev.map((s) => (s.id === id ? { ...s, must_go: !current } : s))
      );
    }
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    const ok = await deleteSpot(id);
    if (ok) {
      setSpots((prev) => prev.filter((s) => s.id !== id));
    }
  }, []);

  const handleSave = useCallback(async (id: string, updates: Partial<Spot>) => {
    const ok = await updateSpot(id, updates);
    if (ok) {
      setSpots((prev) =>
        prev.map((s) => (s.id === id ? { ...s, ...updates } : s))
      );
    }
  }, []);

  const handlePublishSpot = useCallback(async (id: string) => {
    const ok = await updateSpot(id, { needs_review: false });
    if (ok) {
      setSpots((prev) =>
        prev.map((s) => (s.id === id ? { ...s, needs_review: false } : s))
      );
    }
  }, []);

  const handleApproveCorrection = useCallback(async (spotId: string) => {
    const ok = await approveCorrection(spotId);
    if (ok) setCorrections((prev) => prev.filter((c) => c.spot_id !== spotId));
  }, []);

  const handleRejectCorrection = useCallback(async (spotId: string) => {
    const ok = await rejectCorrection(spotId);
    if (ok) setCorrections((prev) => prev.filter((c) => c.spot_id !== spotId));
  }, []);

  const handleStartValidation = useCallback(async () => {
    setShowValidateModal(false);
    setValidating(true);
    setValidateProgress({ done: 0, total: 0, name: "" });
    setValidateDone(null);

    try {
      const res = await fetch("/api/batch-validate?thin_only=true&unverified_only=true");
      if (!res.ok || !res.body) throw new Error("Validation request failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line) as ValidateProgress;
            setValidateProgress(data);
          } catch { /* skip malformed lines */ }
        }
      }

      // Refresh spot list after validation completes
      const updated = await getAllSpots();
      setSpots(updated);
      setValidateDone({
        count: validateProgress?.total ?? 0,
        ts: new Date().toLocaleTimeString(),
      });
    } catch (err) {
      console.error("Batch validation failed:", err);
    } finally {
      setValidating(false);
    }
  }, [validateProgress?.total]);

  // Deduplicate corrections by spot for the approve/reject handlers (one action per spot)
  // Must be before the early return — hooks cannot be called conditionally
  const correctionsBySpot = useMemo(() => {
    const seen = new Set<string>();
    return corrections.filter((c) => {
      if (seen.has(c.spot_id)) return false;
      seen.add(c.spot_id);
      return true;
    });
  }, [corrections]);

  if (loading) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
        Loading spots...
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "1.5rem 1rem" }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>
        spot review
      </h1>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}>
          {stats.total} total &middot; {stats.approved} approved &middot; {stats.needsReviewCount > 0 && <span style={{ color: "var(--red)" }}>{stats.needsReviewCount} needs review &middot; </span>}{stats.thinCount} thin &middot;{" "}
          {Object.entries(stats.byCat)
            .sort(([, a], [, b]) => b - a)
            .map(([cat, n]) => `${cat} ${n}`)
            .join(" · ")}
        </p>
        {stats.thinCount > 0 && (
          <button
            onClick={() => setShowValidateModal(true)}
            disabled={validating}
            style={{
              padding: "0.25rem 0.65rem",
              fontSize: "0.75rem",
              borderRadius: "4px",
              border: "1px solid var(--muted)",
              background: "transparent",
              color: validating ? "var(--muted)" : "var(--fg)",
              cursor: validating ? "not-allowed" : "pointer",
              flexShrink: 0,
            }}
          >
            {validating
              ? `Validating ${validateProgress?.done ?? 0} / ${validateProgress?.total ?? "..."}`
              : validateDone
              ? `Validated ${validateDone.count} spots ✓`
              : `Web-validate ${stats.thinCount} thin spots`}
          </button>
        )}
      </div>

      {/* Progress bar while validating */}
      {validating && validateProgress && validateProgress.total > 0 && (
        <div style={{ marginBottom: "0.75rem" }}>
          <div
            style={{
              height: "4px",
              background: "var(--bg)",
              borderRadius: "2px",
              overflow: "hidden",
              marginBottom: "0.3rem",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${Math.round((validateProgress.done / validateProgress.total) * 100)}%`,
                background: "var(--green)",
                transition: "width 0.3s ease",
              }}
            />
          </div>
          <p style={{ color: "var(--muted)", fontSize: "0.75rem", margin: 0 }}>
            {validateProgress.name ? `Checking: ${validateProgress.name}` : "Starting..."}
            {" "}({validateProgress.done}/{validateProgress.total})
          </p>
        </div>
      )}

      {/* Validate modal */}
      {showValidateModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
          onClick={() => setShowValidateModal(false)}
        >
          <div
            style={{
              background: "var(--bar-bg)",
              border: "1px solid var(--border, #333)",
              borderRadius: "8px",
              padding: "1.5rem",
              maxWidth: "380px",
              width: "90%",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Web-validate thin spots</h2>
            <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "1rem" }}>
              {stats.thinCount} unverified thin spots will be enriched via web search.
              Est. time: ~{Math.ceil((stats.thinCount * 1.5) / 60)} min. Existing data is never overwritten.
            </p>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                onClick={handleStartValidation}
                style={{
                  padding: "0.4rem 0.9rem",
                  fontSize: "0.85rem",
                  borderRadius: "4px",
                  border: "none",
                  background: "var(--green)",
                  color: "var(--bg)",
                  cursor: "pointer",
                }}
              >
                Start
              </button>
              <button
                onClick={() => setShowValidateModal(false)}
                style={{
                  padding: "0.4rem 0.9rem",
                  fontSize: "0.85rem",
                  borderRadius: "4px",
                  border: "1px solid var(--muted)",
                  background: "transparent",
                  color: "var(--muted)",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab toggle */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <button
          onClick={() => setShowCorrections(false)}
          style={{
            padding: "0.3rem 0.8rem",
            fontSize: "0.8rem",
            borderRadius: "4px",
            border: "1px solid var(--border, #333)",
            background: showCorrections ? "transparent" : "var(--foreground, #fff)",
            color: showCorrections ? "var(--muted)" : "var(--background, #000)",
            cursor: "pointer",
          }}
        >
          Spots
        </button>
        <button
          onClick={() => setShowCorrections(true)}
          style={{
            padding: "0.3rem 0.8rem",
            fontSize: "0.8rem",
            borderRadius: "4px",
            border: "1px solid var(--border, #333)",
            background: showCorrections ? "var(--foreground, #fff)" : "transparent",
            color: showCorrections ? "var(--background, #000)" : "var(--muted)",
            cursor: "pointer",
          }}
        >
          Corrections{corrections.length > 0 ? ` (${corrections.length})` : ""}
        </button>
      </div>

      {showCorrections ? (
        <>
          {correctionsBySpot.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--muted)", padding: "3rem" }}>
              No pending corrections
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {corrections.map((c) => (
                <div
                  key={c.id}
                  style={{
                    border: "1px solid var(--border, #333)",
                    borderRadius: "6px",
                    padding: "0.75rem 1rem",
                    fontSize: "0.85rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.25rem",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <strong>{c.spot_name}</strong>
                      {c.spot_area && <span style={{ color: "var(--muted)" }}> · {c.spot_area}</span>}
                      <span
                        style={{
                          marginLeft: "0.5rem",
                          padding: "0.1rem 0.4rem",
                          background: "var(--border, #333)",
                          borderRadius: "3px",
                          fontSize: "0.75rem",
                        }}
                      >
                        {c.correction_type}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
                      <button
                        onClick={() => handleApproveCorrection(c.spot_id)}
                        style={{
                          padding: "0.2rem 0.6rem",
                          fontSize: "0.75rem",
                          borderRadius: "4px",
                          border: "1px solid #c00",
                          background: "transparent",
                          color: "#c00",
                          cursor: "pointer",
                        }}
                      >
                        Approve (close)
                      </button>
                      <button
                        onClick={() => handleRejectCorrection(c.spot_id)}
                        style={{
                          padding: "0.2rem 0.6rem",
                          fontSize: "0.75rem",
                          borderRadius: "4px",
                          border: "1px solid var(--border, #333)",
                          background: "transparent",
                          color: "var(--muted)",
                          cursor: "pointer",
                        }}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                  {c.correction_note && (
                    <div style={{ color: "var(--muted)", fontSize: "0.8rem" }}>{c.correction_note}</div>
                  )}
                  <div style={{ color: "var(--muted)", fontSize: "0.75rem" }}>
                    Reporter: ...{c.reporter_id.slice(-4)} &middot;{" "}
                    {new Date(c.created_at).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <SpotFilters
            categories={categories}
            areas={areas}
            sources={sources}
            filters={filters}
            onChange={setFilters}
            totalCount={stats.total}
            filteredCount={filtered.length}
          />

          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {filtered.map((spot) => (
              <SpotCard
                key={spot.id}
                spot={spot}
                onApprove={handleApprove}
                onMustGo={handleMustGo}
                onDelete={handleDelete}
                onSave={handleSave}
                onPublish={handlePublishSpot}
              />
            ))}
          </div>

          {filtered.length === 0 && (
            <div style={{ textAlign: "center", color: "var(--muted)", padding: "3rem" }}>
              No spots match filters
            </div>
          )}
        </>
      )}

      <footer className="py-6 text-center text-xs" style={{ color: "var(--muted)" }}>
        <a href="https://samiseverywhere.com" className="hover:opacity-70 transition-opacity">samiseverywhere.com</a>
        <span className="mx-2">·</span>
        <span>© 2026 Sam</span>
      </footer>
    </div>
  );
}
