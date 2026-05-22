import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import type { OpenAIChatCompletionChunk, OpenAIChatCompletionRequest } from "@cherryapi/shared";
import { authenticateApiKey } from "../core/auth";
import { accountScheduler } from "../core/account-scheduler";
import { GatewayError, toSafeErrorMessage } from "../core/errors";
import { routeResolver, type ResolvedRoute } from "../core/route-resolver";
import { encodeSseData } from "../core/sse";
import { writeUsageLog } from "../core/usage-logger";
import { listExposedPublicModelNames } from "../core/permissions";
import type { AdapterContext } from "../adapters/types";

function validateChatRequest(body: unknown): OpenAIChatCompletionRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new GatewayError("VALIDATION_ERROR", "Request body must be an object", 400);
  }

  const input = body as Record<string, unknown>;
  if (typeof input.model !== "string" || input.model.length === 0) {
    throw new GatewayError("VALIDATION_ERROR", "model is required", 400);
  }

  if (!Array.isArray(input.messages) || input.messages.length === 0) {
    throw new GatewayError("VALIDATION_ERROR", "messages must be a non-empty array", 400);
  }

  return input as unknown as OpenAIChatCompletionRequest;
}

function usageFromChunk(chunk: OpenAIChatCompletionChunk): {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
} {
  return {
    promptTokens: chunk.usage?.prompt_tokens,
    completionTokens: chunk.usage?.completion_tokens,
    totalTokens: chunk.usage?.total_tokens
  };
}

async function logSuccess(
  requestId: string,
  startedAt: number,
  context: AdapterContext,
  requestModel: string,
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
): Promise<void> {
  await writeUsageLog({
    requestId,
    apiKeyId: context.apiKey.id,
    apiKeyPrefix: context.apiKey.keyPrefix,
    groupId: context.group.id,
    modelId: context.model.id.startsWith("gmb:") ? undefined : context.model.id,
    channelId: context.channel.id,
    accountId: context.account.id,
    requestModel,
    upstreamModel: context.upstreamModelName,
    status: "success",
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    latencyMs: Date.now() - startedAt
  });
}

async function logError(
  requestId: string,
  startedAt: number,
  requestModel: string,
  error: unknown,
  resolved?: ResolvedRoute,
  context?: AdapterContext
): Promise<void> {
  await writeUsageLog({
    requestId,
    apiKeyId: context?.apiKey.id,
    apiKeyPrefix: context?.apiKey.keyPrefix,
    groupId: context?.group.id,
    modelId: resolved?.model.id.startsWith("gmb:") ? undefined : resolved?.model.id,
    channelId: resolved?.channel.id,
    accountId: resolved?.account.id,
    requestModel,
    upstreamModel: resolved?.upstreamModelName,
    status: "failed",
    latencyMs: Date.now() - startedAt,
    errorCode: error instanceof GatewayError ? error.code : "UPSTREAM_ERROR",
    errorMessage: toSafeErrorMessage(error)
  });
}

function contextFromResolved(
  requestId: string,
  apiKey: AdapterContext["apiKey"],
  group: AdapterContext["group"],
  resolved: ResolvedRoute,
  stream: boolean
): AdapterContext {
  return {
    requestId,
    apiKey,
    group,
    model: resolved.model,
    route: resolved.route,
    channel: resolved.channel,
    account: resolved.account,
    upstreamModelName: resolved.upstreamModelName,
    stream
  };
}

function shouldRetryResolvedError(error: unknown): boolean {
  if (!(error instanceof GatewayError)) {
    return true;
  }
  return error.code !== "VALIDATION_ERROR" && error.code !== "NOT_IMPLEMENTED";
}

function exhaustedRouteError(requestModel: string, attempts: number, lastError: unknown): GatewayError {
  return new GatewayError(
    "UPSTREAM_ERROR",
    `All ${attempts} available account attempt${attempts === 1 ? "" : "s"} failed for model "${requestModel}". Last error: ${toSafeErrorMessage(lastError)}`,
    502
  );
}

