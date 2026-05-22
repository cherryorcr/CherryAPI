import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PORT: Number(process.env.PORT ?? 3000),
  DATABASE_URL: requireEnv("DATABASE_URL", "file:./data/cherryapi.sqlite"),
  ADMIN_TOKEN: requireEnv("ADMIN_TOKEN", "change-me"),
  ENCRYPTION_KEY: requireEnv("ENCRYPTION_KEY", "change-me-32-bytes-minimum"),
  LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
  WEB_DIST_DIR: process.env.WEB_DIST_DIR?.trim() || null
};
