import type { Config } from "tailwindcss";
import daisyui from "daisyui";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      boxShadow: {
        glow: "0 0 0 1px rgba(100, 210, 255, 0.12), 0 24px 80px rgba(0, 0, 0, 0.45)",
      },
      backgroundImage: {
        "grid-fade":
          "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)",
      },
    },
  },
  plugins: [daisyui],
  daisyui: {
    themes: [
      {
        atelier: {
          primary: "#7cc4ff",
          secondary: "#94a3b8",
          accent: "#7ee081",
          neutral: "#0f172a",
          "base-100": "#0b1220",
          info: "#7cc4ff",
          success: "#7ee081",
          warning: "#eab308",
          error: "#ef4444",
        },
      },
    ],
  },
};

export default config;
