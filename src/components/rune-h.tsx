import type { SVGProps } from "react";

/**
 * Rune H — the carved Viking Hagalaz rune that stands in for the "H"
 * in the Hermod wordmark. Stone-cartouche form with barbed diamond
 * terminals, chiselled cross-bar, and a runestone frame.
 *
 * Use `color` (or `style.color`) to tint — the paths use currentColor.
 * Use `size` to set height; width scales 3:4.
 */
export function RuneH({
  size = 24,
  ...props
}: SVGProps<SVGSVGElement> & { size?: number | string }) {
  const height = typeof size === "number" ? `${size}px` : size;
  const width =
    typeof size === "number"
      ? `${(size * 120) / 160}px`
      : `calc(${size} * 0.75)`;
  return (
    <svg
      viewBox="0 0 120 160"
      width={width}
      height={height}
      aria-hidden="true"
      {...props}
    >
      {/* Runestone cartouche */}
      <path
        d="M4 4 L116 4 L116 156 L4 156 Z M10 10 L10 150 L110 150 L110 10 Z"
        fill="currentColor"
        fillRule="evenodd"
      />
      {/* Corner knots */}
      <path d="M4 4 L14 4 L4 14 Z" fill="currentColor" opacity="0.85" />
      <path d="M116 4 L106 4 L116 14 Z" fill="currentColor" opacity="0.85" />
      <path d="M4 156 L14 156 L4 146 Z" fill="currentColor" opacity="0.85" />
      <path d="M116 156 L106 156 L116 146 Z" fill="currentColor" opacity="0.85" />
      {/* Punctuation dots */}
      <circle cx="60" cy="16" r="2" fill="currentColor" />
      <circle cx="60" cy="148" r="2" fill="currentColor" />
      {/* Inner H — barbed diamond terminals */}
      <path
        d="M24 24 L36 28 L34 40 L34 130 L36 138 L24 142 L14 138 L16 130 L16 40 L14 28 Z"
        fill="currentColor"
      />
      <path
        d="M96 24 L108 28 L106 40 L106 130 L108 138 L96 142 L86 138 L88 130 L88 40 L86 28 Z"
        fill="currentColor"
      />
      {/* Crossbar */}
      <path d="M22 76 L88 86 L88 96 L22 86 Z" fill="currentColor" />
      {/* Inlaid diamond notch */}
      <path d="M52 82 L58 84 L52 88 Z" fill="#fbf9f6" opacity="0.7" />
    </svg>
  );
}

/**
 * Wordmark — RuneH + "ermod". The rune is the "H"; the rest is Cinzel.
 * Pass `size` to control rune height in px (text scales with it).
 */
export function HermodWordmark({
  size = 28,
  className,
  runeColor,
  textColor,
}: {
  size?: number;
  className?: string;
  runeColor?: string;
  textColor?: string;
}) {
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: `${Math.max(2, Math.round(size * 0.12))}px`,
        lineHeight: 1,
        color: textColor,
      }}
    >
      <RuneH size={size} style={{ color: runeColor ?? "currentColor" }} />
      <span
        style={{
          fontFamily: "var(--font-cinzel), 'Cinzel', serif",
          fontWeight: 900,
          fontSize: `${Math.round(size * 0.62)}px`,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
        }}
      >
        ermod
      </span>
    </span>
  );
}
