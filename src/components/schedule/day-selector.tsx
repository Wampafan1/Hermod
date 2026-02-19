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
    <div className="flex gap-2">
      {DAYS.map((label, index) => (
        <button
          key={index}
          type="button"
          onClick={() => toggle(index)}
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
            selected.includes(index)
              ? "bg-blue-600 text-white"
              : "bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
