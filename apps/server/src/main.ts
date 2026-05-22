import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { initializeDatabase } from "./database/init";
import { env } from "./utils/env";
import { GatewayError, toSafeErrorMessage } from "./core/errors";
import { requireAdmin } from "./core/auth";
import { registerAccountModelCapabilityRoutes } from "./modules/account-model-capabilities/account-model-capabilities.routes";
import { registerAccountRoutes } from "./modules/accounts/accounts.routes";
import { registerApiKeyRoutes } from "./modules/api-keys/api-keys.routes";
import { registerChannelRoutes } from "./modules/channels/channels.routes";
import { registerCodexAuthRoutes } from "./modules/codex-auth/codex-auth.routes";
import { registerGroupRoutes } from "./modules/groups/groups.routes";
import { registerGitHubCopilotAuthRoutes } from "./modules/github-copilot-auth/github-copilot-auth.routes";
import { registerHealthRoutes } from "./modules/health/health.routes";
import { registerDashboardRoutes } from "./modules/dashboard/dashboard.routes";
import { registerModelRouteRoutes } from "./modules/model-routes/model-routes.routes";
import { registerModelRoutes } from "./modules/models/models.routes";
import { registerPlatformRoutes } from "./modules/platforms/platforms.routes";
import { registerProxyRoutes } from "./modules/proxy/proxy.routes";
import { registerTestRoutes } from "./modules/test/test.routes";
import { registerUsageRoutes } from "./modules/usage/usage.routes";
import { registerV1Routes } from "./routes/v1.routes";

function existingWebDistDir(): string | null {
  const candidates = [
    env.WEB_DIST_DIR,
    path.resolve(process.cwd(), "apps/web/dist"),
    path.resolve(process.cwd(), "../web/dist"),
    path.resolve(__dirname, "../../web/dist")
  ]
    .filter((candidate): candidate is string => Boolean(candidate))
    .map((candidate) => (path.isAbsolute(candidate) ? candidate : path.resolve(process.cwd(), candidate)));

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "index.html"))) {
      return candidate;
    }
  }
  return null;
}

function requestPath(url: string): string {
  try {
    return new URL(url, "http://cherryapi.local").pathname;
  } catch {
    return url;
  }
}

async function registerWebAssets(app: FastifyInstance): Promise<void> {
  const webDistDir = existingWebDistDir();
  if (!webDistDir) {
    return;
  }

  const assetsDir = path.join(webDistDir, "assets");
  if (fs.existsSync(assetsDir)) {
    await app.register(fastifyStatic, {
      root: assetsDir,
      prefix: "/assets/",
      decorateReply: false
    });
  }

  const brandDir = path.join(webDistDir, "brand");
  if (fs.existsSync(brandDir)) {
    await app.register(fastifyStatic, {
      root: brandDir,
      prefix: "/brand/",
      decorateReply: false
    });
  }

  const indexHtml = await fs.promises.readFile(path.join(webDistDir, "index.html"), "utf8");
  const sendIndex = async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.type("text/html; charset=utf-8");
    return reply.send(indexHtml);
  };

  app.get("/", sendIndex);
  app.get("/index.html", sendIndex);
  app.setNotFoundHandler(async (request, reply) => {
    const pathname = requestPath(request.url);
    if (request.method === "GET" && !pathname.startsWith("/admin") && !pathname.startsWith("/v1") && !pathname.startsWith("/assets")) {
      return sendIndex(request, reply);
    }

    return reply.status(404).send({
      error: {
        message: "Route not found",
        type: "cherryapi_error",
        code: "NOT_FOUND"
      }
    });
  });
}

async function buildServer() {
  await initializeDatabase();

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: ["req.headers.authorization", "request.headers.authorization"]
    }
  });

  await app.register(cors, {
    origin: true,
    credentials: true
  });

  app.addHook("preHandler", async (request) => {
    if (request.url.startsWith("/admin")) {
      requireAdmin(request);
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    const parsedError =
      error && typeof error === "object"
        ? (error as { statusCode?: number; message?: string })
        : { message: String(error) };
    const isJsonParseError =
      parsedError.statusCode === 400 &&
      typeof parsedError.message === "string" &&
      parsedError.message.includes("Body is not valid JSON");
    const statusCode = isJsonParseError ? 400 : error instanceof GatewayError ? error.statusCode : 500;
    const code = isJsonParseError ? "VALIDATION_ERROR" : error instanceof GatewayError ? error.code : "UPSTREAM_ERROR";
    reply.status(statusCode).send({
      error: {
        message: toSafeErrorMessage(error),
        type: "cherryapi_error",
        code
      }
    });
  });

  await registerHealthRoutes(app);
  await registerDashboardRoutes(app);
  await registerChannelRoutes(app);
  await registerAccountRoutes(app);
  await registerCodexAuthRoutes(app);
  await registerGitHubCopilotAuthRoutes(app);
  await registerPlatformRoutes(app);
  await registerProxyRoutes(app);
  await registerAccountModelCapabilityRoutes(app);
  await registerModelRoutes(app);
  await registerModelRouteRoutes(app);
  await registerGroupRoutes(app);
  await registerApiKeyRoutes(app);
  await registerTestRoutes(app);
  await registerUsageRoutes(app);
  await registerV1Routes(app);
  await registerWebAssets(app);

  return app;
}

buildServer()
  .then((app) =>
    app.listen({ port: env.PORT, host: "0.0.0.0" }).then((address) => {
      app.log.info(`CherryAPI server listening at ${address}`);
    })
  )
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
