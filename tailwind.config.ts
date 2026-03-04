import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        /* ── Minimalist Surface Hierarchy ─── */
        surface: {
          DEFAULT: "#FAFBFC",
          dark: "#0F1117",
        },
        card: {
          DEFAULT: "#FFFFFF",
          dark: "#16181D",
          hover: "#F9FAFB",
          "hover-dark": "#1C1E24",
        },
        elevated: {
          DEFAULT: "#FFFFFF",
          dark: "#1C1E24",
        },
        /* ── Typography ─── */
        primary: {
          DEFAULT: "#18181B",
          dark: "#EAEAEC",
        },
        secondary: {
          DEFAULT: "#52525B",
          dark: "#A1A1AA",
        },
        muted: {
          DEFAULT: "#71717A",
          dark: "#52525B",
        },
        /* ── Borders — ultra-subtle ─── */
        border: {
          DEFAULT: "#E4E4E7",
          dark: "#27272A",
        },
        "border-hover": {
          DEFAULT: "#D4D4D8",
          dark: "#3F3F46",
        },
        /* ── Brand Accent — Indigo ─── */
        accent: {
          DEFAULT: "#6366F1",
          light: "#A5B4FC",
          dark: "#818CF8",
          muted: "rgba(99, 102, 241, 0.08)",
          "muted-dark": "rgba(129, 140, 248, 0.14)",
        },
        /* ── Semantic ─── */
        profit: {
          DEFAULT: "#10B981",
          bg: "#ECFDF5",
          "bg-dark": "rgba(16, 185, 129, 0.10)",
        },
        loss: {
          DEFAULT: "#EF4444",
          bg: "#FEF2F2",
          "bg-dark": "rgba(239, 68, 68, 0.10)",
        },
        warning: {
          DEFAULT: "#F59E0B",
          bg: "#FFFBEB",
          "bg-dark": "rgba(245, 158, 11, 0.10)",
        },
        info: {
          DEFAULT: "#3B82F6",
          bg: "#EFF6FF",
          "bg-dark": "rgba(59, 130, 246, 0.08)",
        },
        /* ── Sidebar ─── */
        sidebar: {
          DEFAULT: "#FFFFFF",
          dark: "#111318",
          active: "rgba(99, 102, 241, 0.06)",
          "active-dark": "rgba(99, 102, 241, 0.10)",
        },
      },
      borderRadius: {
        sm: "6px",
        DEFAULT: "8px",
        md: "10px",
        lg: "12px",
        xl: "16px",
      },
      boxShadow: {
        xs: "0 1px 2px rgba(0, 0, 0, 0.06)",
        soft: "0 1px 3px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.03)",
        card: "0 2px 6px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.03)",
        elevated: "0 4px 12px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.04)",
        modal: "0 8px 28px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(0, 0, 0, 0.06)",
      },
      fontFamily: {
        sans: ["var(--font-jakarta)", "var(--font-inter)", "Plus Jakarta Sans", "Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["var(--font-geist-mono)", "JetBrains Mono", "monospace"],
      },
      fontSize: {
        "2xs": ["0.625rem", { lineHeight: "0.875rem" }],
      },
      keyframes: {
        "pulse-green": {
          "0%": { backgroundColor: "transparent" },
          "50%": { backgroundColor: "rgba(16, 185, 129, 0.14)" },
          "100%": { backgroundColor: "transparent" },
        },
        "pulse-red": {
          "0%": { backgroundColor: "transparent" },
          "50%": { backgroundColor: "rgba(239, 68, 68, 0.14)" },
          "100%": { backgroundColor: "transparent" },
        },
        "slide-up": {
          "0%": { transform: "translateY(100%)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "slide-right": {
          "0%": { transform: "translateX(100%)", opacity: "0" },
          "100%": { transform: "translateX(0)", opacity: "1" },
        },
        "slide-down": {
          "0%": { transform: "translateY(-8px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "scale-in": {
          "0%": { transform: "scale(0.97)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        "pulse-green": "pulse-green 0.5s ease-out",
        "pulse-red": "pulse-red 0.5s ease-out",
        "slide-up": "slide-up 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-right": "slide-right 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-down": "slide-down 0.2s ease-out",
        "fade-in": "fade-in 0.15s ease-out",
        "scale-in": "scale-in 0.2s ease-out",
        shimmer: "shimmer 1.5s ease-in-out infinite",
      },
      spacing: {
        "4.5": "1.125rem",
        "18": "4.5rem",
      },
    },
  },
  plugins: [],
};
export default config;
