import type { FastifyInstance } from "fastify";
import {
  checkAccountQuota,
  clearAccountError,
  createAccount,
  createAccountModelAlias,
  deleteAccount,
  deleteAccountModelAlias,
  disableAccount,
  enableAccount,
  getAccount,
  listAccounts,
  listAccountModelAliases,
  resetAccountConcurrency,
  updateAccount,
  updateAccountModelAlias
} from "./accounts.service";

export async function registerAccountRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/accounts", async () => listAccounts());
  app.post("/admin/accounts", async (request) => createAccount(request.body));
  app.get("/admin/accounts/:id", async (request) => getAccount((request.params as { id: string }).id));
  app.patch("/admin/accounts/:id", async (request) =>
    updateAccount((request.params as { id: string }).id, request.body)
  );
  app.patch("/admin/accounts/:id/clear-error", async (request) =>
    clearAccountError((request.params as { id: string }).id)
  );
  app.patch("/admin/accounts/:id/reset-concurrency", async (request) =>
    resetAccountConcurrency((request.params as { id: string }).id)
  );
  app.patch("/admin/accounts/:id/enable", async (request) =>
    enableAccount((request.params as { id: string }).id)
  );
  app.patch("/admin/accounts/:id/disable", async (request) =>
    disableAccount((request.params as { id: string }).id)
  );
  app.post("/admin/accounts/:id/check-quota", async (request) =>
    checkAccountQuota((request.params as { id: string }).id, request.body)
  );
  app.get("/admin/accounts/:id/model-aliases", async (request) =>
    listAccountModelAliases((request.params as { id: string }).id)
  );
  app.post("/admin/accounts/:id/model-aliases", async (request) =>
    createAccountModelAlias((request.params as { id: string }).id, request.body)
  );
  app.put("/admin/accounts/:id/model-aliases/:aliasId", async (request) => {
    const params = request.params as { id: string; aliasId: string };
    return updateAccountModelAlias(params.id, params.aliasId, request.body);
  });
  app.delete("/admin/accounts/:id/model-aliases/:aliasId", async (request) => {
    const params = request.params as { id: string; aliasId: string };
    return deleteAccountModelAlias(params.id, params.aliasId);
  });
  app.delete("/admin/accounts/:id", async (request) => deleteAccount((request.params as { id: string }).id));
}
