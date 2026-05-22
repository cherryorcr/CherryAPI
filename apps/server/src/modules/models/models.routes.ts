import type { FastifyInstance } from "fastify";
import { createModel, deleteModel, getModel, listModels, updateModel } from "./models.service";

export async function registerModelRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/models", async () => listModels());
  app.post("/admin/models", async (request) => createModel(request.body));
  app.get("/admin/models/:id", async (request) => getModel((request.params as { id: string }).id));
  app.patch("/admin/models/:id", async (request) =>
    updateModel((request.params as { id: string }).id, request.body)
  );
  app.delete("/admin/models/:id", async (request) => deleteModel((request.params as { id: string }).id));
}
