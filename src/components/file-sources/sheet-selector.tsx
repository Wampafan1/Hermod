"use client";

interface SheetSelectorProps {
  sheets: string[];
  selected: string;
  onSelect: (name: string) => void;
  accentColor: string;
}

export function SheetSelector({
  sheets,
  selected,
  onSelect,
  accentColor,
}: SheetSelectorProps) {
  if (sheets.length <= 1) return null;

  return (
    <div>
      <p className="label-norse mb-2">Select Sheet</p>
      <div className="flex flex-wrap gap-px bg-border">
        {sheets.map((name) => (
          <button
            key={name}
            onClick={() => onSelect(name)}
            className={`px-4 py-2 text-xs font-space-grotesk tracking-wider uppercase transition-colors ${
              selected === name
                ? "bg-deep text-text"
                : "bg-void text-text-muted hover:text-text-dim hover:bg-scroll/50"
            }`}
            style={
              selected === name
                ? { borderBottom: `2px solid ${accentColor}` }
                : undefined
            }
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}