export async function registerV1Routes(app: FastifyInstance): Promise<void> {
  app.get("/v1/models", async (request) => {
    const { group } = await authenticateApiKey(request);
    const allowedModels = await listExposedPublicModelNames(group);
    return {
      object: "list",
      data: allowedModels.map((model) => ({
        id: model,
        object: "model",
        created: 0,
        owned_by: "cherryapi"
      }))
    };
  });

  app.post("/v1/chat/completions", async (request, reply) => {
    const startedAt = Date.now();
    const requestId = request.id;
    const input = validateChatRequest(request.body);
    let resolved: ResolvedRoute | undefined;
    let context: AdapterContext | undefined;
    const failedAccountIds = new Set<string>();
    let lastResolvedError: unknown;
    let errorAlreadyLogged = false;
    let attempts = 0;

    try {
      const { apiKey, group } = await authenticateApiKey(request);

      while (true) {
        try {
          resolved = await routeResolver.resolve(apiKey, group, input, { excludeAccountIds: failedAccountIds });
        } catch (error) {
          if (lastResolvedError) {
            throw exhaustedRouteError(input.model, attempts, lastResolvedError);
          }
          throw error;
        }

        attempts += 1;
        context = contextFromResolved(requestId, apiKey, group, resolved, Boolean(input.stream));

        try {
          const upstreamRequest = await resolved.adapter.transformRequest(input, context);
          const upstreamResponse = await resolved.adapter.send(upstreamRequest, resolved.account, context);

          if (input.stream) {
            const transformStream = resolved.adapter.transformStream;
            if (!transformStream) {
              throw new GatewayError("NOT_IMPLEMENTED", "Adapter does not support streaming", 501);
            }

            const streamResolved = resolved;
            const streamContext = context;
            const upstreamChunks = transformStream.call(streamResolved.adapter, upstreamResponse, streamContext);
            const stream = async function* (): AsyncIterable<string> {
              let usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } = {};
              try {
                for await (const chunk of upstreamChunks) {
                  usage = { ...usage, ...usageFromChunk(chunk) };
                  yield encodeSseData(chunk);
                }
                yield encodeSseData("[DONE]");
                await logSuccess(requestId, startedAt, streamContext, input.model, usage);
              } catch (error) {
                yield encodeSseData({
                  error: {
                    message: toSafeErrorMessage(error),
                    type: "cherryapi_stream_error",
                    code: error instanceof GatewayError ? error.code : "UPSTREAM_ERROR"
                  }
                });
                yield encodeSseData("[DONE]");
                await logError(requestId, startedAt, input.model, error, streamResolved, streamContext);
                await accountScheduler.recordFailure(streamResolved.account.id, toSafeErrorMessage(error));
              } finally {
                await accountScheduler.release(streamResolved.account.id);
              }
            };

            reply.header("content-type", "text/event-stream; charset=utf-8");
            reply.header("cache-control", "no-cache, no-transform");
            reply.header("connection", "keep-alive");
            return reply.send(Readable.from(stream()));
          }

          const output = await resolved.adapter.transformResponse(upstreamResponse, context);
          const usage = {
            promptTokens: output.usage?.prompt_tokens,
            completionTokens: output.usage?.completion_tokens,
            totalTokens: output.usage?.total_tokens
          };
          await logSuccess(requestId, startedAt, context, input.model, usage);
          await accountScheduler.release(resolved.account.id);
          return output;
        } catch (error) {
          await accountScheduler.release(resolved.account.id);
          await accountScheduler.recordFailure(resolved.account.id, toSafeErrorMessage(error));
          await logError(requestId, startedAt, input.model, error, resolved, context);
          errorAlreadyLogged = true;

          if (!shouldRetryResolvedError(error)) {
            resolved = undefined;
            context = undefined;
            throw error;
          }

          failedAccountIds.add(resolved.account.id);
          lastResolvedError = error;
          resolved = undefined;
          context = undefined;
          continue;
        }
      }
    } catch (error) {
      if (resolved?.account) {
        await accountScheduler.release(resolved.account.id);
        await accountScheduler.recordFailure(resolved.account.id, toSafeErrorMessage(error));
      }
      if (!errorAlreadyLogged && (error !== lastResolvedError || !lastResolvedError)) {
        await logError(requestId, startedAt, input.model, error, resolved, context);
      }
      throw error;
    }
  });
}
