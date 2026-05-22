import type { FastifyInstance } from "fastify";
import { listUsageLogs } from "./usage.service";

export async function registerUsageRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/usage-logs", async (request) => listUsageLogs(request.query as Record<string, unknown>));
}
