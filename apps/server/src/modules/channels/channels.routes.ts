import type { FastifyInstance } from "fastify";
import { createChannel, deleteChannel, getChannel, listChannels, updateChannel } from "./channels.service";

export async function registerChannelRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/channels", async () => listChannels());
  app.post("/admin/channels", async (request) => createChannel(request.body));
  app.get("/admin/channels/:id", async (request) => getChannel((request.params as { id: string }).id));
  app.patch("/admin/channels/:id", async (request) =>
    updateChannel((request.params as { id: string }).id, request.body)
  );
  app.delete("/admin/channels/:id", async (request) => deleteChannel((request.params as { id: string }).id));
}
