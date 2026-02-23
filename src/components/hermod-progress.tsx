"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import "./hermod-progress.css";

// ─── Elder Futhark rune set ───
const RUNES = ["ᚠ","ᚢ","ᚦ","ᚨ","ᚱ","ᚲ","ᚷ","ᚹ","ᚺ","ᚾ","ᛁ","ᛃ","ᛇ","ᛈ","ᛉ","ᛊ"];

// ─── Bifrost realm config ───
const REALMS = [
  { name: "Midgard" },
  { name: "Jötunheim" },
  { name: "Valhalla" },
  { name: "Asgard" },
];

// ─── Round-robin counter (persists across mounts) ───
let globalRoundRobinCounter = 0;

// ─── Types ───
interface HermodProgressProps {
  /** Show/hide the modal */
  isOpen: boolean;
  /** Close handler (clicking backdrop or X) */
  onClose?: () => void;
  /** Which progress style to render. Use "round-robin" to alternate automatically. */
  variant: "forge" | "bifrost" | "round-robin";
  /** Controlled progress 0–100. If omitted, auto-animates in a loop. */
  progress?: number;
  /** Override the auto-generated status text */
  statusText?: string;
  /** Disable the hammer-strike screen shake on forge completion */
  disableScreenShake?: boolean;
}

// ═══════════════════════════════════════════
//  SPARK PARTICLE (used by Forge variant)
// ═══════════════════════════════════════════
interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  decay: number;
  size: number;
  color: string;
}

function createSpark(x: number, y: number): Spark {
  return {
    x,
    y,
    vx: (Math.random() - 0.5) * 3.5,
    vy: -(Math.random() * 4.5 + 1),
    life: 1,
    decay: Math.random() * 0.03 + 0.012,
    size: Math.random() * 2.5 + 0.5,
    color: Math.random() > 0.3 ? "#ffcc33" : "#ff8800",
  };
}

