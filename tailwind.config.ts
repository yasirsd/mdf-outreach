import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          orange: "#F36B21",
          orangeSoft: "#F8894C",
          charcoal: "#151515",
          ivory: "#FAF8F4",
          canvas: "#F2EFE9",
          border: "#E6E1D9",
          borderStrong: "#D9D3C6",
          chilli: "#A62921",
          muted: "#737373",
          subtle: "#8C8579",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        serif: ["Fraunces", "ui-serif", "Georgia", "serif"],
      },
      fontSize: {
        // Refined type scale
        "display-2xl": ["4.5rem", { lineHeight: "1.05", letterSpacing: "-0.03em" }],
        "display-xl": ["3.5rem", { lineHeight: "1.05", letterSpacing: "-0.03em" }],
        "display-lg": ["2.5rem", { lineHeight: "1.1", letterSpacing: "-0.025em" }],
        "display-md": ["2rem", { lineHeight: "1.15", letterSpacing: "-0.02em" }],
      },
      borderRadius: {
        xl2: "14px",
      },
      boxShadow: {
        soft: "0 1px 2px rgba(21,21,21,0.04), 0 1px 3px rgba(21,21,21,0.03)",
        card: "0 1px 0 rgba(21,21,21,0.02), 0 4px 24px -12px rgba(21,21,21,0.08)",
        panel: "0 20px 60px -20px rgba(21,21,21,0.18)",
      },
      transitionDuration: {
        "250": "250ms",
      },
    },
  },
  plugins: [],
};

export default config;
