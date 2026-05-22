import type { OpenAIChatCompletionRequest, OpenAIChatCompletionResponse } from "@cherryapi/shared";
import { eq } from "drizzle-orm";
import { routeResolver } from "../../core/route-resolver";
import { accountScheduler } from "../../core/account-scheduler";
import { GatewayError, toSafeErrorMessage } from "../../core/errors";
import { writeUsageLog } from "../../core/usage-logger";
import { db } from "../../database/client";
import { apiKeys, groups } from "../../database/schema";
import { createId } from "../../utils/id";
import { bodyObject, stringValue } from "../common/body";
import type { AdapterContext } from "../../adapters/types";

function extractContent(response: OpenAIChatCompletionResponse): string {
  const first = response.choices[0] as { message?: { content?: unknown } } | undefined;
  return typeof first?.message?.content === "string" ? first.message.content : "";
}

export async function runAdminChatCompletionTest(input: unknown) {
  const body = bodyObject(input);
  const apiKeyId = stringValue(body, "apiKeyId", "api_key_id");
  const model = stringValue(body, "model");
  const prompt = stringValue(body, "prompt");
  const requestId = createId("admintest");
  const startedAt = Date.now();

  const apiKey = await db.select().from(apiKeys).where(eq(apiKeys.id, apiKeyId)).get();
  if (!apiKey || apiKey.status !== "enabled") {
    throw new GatewayError("UNAUTHORIZED", "Selected API key is disabled or missing", 401);
  }

  const group = await db.select().from(groups).where(eq(groups.id, apiKey.groupId)).get();
  if (!group || group.status !== "enabled") {
    throw new GatewayError("FORBIDDEN", "Selected API key group is disabled or missing", 403);
  }

  const chatRequest: OpenAIChatCompletionRequest = {
    model,
    stream: false,
    messages: [{ role: "user", content: prompt }]
  };

  const resolved = await routeResolver.resolve(apiKey, group, chatRequest);
  const context: AdapterContext = {
    requestId,
    apiKey,
    group,
    model: resolved.model,
    route: resolved.route,
    channel: resolved.channel,
    account: resolved.account,
    upstreamModelName: resolved.upstreamModelName,
    stream: false
  };

  try {
    const upstreamRequest = await resolved.adapter.transformRequest(chatRequest, context);
    const upstreamResponse = await resolved.adapter.send(upstreamRequest, resolved.account, context);
    const response = await resolved.adapter.transformResponse(upstreamResponse, context);
    const usage = {
      promptTokens: response.usage?.prompt_tokens,
      completionTokens: response.usage?.completion_tokens,
      totalTokens: response.usage?.total_tokens
    };

    await writeUsageLog({
      requestId,
      apiKeyId: apiKey.id,
      apiKeyPrefix: apiKey.keyPrefix,
      groupId: group.id,
      modelId: resolved.model.id,
      channelId: resolved.channel.id,
      accountId: resolved.account.id,
      requestModel: model,
      upstreamModel: resolved.upstreamModelName,
      status: "success",
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      latencyMs: Date.now() - startedAt
    });

    return {
      requestId,
      model: response.model,
      content: extractContent(response),
      usage: response.usage ?? null,
      latencyMs: Date.now() - startedAt,
      response
    };
  } catch (error) {
    await accountScheduler.recordFailure(resolved.account.id, toSafeErrorMessage(error));
    await writeUsageLog({
      requestId,
      apiKeyId: apiKey.id,
      apiKeyPrefix: apiKey.keyPrefix,
      groupId: group.id,
      modelId: resolved.model.id,
      channelId: resolved.channel.id,
      accountId: resolved.account.id,
      requestModel: model,
      upstreamModel: resolved.upstreamModelName,
      status: "failed",
      latencyMs: Date.now() - startedAt,
      errorCode: error instanceof GatewayError ? error.code : "UPSTREAM_ERROR",
      errorMessage: toSafeErrorMessage(error)
    });
    throw error;
  } finally {
    await accountScheduler.release(resolved.account.id);
  }
}
