"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { getAllSpots, updateSpot, deleteSpot, type Spot } from "../../lib/supabase";
import { SpotFilters } from "../../components/spot-filters";
import { SpotCard } from "../../components/spot-card";

export default function ReviewPage() {
  const [spots, setSpots] = useState<Spot[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    category: "",
    area: "",
    must_go: false,
    verified: false,
    source: "",
    search: "",
  });

  useEffect(() => {
    getAllSpots().then((data) => {
      setSpots(data);
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
    () => [...new Set(spots.map((s) => s.source).filter(Boolean))].sort() as string[],
    [spots]
  );

  const filtered = useMemo(() => {
    return spots.filter((s) => {
      if (filters.category && !(s.categories ?? []).includes(filters.category)) return false;
      if (filters.area && s.area !== filters.area) return false;
      if (filters.must_go && !s.must_go) return false;
      if (filters.verified && !s.verified) return false;
      if (filters.source && s.source !== filters.source) return false;
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
    for (const s of spots) {
      for (const cat of s.categories ?? []) {
        byCat[cat] = (byCat[cat] ?? 0) + 1;
      }
    }
    return { byCat, approved, total: spots.length };
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
      <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "1rem" }}>
        {stats.total} total &middot; {stats.approved} approved &middot;{" "}
        {Object.entries(stats.byCat)
          .sort(([, a], [, b]) => b - a)
          .map(([cat, n]) => `${cat} ${n}`)
          .join(" · ")}
      </p>

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
          />
        ))}
      </div>

      {filtered.length === 0 && (
        <div
          style={{
            textAlign: "center",
            color: "var(--muted)",
            padding: "3rem",
          }}
        >
          No spots match filters
        </div>
      )}

      <footer className="py-6 text-center text-xs" style={{ color: "var(--muted)" }}>
        <a href="https://samiseverywhere.com" className="hover:opacity-70 transition-opacity">samiseverywhere.com</a>
        <span className="mx-2">·</span>
        <span>© 2026 Sam</span>
      </footer>
    </div>
  );
}
