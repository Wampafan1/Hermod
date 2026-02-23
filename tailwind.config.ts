import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    borderRadius: {
      none: "0",
      DEFAULT: "0",
      full: "9999px",
    },
    extend: {
      colors: {
        void: "#04060f",
        deep: "#080c1a",
        gold: {
          DEFAULT: "#c9933a",
          bright: "#f0b84a",
          dim: "rgba(201,147,58,0.3)",
        },
        ember: "#e85d20",
        frost: "#7eb8d4",
        text: {
          DEFAULT: "#d4c4a0",
          dim: "rgba(212,196,160,0.55)",
        },
        surface: {
          DEFAULT: "rgba(4,6,15,0.9)",
          raised: "rgba(8,12,26,0.95)",
        },
        border: {
          DEFAULT: "rgba(201,147,58,0.1)",
          mid: "rgba(201,147,58,0.3)",
        },
        success: {
          DEFAULT: "#22c55e",
          dim: "rgba(34,197,94,0.15)",
        },
        error: {
          DEFAULT: "#ef4444",
          dim: "rgba(239,68,68,0.15)",
        },
        warning: {
          DEFAULT: "#f59e0b",
          dim: "rgba(245,158,11,0.15)",
        },
      },
      fontFamily: {
        cinzel: ["var(--font-cinzel)", "serif"],
        inconsolata: ["var(--font-inconsolata)", "monospace"],
      },
      keyframes: {
        "slide-in": {
          "0%": { transform: "translateX(100%)", opacity: "0" },
          "100%": { transform: "translateX(0)", opacity: "1" },
        },
        "fade-up": {
          "0%": { transform: "translateY(24px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "toast-in": {
          "0%": { transform: "translateX(100%) scale(0.95)", opacity: "0" },
          "100%": { transform: "translateX(0) scale(1)", opacity: "1" },
        },
        "pip-pulse": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
        "rune-float": {
          "0%, 100%": { transform: "translateY(0)", opacity: "0.3" },
          "50%": { transform: "translateY(-8px)", opacity: "0.6" },
        },
      },
      animation: {
        "slide-in": "slide-in 0.2s ease-out",
        "fade-up": "fade-up 0.5s cubic-bezier(0.76,0,0.24,1) both",
        "toast-in": "toast-in 0.3s cubic-bezier(0.76,0,0.24,1) both",
        "pip-pulse": "pip-pulse 2s ease-in-out infinite",
        "rune-float": "rune-float 4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
