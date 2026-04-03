import Image from "next/image";
import { REALM_ILLUSTRATIONS } from "@/lib/constants";
import type { ReactNode } from "react";

interface RealmBannerProps {
  realm: string;
  title: string;
  subtitle?: string;
  rune?: string;
  accentColor?: string;
  height?: string;
  action?: ReactNode;
  rainbow?: boolean;
  objectPosition?: string;
}

export function RealmBanner({
  realm,
  title,
  subtitle,
  rune,
  accentColor = "#d4af37",
  height = "180px",
  action,
  rainbow = false,
  objectPosition = "center center",
}: RealmBannerProps) {
  const src = REALM_ILLUSTRATIONS[realm];

  const runeStyle = rainbow
    ? {
        background:
          "linear-gradient(135deg, #ff6b6b, #ffa726, #ffee58, #66bb6a, #42a5f5, #7e57c2)",
        WebkitBackgroundClip: "text" as const,
        WebkitTextFillColor: "transparent",
      }
    : { color: accentColor };

  const lineStyle = rainbow
    ? {
        background:
          "linear-gradient(90deg, #ff6b6b, #ffa726, #ffee58, #66bb6a, #42a5f5, #7e57c2)",
      }
    : { background: accentColor };

  return (
    <div
      className="relative overflow-hidden animate-fade-up -mx-6 -mt-6 mb-6"
      style={{ height }}
    >
      {/* Background illustration */}
      {src && (
        <Image
          src={src}
          alt={`${realm} realm`}
          fill
          sizes="100vw"
          style={{ objectFit: "cover", objectPosition }}
          priority={false}
        />
      )}

      {/* Gradient overlay for readability */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(90deg,
            rgba(244,236,216,0.95) 0%,
            rgba(244,236,216,0.85) 35%,
            rgba(244,236,216,0.5) 65%,
            rgba(244,236,216,0.2) 100%)`,
        }}
      />

      {/* Content overlay */}
      <div className="relative h-full flex items-center justify-between px-6">
        <div>
          <div className="flex items-center gap-3">
            {rune && (
              <span className="text-2xl font-cinzel select-none" style={runeStyle}>
                {rune}
              </span>
            )}
            <h1 className="heading-norse text-xl">{title}</h1>
          </div>
          <div className="realm-line mt-1.5 mb-1 w-32" style={lineStyle} />
          {subtitle && (
            <p className="text-text-muted text-xs tracking-wide font-space-grotesk italic">
              {subtitle}
            </p>
          )}
        </div>
        {action && <div>{action}</div>}
      </div>
    </div>
  );
}
