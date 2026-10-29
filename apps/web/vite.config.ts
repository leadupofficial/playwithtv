import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

// HTTPS=1 serves the dev site over a self-signed certificate: phones then allow motion sensors (tilt steering).
const https = process.env.HTTPS === "1";
const target = process.env.HUB_URL ?? "http://localhost:8080";

export default defineConfig({
  plugins: [react(), ...(https ? [basicSsl()] : [])],
  server: {
    host: true,
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: {
      "/api": target,
      "/healthz": target,
      "/ws": { target: target.replace(/^http/, "ws"), ws: true },
    },
  },
  // Old Android TV WebViews are real customers: a 2019 HiDPT set ships Chrome 66, which cannot parse ?. or ??.
  // Syntax is lowered to it here; the few newer built-ins we use get small polyfills (src/polyfills.ts).
  build: { target: ["chrome66", "safari12", "firefox68"], cssTarget: ["chrome66", "safari12"], sourcemap: true },
});
