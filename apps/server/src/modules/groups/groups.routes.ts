import type { FastifyInstance } from "fastify";
import {
  buildGroupModelCandidates,
  createGroup,
  deleteGroup,
  getGroupChannelPermissions,
  getGroupEffectiveModels,
  getGroupModelBindings,
  getGroupModelPermissions,
  getGroupAccountRules,
  listGroups,
  putGroupAccountRules,
  putGroupChannelPermissions,
  putGroupModelBindings,
  putGroupModelPermissions,
  updateGroup
} from "./groups.service";

export async function registerGroupRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/groups", async () => listGroups());
  app.post("/admin/groups", async (request) => createGroup(request.body));
  app.patch("/admin/groups/:id", async (request) => updateGroup((request.params as { id: string }).id, request.body));
  app.delete("/admin/groups/:id", async (request) => deleteGroup((request.params as { id: string }).id));

  app.get("/admin/groups/:id/model-permissions", async (request) =>
    getGroupModelPermissions((request.params as { id: string }).id)
  );
  app.put("/admin/groups/:id/model-permissions", async (request) =>
    putGroupModelPermissions((request.params as { id: string }).id, request.body)
  );

  app.get("/admin/groups/:id/channel-permissions", async (request) =>
    getGroupChannelPermissions((request.params as { id: string }).id)
  );
  app.put("/admin/groups/:id/channel-permissions", async (request) =>
    putGroupChannelPermissions((request.params as { id: string }).id, request.body)
  );

  app.get("/admin/groups/:id/account-rules", async (request) =>
    getGroupAccountRules((request.params as { id: string }).id)
  );
  app.put("/admin/groups/:id/account-rules", async (request) =>
    putGroupAccountRules((request.params as { id: string }).id, request.body)
  );

  app.get("/admin/groups/:id/effective-models", async (request) =>
    getGroupEffectiveModels((request.params as { id: string }).id)
  );
  app.get("/admin/groups/:id/model-candidates", async (request) =>
    buildGroupModelCandidates((request.params as { id: string }).id)
  );
  app.get("/admin/groups/:id/model-bindings", async (request) =>
    getGroupModelBindings((request.params as { id: string }).id)
  );
  app.put("/admin/groups/:id/model-bindings", async (request) =>
    putGroupModelBindings((request.params as { id: string }).id, request.body)
  );
}
