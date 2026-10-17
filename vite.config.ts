import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // Read the optional bearer token from Stripe Projects' local .env on the
  // server only; do not expose it through Vite's client env prefix.
  const serverToken = loadEnv(mode, ".", "").GRID_PRIX_EVOLVE_TOKEN;
  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      proxy: {
        "/api": {
          target: "http://127.0.0.1:8787",
          configure(proxy) {
            if (serverToken) {
              proxy.on("proxyReq", (request) => {
                request.setHeader("Authorization", `Bearer ${serverToken}`);
              });
            }
          },
        },
      },
    },
  };
});
