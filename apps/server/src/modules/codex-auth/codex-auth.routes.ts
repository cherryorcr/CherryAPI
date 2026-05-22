import type { FastifyInstance } from "fastify";
import {
  cancelCodexOAuth,
  completeCodexOAuth,
  getCodexOAuthStatus,
  startCodexOAuth
} from "./codex-auth.service";

export async function registerCodexAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/admin/codex/oauth/start", async (request) => startCodexOAuth(request.body));
  app.get("/admin/codex/oauth/status/:sessionId", async (request) =>
    getCodexOAuthStatus((request.params as { sessionId: string }).sessionId)
  );
  app.post("/admin/codex/oauth/complete", async (request) => completeCodexOAuth(request.body));
  app.post("/admin/codex/oauth/cancel", async (request) => cancelCodexOAuth(request.body));
}
