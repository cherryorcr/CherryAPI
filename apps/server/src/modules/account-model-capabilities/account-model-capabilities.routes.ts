import type { FastifyInstance } from "fastify";
import { GatewayError } from "../../core/errors";
import {
  createAccountModelCapability,
  createModelRouteFromCapability,
  deleteAccountModelCapability,
  detectAccountModels,
  getAccountModelDetectionProgress,
  listAccountModelCapabilities,
  listAllAccountModelCapabilities,
  listAccountModels,
  testAccountModels,
  updateAccountModelCapability
} from "./account-model-capabilities.service";

export async function registerAccountModelCapabilityRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/account-model-capabilities", async () => listAllAccountModelCapabilities());
  app.get("/admin/accounts/:id/model-capabilities", async (request) =>
    listAccountModelCapabilities((request.params as { id: string }).id)
  );
  app.post("/admin/accounts/:id/detect-models", async (request) =>
    detectAccountModels((request.params as { id: string }).id, request.body)
  );
  app.post("/admin/accounts/:id/list-models", async (request) =>
    listAccountModels((request.params as { id: string }).id, request.body)
  );
  app.post("/admin/accounts/:id/test-models", async (request) =>
    testAccountModels((request.params as { id: string }).id, request.body)
  );
  app.get("/admin/accounts/:id/detect-models/progress/:requestId", async (request) => {
    const params = request.params as { id: string; requestId: string };
    const progress = getAccountModelDetectionProgress(params.requestId);
    if (!progress || (progress.accountId !== null && progress.accountId !== params.id)) {
      throw new GatewayError("NOT_FOUND", "Model detection progress not found", 404);
    }
    return progress;
  });
  app.post("/admin/accounts/:id/model-capabilities", async (request) =>
    createAccountModelCapability((request.params as { id: string }).id, request.body)
  );
  app.patch("/admin/account-model-capabilities/:id", async (request) =>
    updateAccountModelCapability((request.params as { id: string }).id, request.body)
  );
  app.post("/admin/account-model-capabilities/:id/create-model-route", async (request) =>
    createModelRouteFromCapability((request.params as { id: string }).id, request.body)
  );
  app.delete("/admin/account-model-capabilities/:id", async (request) =>
    deleteAccountModelCapability((request.params as { id: string }).id)
  );
}
