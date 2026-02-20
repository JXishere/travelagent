"use client";

interface SpotFiltersProps {
  categories: string[];
  areas: string[];
  sources: string[];
  filters: {
    category: string;
    area: string;
    must_go: boolean;
    verified: boolean;
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
  const set = (key: keyof typeof filters, value: string | boolean) =>
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

      <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.85rem", cursor: "pointer", color: "var(--fg)" }}>
        <input
          type="checkbox"
          checked={filters.must_go}
          onChange={(e) => set("must_go", e.target.checked)}
        />
        Must-go only
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.85rem", cursor: "pointer", color: "var(--fg)" }}>
        <input
          type="checkbox"
          checked={filters.verified}
          onChange={(e) => set("verified", e.target.checked)}
        />
        Verified only
      </label>

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
