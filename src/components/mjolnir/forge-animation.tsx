"use client";

import { useState, useEffect, useRef, useCallback } from "react";

const SPARK_COLORS = ["#d4af37", "#ffb74d", "#ef5350", "#ffa726", "#fff59d", "#ffffff"];
const BIFROST = ["#ff6b6b", "#ffa726", "#ffee58", "#66bb6a", "#42a5f5", "#7e57c2"];

const PHASES = [
  { label: "Analyzing structure", rune: "ᚺ", dur: 2600 },
  { label: "Matching columns", rune: "ᛊ", dur: 2000 },
  { label: "Fingerprinting data", rune: "ᚱ", dur: 2200 },
  { label: "Computing diff", rune: "ᛗ", dur: 1800 },
  { label: "Inferring transforms", rune: "ᚠ", dur: 3000 },
  { label: "Reverse-engineering", rune: "ᛏ", dur: 2400 },
  { label: "Validating blueprint", rune: "ᚨ", dur: 1600 },
  { label: "Forging blueprint", rune: "⚒", dur: 1800 },
];

/* ═══ PARTICLE SYSTEM ON CANVAS ═══ */

function ForgeParticles({
  active,
  striking,
  size,
}: {
  active: boolean;
  striking: boolean;
  size: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const parts = useRef<
    { angle: number; radius: number; speed: number; size: number; phase: number; color: string }[]
  >([]);
  const bursts = useRef<
    { x: number; y: number; vx: number; vy: number; size: number; life: number; color: string }[]
  >([]);
  const frame = useRef(0);
  const lastBurst = useRef(0);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    let raf: number;
    const pr = window.devicePixelRatio || 1;
    c.width = size * pr;
    c.height = size * pr;
    ctx.setTransform(pr, 0, 0, pr, 0, 0);

    // Ambient orbiting particles
    if (parts.current.length === 0) {
      parts.current = Array.from({ length: 30 }, (_, i) => ({
        angle: (i / 30) * Math.PI * 2,
        radius: 80 + Math.random() * 55,
        speed: 0.003 + Math.random() * 0.004,
        size: 0.5 + Math.random() * 1.2,
        phase: Math.random() * Math.PI * 2,
        color: SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)],
      }));
    }

    const draw = () => {
      frame.current += 1;
      const cx = size / 2;
      const cy = size / 2;
      ctx.clearRect(0, 0, size, size);

      if (active) {
        // Orbiting particles
        parts.current.forEach((p) => {
          p.angle += p.speed;
          const wobble = Math.sin(frame.current * 0.03 + p.phase) * 8;
          const r = p.radius + wobble;
          const x = cx + Math.cos(p.angle) * r;
          const y = cy + Math.sin(p.angle) * r;
          const flicker = 0.4 + Math.sin(frame.current * 0.06 + p.phase) * 0.3;

          ctx.beginPath();
          ctx.arc(x, y, p.size * 2.5, 0, Math.PI * 2);
          ctx.fillStyle = p.color + "10";
          ctx.fill();

          ctx.beginPath();
          ctx.arc(x, y, p.size, 0, Math.PI * 2);
          ctx.fillStyle =
            p.color + Math.floor(flicker * 180).toString(16).padStart(2, "0");
          ctx.fill();
        });
      }

      // Burst sparks
      bursts.current = bursts.current.filter((b) => b.life > 0);
      bursts.current.forEach((b) => {
        b.x += b.vx;
        b.y += b.vy;
        b.vy += 0.06;
        b.vx *= 0.98;
        b.life -= 0.02;
        const a = Math.max(0, b.life);

        ctx.beginPath();
        ctx.arc(b.x, b.y, b.size * a * 3, 0, Math.PI * 2);
        ctx.fillStyle =
          b.color + Math.floor(a * 15).toString(16).padStart(2, "0");
        ctx.fill();

        ctx.beginPath();
        ctx.arc(b.x, b.y, b.size * a, 0, Math.PI * 2);
        ctx.fillStyle =
          b.color + Math.floor(a * 220).toString(16).padStart(2, "0");
        ctx.fill();
      });

      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [active, size]);

  // Emit burst on strike
  useEffect(() => {
    if (!striking) return;
    const now = Date.now();
    if (now - lastBurst.current < 300) return;
    lastBurst.current = now;
    const cx = size / 2;
    const cy = size / 2;
    for (let i = 0; i < 24; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 5;
      bursts.current.push({
        x: cx + (Math.random() - 0.5) * 16,
        y: cy + (Math.random() - 0.5) * 16,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 0.8 + Math.random() * 2,
        life: 0.5 + Math.random() * 0.6,
        color: SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)],
      });
    }
  }, [striking, size]);

  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      style={{
        position: "absolute",
        inset: 0,
        width: size,
        height: size,
        pointerEvents: "none",
        zIndex: 1,
      }}
    />
  );
}

