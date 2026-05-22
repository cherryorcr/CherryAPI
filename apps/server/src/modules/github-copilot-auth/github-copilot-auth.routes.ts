import type { FastifyInstance } from "fastify";
import {
  cancelGitHubCopilotOAuth,
  completeGitHubCopilotOAuth,
  createGitHubCopilotAccountWithToken,
  getGitHubCopilotOAuthStatus,
  importGitHubCopilotAccountFromLocalVSCode,
  refreshGitHubCopilotAccount,
  startGitHubCopilotOAuth
} from "./github-copilot-auth.service";

export async function registerGitHubCopilotAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/admin/github-copilot/oauth/start", async (request) => startGitHubCopilotOAuth(request.body));
  app.get("/admin/github-copilot/oauth/status/:sessionId", async (request) =>
    getGitHubCopilotOAuthStatus((request.params as { sessionId: string }).sessionId)
  );
  app.post("/admin/github-copilot/oauth/complete", async (request) => completeGitHubCopilotOAuth(request.body));
  app.post("/admin/github-copilot/oauth/cancel", async (request) => cancelGitHubCopilotOAuth(request.body));
  app.post("/admin/github-copilot/token", async (request) => createGitHubCopilotAccountWithToken(request.body));
  app.post("/admin/github-copilot/local-vscode", async (request) => importGitHubCopilotAccountFromLocalVSCode(request.body));
  app.post("/admin/github-copilot/accounts/:accountId/refresh", async (request) =>
    refreshGitHubCopilotAccount((request.params as { accountId: string }).accountId)
  );
}
