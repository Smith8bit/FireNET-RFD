/** @type {import('tailwindcss').Config} */
//
// Design tokens ported from the web app (web/src/index.css `@theme`).
// Web uses Tailwind v4 (CSS-first config); NativeWind 4 uses Tailwind v3, so
// the tokens are translated here as concrete values instead of CSS variables.
// Keep this in sync with the web theme when colors change.
//
module.exports = {
  // NOTE: update this if you add component files outside ./src
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: "#E0E0E0",
        foreground: "#FFFFFF",
        brand: "#D23400",
        flame: "#FF4000",
        "flame-light": "#ffebe5",

        card: { DEFAULT: "hsl(0 0% 100%)", foreground: "#1A1A1A" },
        popover: { DEFAULT: "hsl(0 0% 100%)", foreground: "#1A1A1A" },
        primary: { DEFAULT: "#FF4000", foreground: "hsl(0 0% 100%)" },
        secondary: { DEFAULT: "#FF6633", foreground: "#1A1A1A" },
        muted: { DEFAULT: "hsl(50 14% 88%)", foreground: "#525252" },
        accent: { DEFAULT: "#292929", foreground: "hsl(0 0% 100%)" },
        destructive: { DEFAULT: "hsl(0 72% 45%)", foreground: "hsl(0 0% 100%)" },
        success: { DEFAULT: "hsl(142 60% 35%)", foreground: "hsl(0 0% 100%)" },
        warning: { DEFAULT: "hsl(38 92% 50%)", foreground: "hsl(26 80% 14%)" },

        border: "hsl(50 12% 82%)",
        input: "hsl(50 12% 82%)",
        ring: "#FF4000",
      },
      borderRadius: {
        // Mirrors web `--radius: 0.75rem` (rem = 16px in NativeWind).
        sm: "0.5rem", // 8px
        md: "0.625rem", // 10px
        lg: "0.75rem", // 12px
      },
      fontFamily: {
        // Loaded in src/app/_layout.tsx via expo-font. With custom RN fonts the
        // `font-semibold`/`font-bold` weight utilities do NOT switch the font
        // face — use the explicit weight tokens below to get the right family.
        // Kanit = body (web --font-sans), Sarabun = headings (web --font-head).
        sans: ["Kanit_400Regular"],
        "sans-medium": ["Kanit_500Medium"],
        "sans-semibold": ["Kanit_600SemiBold"],
        "sans-bold": ["Kanit_700Bold"],
        head: ["Sarabun_400Regular"],
        "head-medium": ["Sarabun_500Medium"],
        "head-semibold": ["Sarabun_600SemiBold"],
        "head-bold": ["Sarabun_700Bold"],
      },
    },
  },
  plugins: [],
};
