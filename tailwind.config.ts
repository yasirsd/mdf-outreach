import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // MDF Outreach — dark-first application palette.
        // Kept flat, semantic, and minimal. Business colors sit under `brand`.
        app: {
          bg: "#08090A",
          sidebar: "#0C0D0F",
          surface: "#111216",
          elevated: "#16171B",
          hover: "#1A1B20",
          border: "rgba(255,255,255,0.08)",
          borderStrong: "rgba(255,255,255,0.13)",
        },
        text: {
          primary: "#F5F5F4",
          secondary: "#A1A1AA",
          muted: "#71717A",
          faint: "#52525B",
        },
        brand: {
          orange: "#F36B21",
          orangeSoft: "#F8894C",
          orangeMuted: "#B44C11",
          chilli: "#EF6C5C",
          gold: "#E6A54B",
          leaf: "#3F6B3B",
          ruby: "#7B1F2E",
          apple: "#B8352C",
          // Legacy tokens re-mapped to the dark-first tokens so utility
          // classes like `text-brand-charcoal` / `bg-brand-canvas` /
          // `border-brand-border` render correctly in the new theme.
          // These aliases will be phased out as screens are individually
          // migrated onto the semantic `text-text-*` / `bg-app-*` tokens.
          charcoal: "#F5F5F4", // maps to text.primary — legacy "text on light" now means "primary text on dark"
          ivory: "#111216",    // legacy "warm ivory bg" now means "dark app surface"
          canvas: "#16171B",   // legacy "surface" now means "elevated dark surface"
          border: "rgba(255,255,255,0.08)",
          borderStrong: "rgba(255,255,255,0.13)",
          muted: "#71717A",
          subtle: "#A1A1AA",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-geist-sans)",
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "var(--font-geist-mono)",
          "ui-monospace",
          "Menlo",
          "Monaco",
          "monospace",
        ],
        serif: ["Fraunces", "ui-serif", "Georgia", "serif"],
      },
      fontSize: {
        "display-2xl": ["4rem", { lineHeight: "1.05", letterSpacing: "-0.03em" }],
        "display-xl": ["3rem", { lineHeight: "1.05", letterSpacing: "-0.025em" }],
        "display-lg": ["2.25rem", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
        "display-md": ["1.75rem", { lineHeight: "1.15", letterSpacing: "-0.015em" }],
      },
      borderRadius: {
        xl2: "12px",
      },
      boxShadow: {
        soft: "0 1px 0 rgba(0,0,0,0.4)",
        card: "0 1px 0 rgba(0,0,0,0.4), 0 8px 24px -12px rgba(0,0,0,0.5)",
        panel: "0 24px 60px -24px rgba(0,0,0,0.6)",
        focusRing: "0 0 0 3px rgba(243,107,33,0.35)",
      },
      transitionDuration: {
        "180": "180ms",
        "220": "220ms",
      },
      keyframes: {
        reveal: {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        reveal: "reveal 220ms ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
