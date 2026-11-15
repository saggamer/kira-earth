import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import cesium from "vite-plugin-cesium";
import tailwindcss from "@tailwindcss/vite";
// Optional override (e.g. EARTH_API=http://127.0.0.1:8001) for running a second API instance.
const apiTarget =
  (globalThis as { process?: { env: Record<string, string | undefined> } })
    .process?.env.EARTH_API ?? "http://127.0.0.1:8000";
export default defineConfig({
  plugins: [react(), cesium(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
