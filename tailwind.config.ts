import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    borderRadius: {
      none: "0",
      DEFAULT: "4px",
      full: "9999px",
    },
    extend: {
      colors: {
        /* Parchment surfaces */
        void: "#F4ECD8",
        deep: "#EDE4CC",
        scroll: "#E5D9B8",

        /* Iron (dark sidebar / code) */
        iron: {
          DEFAULT: "#2D2A24",
          light: "#4A4035",
        },
        carbon: "#1A1815",

        /* Gold accents */
        gold: {
          DEFAULT: "#8B6914",
          bright: "#A67C1A",
          leaf: "#C4962A",
          dim: "rgba(139,105,20,0.15)",
        },

        /* Text */
        text: {
          DEFAULT: "#2D2A24",
          dim: "#6B6358",
          muted: "#968B7B",
        },

        /* Borders */
        border: {
          DEFAULT: "#D4C49E",
          mid: "#C4B48A",
        },
        burnt: "#D4C49E",

        /* Status */
        ember: "#B8450E",
        frost: "#2D5F7E",
        success: {
          DEFAULT: "#2D6B3F",
          dim: "rgba(45,107,63,0.12)",
        },
        error: {
          DEFAULT: "#8B2020",
          dim: "rgba(139,32,32,0.1)",
        },
        warning: {
          DEFAULT: "#B8860B",
          dim: "rgba(184,134,11,0.1)",
        },

        /* Surface aliases */
        surface: {
          DEFAULT: "#EDE4CC",
          raised: "#E5D9B8",
        },

        /* Landing page surfaces */
        "lp-surface": {
          DEFAULT: "#fbf9f6",
          dim: "#dbdad7",
          container: "#efeeeb",
          "container-low": "#f5f3f0",
          "container-high": "#eae8e5",
          "container-highest": "#e4e2df",
          "container-lowest": "#ffffff",
        },
        "on-surface": "#1b1c1a",
        "on-surface-variant": "#4e4638",
        "lp-primary": "#76570a",
        "primary-container": "#926f24",
        "on-primary": "#ffffff",
        "outline": "#807666",
        "outline-variant": "#d1c5b3",
        "surface-variant": "#e4e2df",

        /* Realm accent colors */
        "realm-asgard": "#b8922f",
        "realm-vanaheim": "#4a9fc4",
        "realm-midgard": "#4a9e4e",
        "realm-alfheim": "#9a6ab5",
        "realm-jotunheim": "#8a7060",
        "realm-nidavellir": "#c48a2e",
        "realm-muspelheim": "#c44d1a",
        "realm-niflheim": "#4a9a90",
        "realm-helheim": "#5a6a72",
      },
      fontFamily: {
        cinzel: ["var(--font-eb-garamond)", "serif"],
        "eb-garamond": ["var(--font-eb-garamond)", "serif"],
        "source-serif": ["var(--font-source-serif)", "Georgia", "serif"],
        "space-grotesk": ["var(--font-space-grotesk)", "sans-serif"],
        inconsolata: ["var(--font-inconsolata)", "monospace"],
        /* Landing page fonts */
        headline: ["Cinzel", "serif"],
        "body-landing": ["Source Sans 3", "sans-serif"],
        label: ["Inconsolata", "monospace"],
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
