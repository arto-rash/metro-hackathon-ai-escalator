import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        risk: {
          low: "#10b981",
          mid: "#f59e0b",
          high: "#ef4444",
        },
      },
    },
  },
  plugins: [],
};
export default config;
