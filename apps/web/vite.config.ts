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
    port: 5173,
    proxy: {
      "/api": target,
      "/healthz": target,
      "/ws": { target: target.replace(/^http/, "ws"), ws: true },
    },
  },
  build: { target: "es2020", sourcemap: true },
});
