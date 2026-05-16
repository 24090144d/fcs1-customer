import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: 'class',
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── Existing tokens (sidebar, onboarding, etc.) ──────────────────────
        parchment: {
          50:  "#faf7f2",
          100: "#f5f0e8",
          200: "#ebe0cc",
          300: "#d9c8a8",
        },
        ink: {
          DEFAULT: "#1a1714",
          light:   "#3d3a35",
          muted:   "#6b6560",
        },
        gold: {
          DEFAULT: "#c4922a",
          light:   "#e4b84a",
          dark:    "#8a6318",
        },
        severity: {
          critical: "#b91c1c",
          high:     "#c2410c",
          medium:   "#ca8a04",
          low:      "#166534",
          info:     "#1e40af",
        },
        // ── Editorial Vintage accent colors ───────────────────────────────────
        orange: {
          DEFAULT: "#C55A10",
          light:   "#E07840",
          dark:    "#E87030",    // brighter for dark mode
          subtle:  "#FBE8DB",   // tint bg light
          "subtle-dark": "rgba(232,112,48,0.12)",
        },
        teal: {
          DEFAULT: "#0E7470",
          light:   "#3A9E9A",
          dark:    "#14A89E",    // brighter for dark mode
          subtle:  "#D8F0EE",   // tint bg light
          "subtle-dark": "rgba(20,168,158,0.12)",
        },
        // ── Dark-mode surfaces ────────────────────────────────────────────────
        charcoal: {
          950: "#141210",
          900: "#1A1916",
          850: "#1F1D1A",
          800: "#252220",
          750: "#2A2724",
          700: "#302D2A",
          600: "#3D3A36",
          500: "#4E4A46",
          400: "#6B6560",
        },
        // ── Warm cream scale (light-mode surfaces) ────────────────────────────
        cream: {
          50:  "#FAF7F2",
          100: "#F5F0E8",
          200: "#EDE8E0",
          300: "#D9C8A8",
          400: "#C4B090",
          500: "#A89070",
        },
      },
      fontFamily: {
        serif: ['Fraunces', 'Georgia', 'serif'],
        mono:  ['"JetBrains Mono"', 'Menlo', '"Courier New"', 'monospace'],
        sans:  ['Manrope', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        "vintage-grain":
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4'%3E%3Crect width='4' height='4' fill='%23f5f0e8'/%3E%3Ccircle cx='1' cy='1' r='0.4' fill='%23d9c8a8' opacity='0.3'/%3E%3C/svg%3E\")",
      },
    },
  },
  plugins: [],
};

export default config;
