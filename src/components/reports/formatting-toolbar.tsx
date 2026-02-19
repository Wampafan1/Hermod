"use client";

interface FormattingToolbarProps {
  onBold: () => void;
  onTextColor: (color: string) => void;
  onBgColor: (color: string) => void;
  onNumFormat: (format: string) => void;
  onAlign: (align: "left" | "center" | "right") => void;
  isBold: boolean;
  currentAlign: string;
}

const TEXT_COLORS = [
  "#ffffff",
  "#ef4444",
  "#f59e0b",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#ec4899",
  "#6b7280",
];

const BG_COLORS = [
  "transparent",
  "#1e3a5f",
  "#1a2e1a",
  "#3f1a1a",
  "#3f3f1a",
  "#1a1a3f",
  "#2d1a3f",
  "#1f2937",
];

const NUM_FORMATS = [
  { label: "General", value: "" },
  { label: "Number", value: "#,##0.00" },
  { label: "Currency", value: "$#,##0.00" },
  { label: "Percentage", value: "0.00%" },
  { label: "Date", value: "mm/dd/yyyy" },
];

export function FormattingToolbar({
  onBold,
  onTextColor,
  onBgColor,
  onNumFormat,
  onAlign,
  isBold,
  currentAlign,
}: FormattingToolbarProps) {
  return (
    <div className="flex items-center gap-1 px-3 py-2 bg-gray-900 border border-gray-800 rounded-t-lg text-sm">
      {/* Bold */}
      <button
        onClick={onBold}
        className={`w-8 h-8 flex items-center justify-center rounded font-bold transition-colors ${
          isBold
            ? "bg-blue-600 text-white"
            : "text-gray-400 hover:text-white hover:bg-gray-800"
        }`}
        title="Bold"
      >
        B
      </button>

      <Separator />

      {/* Text Color */}
      <div className="flex items-center gap-0.5">
        <span className="text-xs text-gray-500 mr-1">A</span>
        {TEXT_COLORS.map((color) => (
          <button
            key={color}
            onClick={() => onTextColor(color)}
            className="w-5 h-5 rounded border border-gray-700 hover:border-gray-500 transition-colors"
            style={{ backgroundColor: color }}
            title={`Text: ${color}`}
          />
        ))}
      </div>

      <Separator />

      {/* Background Color */}
      <div className="flex items-center gap-0.5">
        <span className="text-xs text-gray-500 mr-1">BG</span>
        {BG_COLORS.map((color) => (
          <button
            key={color}
            onClick={() => onBgColor(color)}
            className="w-5 h-5 rounded border border-gray-700 hover:border-gray-500 transition-colors"
            style={{
              backgroundColor: color === "transparent" ? undefined : color,
            }}
            title={color === "transparent" ? "No background" : `BG: ${color}`}
          >
            {color === "transparent" && (
              <span className="text-[10px] text-gray-500">x</span>
            )}
          </button>
        ))}
      </div>

      <Separator />

      {/* Number Format */}
      <select
        onChange={(e) => onNumFormat(e.target.value)}
        className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-blue-500"
      >
        {NUM_FORMATS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>

      <Separator />

      {/* Alignment */}
      {(["left", "center", "right"] as const).map((align) => (
        <button
          key={align}
          onClick={() => onAlign(align)}
          className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
            currentAlign === align
              ? "bg-blue-600 text-white"
              : "text-gray-400 hover:text-white hover:bg-gray-800"
          }`}
          title={`Align ${align}`}
        >
          <AlignIcon align={align} />
        </button>
      ))}
    </div>
  );
}

function Separator() {
  return <div className="w-px h-6 bg-gray-700 mx-1" />;
}

function AlignIcon({ align }: { align: "left" | "center" | "right" }) {
  const lines =
    align === "left"
      ? ["w-5", "w-3", "w-4"]
      : align === "center"
        ? ["w-4 mx-auto", "w-5 mx-auto", "w-3 mx-auto"]
        : ["w-5 ml-auto", "w-3 ml-auto", "w-4 ml-auto"];
  return (
    <div className="space-y-0.5">
      {lines.map((cls, i) => (
        <div key={i} className={`h-[1.5px] bg-current rounded ${cls}`} />
      ))}
    </div>
  );
}