/* ═══ FORGE ANIMATION ═══ */

export function ForgeAnimation() {
  const [phase, setPhase] = useState(0);
  const [striking, setStriking] = useState(false);
  const [pulseKey, setPulseKey] = useState(0);
  const strikeRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Auto-start on mount
  useEffect(() => {
    // Start strike interval
    strikeRef.current = setInterval(() => {
      setStriking(true);
      setPulseKey((k) => k + 1);
      setTimeout(() => setStriking(false), 120);
    }, 600);

    // Advance phases on timers
    let cur = 0;
    const advance = () => {
      cur++;
      if (cur >= PHASES.length) {
        // Hold on last phase — parent unmounts us when done
        return;
      }
      setPhase(cur);
      const timer = setTimeout(advance, PHASES[cur].dur);
      phaseTimers.current.push(timer);
    };
    const firstTimer = setTimeout(advance, PHASES[0].dur);
    phaseTimers.current.push(firstTimer);

    return () => {
      if (strikeRef.current) clearInterval(strikeRef.current);
      phaseTimers.current.forEach(clearTimeout);
    };
  }, []);

  const progress = Math.min((phase + 1) / PHASES.length, 1);
  const circumference = 2 * Math.PI * 120;

  return (
    <>
      <style>{`
        @keyframes fg-modalIn { from { opacity:0; transform:translate(-50%,-50%) scale(0.92); } to { opacity:1; transform:translate(-50%,-50%) scale(1); } }
        @keyframes fg-overlayIn { from { opacity:0 } to { opacity:1 } }
        @keyframes fg-pulse { 0%,100%{opacity:1}50%{opacity:0.3} }
        @keyframes fg-runeGlow {
          0%,100% { text-shadow: 0 0 8px rgba(212,175,55,0.3), 0 0 20px rgba(212,175,55,0.1); }
          50% { text-shadow: 0 0 16px rgba(212,175,55,0.8), 0 0 40px rgba(212,175,55,0.3), 0 0 60px rgba(212,175,55,0.1); }
        }
        @keyframes fg-forgeHeat {
          0%,100% { opacity: 0.03; }
          50% { opacity: 0.08; }
        }
        @keyframes fg-bifrostBar { 0%{background-position:0% 50%}100%{background-position:200% 50%} }
      `}</style>

      {/* Backdrop */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 999,
          background: "rgba(0,0,0,0.8)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          animation: "fg-overlayIn 0.3s ease",
        }}
      />

      {/* Modal */}
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%,-50%)",
          width: "420px",
          maxWidth: "calc(100vw - 40px)",
          background: "var(--deep, #080c1a)",
          border: "1px solid rgba(201,147,58,0.1)",
          borderRadius: "0",
          overflow: "hidden",
          zIndex: 1000,
          animation: "fg-modalIn 0.4s cubic-bezier(0.34,1.56,0.64,1)",
          boxShadow:
            "0 0 80px rgba(0,0,0,0.6), 0 0 40px rgba(212,175,55,0.05)",
        }}
      >
        {/* Bifrost top accent */}
        <div
          style={{
            height: "2px",
            background: `linear-gradient(90deg,${BIFROST.join(",")},${BIFROST[0]})`,
            backgroundSize: "200% 100%",
            animation: "fg-bifrostBar 4s linear infinite",
          }}
        />

        {/* Forge visualization */}
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "280px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {/* Background heat glow */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(circle at 50% 50%, rgba(212,175,55,0.04) 0%, transparent 60%)",
              animation: "fg-forgeHeat 2s ease-in-out infinite",
            }}
          />

          {/* Particle canvas */}
          <ForgeParticles active striking={striking} size={280} />

          {/* SVG Rings + Progress */}
          <svg
            width="280"
            height="280"
            viewBox="0 0 280 280"
            style={{ position: "absolute", zIndex: 2 }}
          >
            <defs>
              <linearGradient id="fg-progGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="var(--gold, #c9933a)" />
                <stop offset="50%" stopColor="#ffb74d" />
                <stop offset="100%" stopColor="var(--ember, #e85d20)" />
              </linearGradient>
            </defs>

            {/* Outer track ring */}
            <circle
              cx="140"
              cy="140"
              r="120"
              fill="none"
              stroke="rgba(212,175,55,0.04)"
              strokeWidth="1.5"
            />

            {/* Progress arc */}
            <circle
              cx="140"
              cy="140"
              r="120"
              fill="none"
              stroke="url(#fg-progGrad)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={`${circumference * progress} ${circumference}`}
              transform="rotate(-90 140 140)"
              opacity="0.7"
              style={{ transition: "stroke-dasharray 0.8s ease" }}
            />

            {/* Inner decorative ring */}
            <circle
              cx="140"
              cy="140"
              r="95"
              fill="none"
              stroke="rgba(212,175,55,0.03)"
              strokeWidth="0.5"
              strokeDasharray="1 4"
            />

            {/* Strike shockwave rings */}
            {striking && (
              <circle
                cx="140"
                cy="140"
                fill="none"
                stroke="rgba(212,175,55,0.4)"
                key={pulseKey}
              >
                <animate attributeName="r" from="40" to="130" dur="0.6s" fill="freeze" />
                <animate attributeName="opacity" from="0.4" to="0" dur="0.6s" fill="freeze" />
                <animate
                  attributeName="stroke-width"
                  from="2"
                  to="0.3"
                  dur="0.6s"
                  fill="freeze"
                />
              </circle>
            )}

            {/* Rune position markers on outer ring */}
            {PHASES.map((p, i) => {
              const a = (i / PHASES.length) * Math.PI * 2 - Math.PI / 2;
              const x = 140 + Math.cos(a) * 120;
              const y = 140 + Math.sin(a) * 120;
              const lit = i <= phase;
              const cur = i === phase;
              return (
                <g key={i}>
                  {cur && (
                    <circle cx={x} cy={y} r="3" fill="var(--gold, #c9933a)" opacity="0.6">
                      <animate
                        attributeName="r"
                        values="2;5;2"
                        dur="1.5s"
                        repeatCount="indefinite"
                      />
                      <animate
                        attributeName="opacity"
                        values="0.8;0.2;0.8"
                        dur="1.5s"
                        repeatCount="indefinite"
                      />
                    </circle>
                  )}
                  <circle
                    cx={x}
                    cy={y}
                    r={cur ? 3 : 2}
                    fill={lit ? "var(--gold, #c9933a)" : "rgba(212,175,55,0.08)"}
                    opacity={cur ? 1 : lit ? 0.5 : 0.3}
                    style={{ transition: "all 0.5s" }}
                  />
                </g>
              );
            })}
          </svg>

          {/* Center content */}
          <div
            style={{
              position: "absolute",
              zIndex: 5,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
            }}
          >
            {/* Forge rune */}
            <div
              style={{
                fontSize: "48px",
                fontFamily: "serif",
                color: "var(--gold, #c9933a)",
                animation: "fg-runeGlow 1.2s ease-in-out infinite",
                transform: striking ? "scale(1.15)" : "scale(1)",
                transition: "transform 0.08s ease-out",
                lineHeight: 1,
                marginBottom: "10px",
              }}
            >
              ⚒
            </div>

            {/* Current phase label */}
            {phase < PHASES.length && (
              <p
                style={{
                  fontFamily: "var(--font-inconsolata),monospace",
                  fontSize: "10px",
                  letterSpacing: "1.5px",
                  color: "var(--text-dim, rgba(212,196,160,0.55))",
                  margin: 0,
                }}
              >
                {PHASES[phase].label}
              </p>
            )}
          </div>
        </div>

        {/* Phase list */}
        <div
          style={{
            padding: "0 28px 8px",
            maxHeight: "220px",
            overflowY: "auto",
          }}
        >
          {PHASES.map((p, i) => {
            const st = i < phase ? "done" : i === phase ? "active" : "pending";
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "6px 0",
                  opacity: st === "pending" ? 0.18 : 1,
                  transition: "opacity 0.4s",
                }}
              >
                {/* Status dot */}
                <div
                  style={{
                    width: "14px",
                    height: "14px",
                    borderRadius: "50%",
                    flexShrink: 0,
                    border: `1px solid ${
                      st === "done"
                        ? "rgba(102,187,106,0.5)"
                        : st === "active"
                          ? "rgba(201,147,58,0.5)"
                          : "rgba(232,224,208,0.08)"
                    }`,
                    background:
                      st === "done" ? "rgba(102,187,106,0.12)" : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "all 0.3s",
                  }}
                >
                  {st === "done" && (
                    <span style={{ fontSize: "7px", color: "#66bb6a" }}>✓</span>
                  )}
                  {st === "active" && (
                    <div
                      style={{
                        width: "5px",
                        height: "5px",
                        borderRadius: "50%",
                        background: "var(--gold, #c9933a)",
                        animation: "fg-pulse 1s infinite",
                      }}
                    />
                  )}
                </div>

                {/* Rune */}
                <span
                  style={{
                    fontFamily: "serif",
                    fontSize: "11px",
                    width: "14px",
                    textAlign: "center",
                    color:
                      st === "active"
                        ? "var(--gold, #c9933a)"
                        : st === "done"
                          ? "rgba(201,147,58,0.35)"
                          : "rgba(201,147,58,0.08)",
                    transition: "color 0.3s",
                  }}
                >
                  {p.rune}
                </span>

                {/* Label */}
                <span
                  style={{
                    fontFamily: "var(--font-inconsolata),monospace",
                    fontSize: "11px",
                    letterSpacing: "0.3px",
                    color:
                      st === "active"
                        ? "var(--text, #d4c4a0)"
                        : st === "done"
                          ? "rgba(212,196,160,0.3)"
                          : "rgba(212,196,160,0.08)",
                    transition: "color 0.3s",
                  }}
                >
                  {p.label}
                </span>

                {/* Status text */}
                <span
                  style={{
                    marginLeft: "auto",
                    fontFamily: "var(--font-inconsolata),monospace",
                    fontSize: "8px",
                    color:
                      st === "done"
                        ? "rgba(102,187,106,0.35)"
                        : st === "active"
                          ? "rgba(201,147,58,0.3)"
                          : "transparent",
                  }}
                >
                  {st === "done" ? "done" : st === "active" ? "···" : ""}
                </span>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 28px 20px",
            textAlign: "center",
            borderTop: "1px solid rgba(201,147,58,0.04)",
          }}
        >
          <p
            style={{
              fontFamily: "var(--font-inconsolata),monospace",
              fontSize: "9px",
              letterSpacing: "2.5px",
              color: "rgba(201,147,58,0.2)",
              textTransform: "uppercase",
              margin: 0,
            }}
          >
            Do not disturb the forge
          </p>
        </div>

        {/* Bifrost bottom accent */}
        <div
          style={{
            height: "2px",
            background: `linear-gradient(90deg,${[...BIFROST].reverse().join(",")},${BIFROST[5]})`,
            backgroundSize: "200% 100%",
            animation: "fg-bifrostBar 4s linear infinite",
          }}
        />
      </div>
    </>
  );
}
