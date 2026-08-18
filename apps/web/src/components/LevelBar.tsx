export function LevelBar({
  level,
  tier,
  pct,
  hint = "10 XP = 1 Level",
  compact = false,
}: {
  level: number;
  tier: string;
  pct: number;
  hint?: string;
  compact?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, ...(compact ? { marginTop: 12 } : {}) }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: compact ? 14 : 16, fontWeight: 500 }}>
          Level {level}{" "}
          <span style={{ fontWeight: 400, fontSize: compact ? 11 : 12, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            · {tier}
          </span>
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>{hint}</div>
      </div>
      <div className="progress" style={{ height: 6 }}>
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
