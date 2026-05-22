import type { FastifyInstance } from "fastify";
import {
  createModelRoute,
  deleteModelRoute,
  listModelRoutes,
  updateModelRoute
} from "./model-routes.service";

export async function registerModelRouteRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/model-routes", async () => listModelRoutes());
  app.post("/admin/model-routes", async (request) => createModelRoute(request.body));
  app.patch("/admin/model-routes/:id", async (request) =>
    updateModelRoute((request.params as { id: string }).id, request.body)
  );
  app.delete("/admin/model-routes/:id", async (request) =>
    deleteModelRoute((request.params as { id: string }).id)
  );
}
