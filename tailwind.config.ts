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
          DEFAULT: "#F7F8FA",
          dark: "#05070A",
        },
        card: {
          DEFAULT: "#FFFFFF",
          dark: "#0A0E14",
          hover: "#F9FAFB",
          "hover-dark": "#101720",
        },
        elevated: {
          DEFAULT: "#FFFFFF",
          dark: "#101720",
        },
        /* ── Typography ─── */
        primary: {
          DEFAULT: "#18181B",
          dark: "#F3F4F6",
        },
        secondary: {
          DEFAULT: "#52525B",
          dark: "#9CA3AF",
        },
        muted: {
          DEFAULT: "#71717A",
          dark: "#64748B",
        },
        /* ── Borders — ultra-subtle ─── */
        border: {
          DEFAULT: "#E4E4E7",
          dark: "#1F2937",
        },
        "border-hover": {
          DEFAULT: "#D4D4D8",
          dark: "#334155",
        },
        /* ── Brand Accent — Terminal Amber ─── */
        accent: {
          DEFAULT: "#F5B301",
          light: "#FDE68A",
          dark: "#FBBF24",
          muted: "rgba(245, 179, 1, 0.10)",
          "muted-dark": "rgba(245, 179, 1, 0.14)",
        },
        /* ── Semantic ─── */
        profit: {
          DEFAULT: "#00D084",
          bg: "#ECFDF5",
          "bg-dark": "rgba(0, 208, 132, 0.10)",
        },
        loss: {
          DEFAULT: "#FF4D4F",
          bg: "#FEF2F2",
          "bg-dark": "rgba(255, 77, 79, 0.10)",
        },
        warning: {
          DEFAULT: "#F59E0B",
          bg: "#FFFBEB",
          "bg-dark": "rgba(245, 158, 11, 0.10)",
        },
        info: {
          DEFAULT: "#38BDF8",
          bg: "#EFF6FF",
          "bg-dark": "rgba(56, 189, 248, 0.08)",
        },
        /* ── Sidebar ─── */
        sidebar: {
          DEFAULT: "#FFFFFF",
          dark: "#070A0F",
          active: "rgba(245, 179, 1, 0.08)",
          "active-dark": "rgba(245, 179, 1, 0.12)",
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
