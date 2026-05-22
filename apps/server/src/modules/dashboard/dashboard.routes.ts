import type { FastifyInstance } from "fastify";
import { getChannelHealth, getDashboardStats } from "./dashboard.service";

export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/dashboard/stats", async () => getDashboardStats());
  app.get("/admin/dashboard/channel-health", async () => getChannelHealth());
}
