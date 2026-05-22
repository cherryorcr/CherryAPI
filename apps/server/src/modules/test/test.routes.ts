import type { FastifyInstance } from "fastify";
import { runAdminChatCompletionTest } from "./test.service";

export async function registerTestRoutes(app: FastifyInstance): Promise<void> {
  app.post("/admin/test/chat-completion", async (request) => runAdminChatCompletionTest(request.body));
}
