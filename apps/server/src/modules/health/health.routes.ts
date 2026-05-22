import type { FastifyInstance } from "fastify";
import { getHealth } from "./health.service";

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/health", async () => getHealth());
  app.get("/health", async () => getHealth());
}
