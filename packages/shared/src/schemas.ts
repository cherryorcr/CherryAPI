import { z } from "zod";

export const openAIChatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.union([z.string(), z.array(z.record(z.unknown())), z.null()]),
  name: z.string().optional(),
  tool_call_id: z.string().optional()
});

export const openAIChatCompletionRequestSchema = z
  .object({
    model: z.string().min(1),
    messages: z.array(openAIChatMessageSchema).min(1),
    stream: z.boolean().optional(),
    temperature: z.number().optional(),
    top_p: z.number().optional(),
    max_tokens: z.number().int().positive().optional(),
    tools: z.array(z.unknown()).optional(),
    tool_choice: z.unknown().optional()
  })
  .passthrough();

export type OpenAIChatCompletionRequestInput = z.infer<
  typeof openAIChatCompletionRequestSchema
>;