// ═══════════════════════════════════════════
//  LIGHTNING BOLT DRAWING (used by Bifrost)
// ═══════════════════════════════════════════
function drawLightningBolt(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  generations: number
) {
  if (generations <= 0) return;
  const midX = (x1 + x2) / 2 + (Math.random() - 0.5) * 30;
  const midY = (y1 + y2) / 2 + (Math.random() - 0.5) * 20;

  if (generations === 1) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(midX, midY);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    return;
  }
  drawLightningBolt(ctx, x1, y1, midX, midY, generations - 1);
  drawLightningBolt(ctx, midX, midY, x2, y2, generations - 1);

  if (Math.random() > 0.6) {
    const bx = midX + (Math.random() - 0.5) * 40;
    const by = midY + (Math.random() - 0.5) * 30;
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.moveTo(midX, midY);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// ═══════════════════════════════════════════
//  WALL CRACKS DRAWING
// ═══════════════════════════════════════════
function drawCracks(canvas: HTMLCanvasElement) {
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  ctx.strokeStyle = "rgba(212, 175, 55, 0.35)";
  ctx.lineWidth = 1.5;
  ctx.shadowColor = "rgba(255, 180, 0, 0.6)";
  ctx.shadowBlur = 8;

  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    let x = cx;
    let y = cy;
    const angle = (Math.PI * 2 / 8) * i + (Math.random() - 0.5) * 0.5;
    const segments = Math.floor(Math.random() * 4) + 3;
    for (let j = 0; j < segments; j++) {
      const len = Math.random() * 60 + 20;
      x += Math.cos(angle + (Math.random() - 0.5) * 0.8) * len;
      y += Math.sin(angle + (Math.random() - 0.5) * 0.8) * len;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

// ═══════════════════════════════════════════
//  FORGE STATUS TEXT
// ═══════════════════════════════════════════
function getForgeStatus(p: number): string {
  if (p < 0.25) return "Heating the forge…";
  if (p < 0.50) return "Metal glows white…";
  if (p < 0.75) return "Shaping the blade…";
  if (p < 0.95) return "Tempering the edge…";
  return "The weapon is forged ⚒";
}

function getBifrostStatus(p: number): string {
  if (p < 0.25) return "Hermod rides the Bifrost…";
  if (p < 0.50) return "Crossing the frozen wastes…";
  if (p < 0.75) return "The golden gates appear…";
  return "Message delivered to the Allfather ⚡";
}

// ═══════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════
export default function HermodProgress({
  isOpen,
  onClose,
  variant,
  progress: controlledProgress,
  statusText,
  disableScreenShake = false,
}: HermodProgressProps) {
  // ── Resolve round-robin to a concrete variant ──
  const [resolvedVariant, setResolvedVariant] = useState<"forge" | "bifrost">(
    variant === "round-robin" ? "forge" : variant
  );
  const prevIsOpen = useRef(false);

  useEffect(() => {
    // On each open transition, pick the next variant
    if (isOpen && !prevIsOpen.current) {
      if (variant === "round-robin") {
        const variants: ("forge" | "bifrost")[] = ["forge", "bifrost"];
        setResolvedVariant(variants[globalRoundRobinCounter % variants.length]);
        globalRoundRobinCounter++;
      } else {
        setResolvedVariant(variant);
      }
    }
    prevIsOpen.current = isOpen;
  }, [isOpen, variant]);

  // Use resolvedVariant everywhere below instead of variant
  const activeVariant = resolvedVariant;

  // ── Auto-progress when uncontrolled ──
  const [autoProgress, setAutoProgress] = useState(0);
  const isControlled = controlledProgress !== undefined;
  const progress = isControlled ? controlledProgress / 100 : autoProgress;

  // ── Refs ──
  const sparkCanvasRef = useRef<HTMLCanvasElement>(null);
  const lightningCanvasRef = useRef<HTMLCanvasElement>(null);
  const crackCanvasRef = useRef<HTMLCanvasElement>(null);
  const sparksRef = useRef<Spark[]>([]);
  const forgeTrackRef = useRef<HTMLDivElement>(null);
  const forgeFillRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number>(0);
  const lightningTickRef = useRef(0);
  const lastStrikeRef = useRef(false);
  const nodeRefs = useRef<(HTMLDivElement | null)[]>([]);

  // ── Screen-shake + cracks on forge completion ──
  const triggerHammerStrike = useCallback(() => {
    if (disableScreenShake) return;
    const modal = modalRef.current;
    if (!modal) return;

    // Flash
    modal.classList.add("hermod-flash");
    setTimeout(() => modal.classList.remove("hermod-flash"), 300);

    // Shake
    const offsets = [
      [3, -2], [-3, 1], [2, 2], [-1, -1], [0, 0],
    ];
    offsets.forEach(([x, y], i) => {
      setTimeout(() => {
        modal.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
      }, i * 50);
    });

    // Cracks
    const crackCanvas = crackCanvasRef.current;
    if (crackCanvas) {
      drawCracks(crackCanvas);
      crackCanvas.classList.remove("hermod-cracks-visible");
      void crackCanvas.offsetWidth;
      crackCanvas.classList.add("hermod-cracks-visible");
    }
  }, [disableScreenShake]);

  // ── Auto-animation loop (throttled to ~4Hz for React, CSS transitions handle smoothness) ──
  useEffect(() => {
    if (!isOpen || isControlled) return;
    let start: number | null = null;
    const duration = 4000;
    let raf: number;
    let lastStateTs = 0;

    function tick(ts: number) {
      if (start === null) start = ts;
      const elapsed = (ts - start) % duration;
      const t = elapsed / duration;
      // Ease in-out
      const eased = t < 0.5
        ? 2 * t * t
        : 1 - Math.pow(-2 * t + 2, 2) / 2;

      // Throttle React state updates to ~4fps — CSS transitions smooth the gaps
      if (ts - lastStateTs >= 250) {
        lastStateTs = ts;
        setAutoProgress(eased);
      }

      raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isOpen, isControlled]);

  // ── Hammer strike watcher ──
  useEffect(() => {
    if (activeVariant !== "forge") return;
    if (progress >= 0.98 && !lastStrikeRef.current) {
      lastStrikeRef.current = true;
      triggerHammerStrike();
    }
    if (progress < 0.5) {
      lastStrikeRef.current = false;
    }
  }, [progress, activeVariant, triggerHammerStrike]);

  // ── Spark animation loop (Forge) ──
  useEffect(() => {
    if (!isOpen || activeVariant !== "forge") return;
    const canvas = sparkCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function resizeCanvas() {
      if (!canvas) return;
      const parent = canvas.parentElement;
      if (!parent) return;
      canvas.width = parent.offsetWidth + 80;
      canvas.height = parent.offsetHeight + 80;
    }
    resizeCanvas();

    function loop() {
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Get forge head position
      const fill = forgeFillRef.current;
      const track = forgeTrackRef.current;
      if (fill && track) {
        const x = fill.offsetWidth;
        const y = track.offsetHeight / 2;
        for (let i = 0; i < 2; i++) {
          sparksRef.current.push(createSpark(x + 40, y + 40));
        }
      }

      sparksRef.current = sparksRef.current.filter((s) => s.life > 0);
      sparksRef.current.forEach((s) => {
        s.x += s.vx;
        s.y += s.vy;
        s.vy += 0.08;
        s.life -= s.decay;

        ctx.globalAlpha = s.life;
        ctx.fillStyle = s.color;
        ctx.shadowColor = s.color;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      });
      ctx.globalAlpha = 1;

      frameRef.current = requestAnimationFrame(loop);
    }
    frameRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frameRef.current);
      sparksRef.current = [];
    };
  }, [isOpen, activeVariant]);

  // ── Lightning animation loop (Bifrost) ──
  useEffect(() => {
    if (!isOpen || activeVariant !== "bifrost") return;
    const canvas = lightningCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function resizeCanvas() {
      if (!canvas) return;
      const parent = canvas.parentElement;
      if (!parent) return;
      canvas.width = parent.offsetWidth + 40;
      canvas.height = parent.offsetHeight + 120;
    }
    resizeCanvas();

    let raf: number;
    function loop() {
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      lightningTickRef.current++;

      if (lightningTickRef.current % 80 === 0 || lightningTickRef.current % 80 === 3) {
        ctx.strokeStyle = "rgba(212, 175, 55, 0.6)";
        ctx.lineWidth = 1;
        ctx.shadowColor = "rgba(255, 200, 50, 0.8)";
        ctx.shadowBlur = 10;

        // Pick a random active node to arc from
        const activeIndices: number[] = [];
        const activeCount = Math.floor(progress * REALMS.length);
        for (let i = 0; i <= Math.min(activeCount, REALMS.length - 1); i++) {
          activeIndices.push(i);
        }

        if (activeIndices.length > 0) {
          const idx = activeIndices[Math.floor(Math.random() * activeIndices.length)];
          const node = nodeRefs.current[idx];
          if (node && canvas.parentElement) {
            const parentRect = canvas.parentElement.getBoundingClientRect();
            const nodeRect = node.getBoundingClientRect();
            const startX = nodeRect.left - parentRect.left + nodeRect.width / 2 + 20;
            const startY = nodeRect.top - parentRect.top + nodeRect.height / 2 + 60;
            const endX = startX + (Math.random() - 0.5) * 120;
            const endY = startY - 30 - Math.random() * 40;
            drawLightningBolt(ctx, startX, startY, endX, endY, 4);
          }
        }
        ctx.shadowBlur = 0;
      }

      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(raf);
  }, [isOpen, activeVariant, progress]);

  // ── Cleanup node refs ──
  useEffect(() => {
    nodeRefs.current = nodeRefs.current.slice(0, REALMS.length);
  }, []);

  if (!isOpen) return null;

  // ── Derived state ──
  const displayStatus =
    statusText ??
    (activeVariant === "forge" ? getForgeStatus(progress) : getBifrostStatus(progress));

  const litRuneCount = Math.floor(progress * RUNES.length);
  const activeNodeCount = Math.floor(progress * REALMS.length);

  return (
    <>
      {/* ── Backdrop ── */}
      <div
        className="fixed inset-0 z-[9998] bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* ── Modal ── */}
      <div
        ref={modalRef}
        className="fixed left-1/2 top-1/2 z-[9999] w-[90vw] max-w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-white/[0.04] bg-[#0d110f] p-10 shadow-2xl shadow-black/60"
      >
        {/* Close button */}
        {onClose && (
          <button
            onClick={onClose}
            className="absolute right-4 top-4 text-xs tracking-[2px] uppercase text-[#D4AF37]/30 transition-colors hover:text-[#D4AF37]/70"
          >
            ✕
          </button>
        )}

        {/* Crack canvas overlay */}
        <canvas
          ref={crackCanvasRef}
          className="pointer-events-none absolute inset-0 z-50 h-full w-full opacity-0"
        />

        {/* Ambient glow */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
          <div className="absolute bottom-0 left-1/2 h-24 w-72 -translate-x-1/2 rounded-full bg-[#D4AF37]/[0.03] blur-3xl" />
          <div className="absolute left-[20%] top-0 h-20 w-48 rounded-full bg-amber-900/[0.04] blur-2xl" />
        </div>

        {/* ══════ FORGE VARIANT ══════ */}
        {activeVariant === "forge" && (
          <div className="relative">
            {/* Title */}
            <h3 className="mb-6 text-center font-['Cinzel',serif] text-xs font-bold tracking-[4px] uppercase text-[#D4AF37]/80">
              ᛏ &nbsp; The Molten Forge &nbsp; ᛏ
            </h3>

            {/* Rune strip */}
            <div className="mb-3 flex justify-between px-0.5">
              {RUNES.map((rune, i) => (
                <span
                  key={i}
                  className={`text-base transition-all duration-500 ${
                    i < litRuneCount
                      ? "text-[#D4AF37]/90 drop-shadow-[0_0_12px_rgba(212,175,55,0.7)]"
                      : "text-[#D4AF37]/10 blur-[0.5px]"
                  }`}
                >
                  {rune}
                </span>
              ))}
            </div>

            {/* Track */}
            <div
              ref={forgeTrackRef}
              className="relative h-1.5 w-full rounded-sm bg-white/[0.03] shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)]"
            >
              {/* Etched border */}
              <div className="pointer-events-none absolute -inset-px rounded-sm border border-[#D4AF37]/[0.06]" />

              {/* Fill */}
              <div
                ref={forgeFillRef}
                className="hermod-forge-fill relative h-full rounded-sm"
                style={{ width: `${progress * 100}%` }}
              >
                {/* Shimmer overlay */}
                <div className="hermod-shimmer absolute inset-0 rounded-sm" />

                {/* Ember glow head */}
                <div
                  className="absolute -right-2 top-1/2 z-10 h-4 w-4 -translate-y-1/2 rounded-full"
                  style={{
                    background:
                      "radial-gradient(circle, #fff8e0 0%, #ffcc33 40%, #D4AF37 70%, transparent 100%)",
                    boxShadow:
                      "0 0 15px 5px rgba(255,180,0,0.8), 0 0 40px 10px rgba(212,175,55,0.4), 0 0 80px 20px rgba(255,100,0,0.15)",
                  }}
                />
              </div>

              {/* Spark canvas */}
              <canvas
                ref={sparkCanvasRef}
                className="pointer-events-none absolute -inset-10 z-20"
              />
            </div>

            {/* Heat distortion */}
            <div
              className="mt-0.5 h-5 blur-[4px]"
              style={{
                width: `${progress * 100}%`,
                background:
                  "linear-gradient(180deg, rgba(255,100,0,0.06) 0%, transparent 100%)",
                transition: "width 0.3s ease-out",
              }}
            />

            {/* Status */}
            <p className="mt-4 text-center font-['Cinzel',serif] text-[10px] tracking-[3px] uppercase text-[#D4AF37]/50">
              {displayStatus}
            </p>
          </div>
        )}

        {/* ══════ BIFROST VARIANT ══════ */}
        {activeVariant === "bifrost" && (
          <div className="relative">
            {/* Title */}
            <h3 className="mb-8 text-center font-['Cinzel',serif] text-xs font-bold tracking-[4px] uppercase text-[#D4AF37]/80">
              ᛒ &nbsp; The Bifrost Constellation &nbsp; ᛒ
            </h3>

            {/* Constellation track */}
            <div className="relative flex w-full items-center py-5">
              {/* Lightning canvas */}
              <canvas
                ref={lightningCanvasRef}
                className="pointer-events-none absolute -inset-x-5 -inset-y-[60px] z-10"
              />

              {REALMS.map((realm, i) => (
                <React.Fragment key={realm.name}>
                  {/* Node */}
                  <div
                    ref={(el) => { nodeRefs.current[i] = el; }}
                    className={`relative z-20 h-2.5 w-2.5 flex-shrink-0 rounded-full border transition-all duration-500 ${
                      i <= activeNodeCount
                        ? "border-[#D4AF37]/50 shadow-[0_0_10px_3px_rgba(212,175,55,0.6),0_0_30px_6px_rgba(212,175,55,0.2)]"
                        : "border-white/5 bg-white/[0.06]"
                    }`}
                    style={
                      i <= activeNodeCount
                        ? {
                            background:
                              "radial-gradient(circle, #fff8e0 0%, #D4AF37 60%, #a07820 100%)",
                          }
                        : undefined
                    }
                  >
                    {/* Realm label */}
                    <span
                      className={`absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap font-['Cinzel',serif] text-[8px] tracking-[2px] uppercase transition-all duration-500 ${
                        i <= activeNodeCount
                          ? "text-[#D4AF37]/70 drop-shadow-[0_0_10px_rgba(212,175,55,0.3)]"
                          : "text-[#D4AF37]/15"
                      }`}
                    >
                      {realm.name}
                    </span>

                    {/* Pulse ring */}
                    {i <= activeNodeCount && (
                      <span className="hermod-pulse-ring absolute -inset-1.5 rounded-full border border-[#D4AF37]/30" />
                    )}
                  </div>

                  {/* Bridge connector (not after last node) */}
                  {i < REALMS.length - 1 && (
                    <div className="relative mx-1.5 h-0.5 flex-grow bg-white/[0.03]">
                      <div
                        className="hermod-bridge-fill relative h-full overflow-hidden"
                        style={{
                          width:
                            i < activeNodeCount
                              ? "100%"
                              : i === activeNodeCount
                              ? `${(progress * REALMS.length - activeNodeCount) * 100}%`
                              : "0%",
                          background: "linear-gradient(90deg, #D4AF37, #f0d060)",
                          boxShadow:
                            "0 0 8px rgba(212,175,55,0.5), 0 -2px 15px rgba(212,175,55,0.1), 0 2px 15px rgba(212,175,55,0.1)",
                          transition: "width 0.3s ease",
                        }}
                      >
                        {/* Bifrost rainbow shimmer */}
                        <div className="hermod-rainbow absolute -inset-x-0 -inset-y-1" />
                      </div>
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>

            {/* Status */}
            <p className="mt-4 text-center font-['Cinzel',serif] text-[10px] tracking-[3px] uppercase text-[#D4AF37]/50">
              {displayStatus}
            </p>
          </div>
        )}
      </div>
    </>
  );
}
