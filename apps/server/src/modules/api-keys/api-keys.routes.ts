import type { FastifyInstance } from "fastify";
import { createApiKey, deleteApiKey, listApiKeys, updateApiKey } from "./api-keys.service";

export async function registerApiKeyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/api-keys", async () => listApiKeys());
  app.post("/admin/api-keys", async (request) => createApiKey(request.body));
  app.patch("/admin/api-keys/:id", async (request) =>
    updateApiKey((request.params as { id: string }).id, request.body)
  );
  app.delete("/admin/api-keys/:id", async (request) => deleteApiKey((request.params as { id: string }).id));
}
