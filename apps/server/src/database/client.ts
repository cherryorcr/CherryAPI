import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { env } from "../utils/env";
import * as schema from "./schema";

function resolveDatabasePath(databaseUrl: string): string {
  if (!databaseUrl.startsWith("file:")) {
    throw new Error("Only file: SQLite DATABASE_URL values are supported in v1");
  }

  const rawPath = databaseUrl.replace(/^file:/, "");
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
}

const dbFile = resolveDatabasePath(env.DATABASE_URL);
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

export const client = createClient({
  url: `file:${dbFile}`
});

export const db = drizzle(client, { schema });
export { dbFile };
