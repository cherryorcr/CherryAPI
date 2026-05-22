import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const rootEnvDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootEnvDir, "");
  const apiTarget = process.env.VITE_API_TARGET || env.VITE_API_TARGET || "http://localhost:3000";

  return {
    envDir: rootEnvDir,
    plugins: [react()],
    server: {
      proxy: {
        "/admin": apiTarget,
        "/v1": apiTarget
      }
    }
  };
});
