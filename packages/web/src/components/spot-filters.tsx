"use client";

interface SpotFiltersProps {
  categories: string[];
  areas: string[];
  sources: string[];
  filters: {
    category: string;
    area: string;
    tier: string;
    source: string;
    search: string;
  };
  onChange: (filters: SpotFiltersProps["filters"]) => void;
  totalCount: number;
  filteredCount: number;
}

export function SpotFilters({
  categories,
  areas,
  sources,
  filters,
  onChange,
  totalCount,
  filteredCount,
}: SpotFiltersProps) {
  const set = (key: keyof typeof filters, value: string) =>
    onChange({ ...filters, [key]: value });

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "0.5rem",
        alignItems: "center",
        padding: "1rem",
        backgroundColor: "var(--bar-bg)",
        borderRadius: "8px",
        marginBottom: "1rem",
      }}
    >
      <input
        type="text"
        placeholder="Search name or area..."
        value={filters.search}
        onChange={(e) => set("search", e.target.value)}
        style={{
          flex: "1 1 200px",
          padding: "0.5rem 0.75rem",
          backgroundColor: "var(--bg)",
          color: "var(--fg)",
          border: "1px solid var(--muted)",
          borderRadius: "4px",
          fontFamily: "inherit",
          fontSize: "0.85rem",
        }}
      />

      <select
        value={filters.category}
        onChange={(e) => set("category", e.target.value)}
        style={selectStyle}
      >
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <select
        value={filters.area}
        onChange={(e) => set("area", e.target.value)}
        style={selectStyle}
      >
        <option value="">All areas</option>
        {areas.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>

      <select
        value={filters.tier}
        onChange={(e) => set("tier", e.target.value)}
        style={selectStyle}
      >
        <option value="">All tiers</option>
        <option value="1">Tier 1 — must-do</option>
        <option value="2">Tier 2 — should-do</option>
        <option value="3">Tier 3 — hidden gem</option>
      </select>

      <select
        value={filters.source}
        onChange={(e) => set("source", e.target.value)}
        style={selectStyle}
      >
        <option value="">All sources</option>
        {sources.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <span style={{ color: "var(--muted)", fontSize: "0.8rem", marginLeft: "auto" }}>
        {filteredCount} / {totalCount}
      </span>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  backgroundColor: "var(--bg)",
  color: "var(--fg)",
  border: "1px solid var(--muted)",
  borderRadius: "4px",
  fontFamily: "inherit",
  fontSize: "0.85rem",
  cursor: "pointer",
};
