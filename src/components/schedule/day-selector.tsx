"use client";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface DaySelectorProps {
  selected: number[];
  onChange: (days: number[]) => void;
}

export function DaySelector({ selected, onChange }: DaySelectorProps) {
  function toggle(day: number) {
    if (selected.includes(day)) {
      onChange(selected.filter((d) => d !== day));
    } else {
      onChange([...selected, day]);
    }
  }

  return (
    <div className="flex gap-1">
      {DAYS.map((label, index) => (
        <button
          key={index}
          type="button"
          onClick={() => toggle(index)}
          className={`px-3 py-1.5 text-xs tracking-widest uppercase transition-colors ${
            selected.includes(index)
              ? "bg-gold-dim border border-gold text-gold-bright"
              : "bg-surface-raised border border-border text-text-dim hover:text-text hover:border-border-mid"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
