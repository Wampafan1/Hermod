interface RuneDividerProps {
  rune?: string;
  color?: string;
  className?: string;
}

export function RuneDivider({
  rune = "ᚾ",
  color,
  className = "",
}: RuneDividerProps) {
  const runeColor = color ?? "var(--text-muted)";
  const lineColor = color
    ? `color-mix(in srgb, ${color} 15%, transparent)`
    : "var(--border)";

  return (
    <div className={`flex items-center gap-4 ${className}`}>
      <div className="flex-1 h-px" style={{ background: lineColor }} />
      <span
        className="text-sm font-cinzel select-none"
        style={{ color: runeColor, opacity: 0.4 }}
      >
        {rune}
      </span>
      <div className="flex-1 h-px" style={{ background: lineColor }} />
    </div>
  );
}
