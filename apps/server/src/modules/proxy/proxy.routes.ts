import type { FastifyInstance } from "fastify";
import { detectProxies, getProxyConfig, putProxyConfig } from "./proxy.service";

export async function registerProxyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/admin/proxy/config", async () => getProxyConfig());
  app.put("/admin/proxy/config", async (request) => putProxyConfig(request.body));
  app.post("/admin/proxy/detect", async (request) => detectProxies(request.body));
}
