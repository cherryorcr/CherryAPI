import type { FastifyInstance } from "fastify";
import {
  createPlatformAccount,
  getPlatform,
  listPlatformAccounts,
  listPlatformChannels,
  listPlatformSummaries,
  listPlatforms
} from "./platforms.service";

export async function registerPlatformRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/platforms", async () => listPlatforms());
  app.get("/admin/platforms/summary", async () => listPlatformSummaries());
  app.get("/admin/platforms/:platformId", async (request) =>
    getPlatform((request.params as { platformId: string }).platformId)
  );
  app.get("/admin/platforms/:platformId/accounts", async (request) =>
    listPlatformAccounts((request.params as { platformId: string }).platformId)
  );
  app.post("/admin/platforms/:platformId/accounts", async (request) =>
    createPlatformAccount((request.params as { platformId: string }).platformId, request.body)
  );
  app.get("/admin/platforms/:platformId/channels", async (request) =>
    listPlatformChannels((request.params as { platformId: string }).platformId)
  );
}
