import type { ToolCall } from "./types.js";

export type InputSchema = "raw" | "claude" | "cursor" | "codex";

export function adaptToolCall(input: unknown, schema: InputSchema = "raw"): ToolCall {
  if (schema === "raw") {
    const raw = input as ToolCall;
    return {
      tool: String(raw.tool || ""),
      params: (raw.params || {}) as Record<string, unknown>,
      agentId: raw.agentId,
      source: "raw",
    };
  }

  const payload = (input || {}) as Record<string, unknown>;

  if (schema === "claude") {
    const tool = String(payload.tool_name || "");
    const toolInput = (payload.tool_input || {}) as Record<string, unknown>;
    return {
      tool,
      params: {
        ...toolInput,
        command: toolInput.command ?? toolInput.cmd,
        path: toolInput.file_path ?? toolInput.path,
        content: toolInput.file_text ?? toolInput.content ?? toolInput.new_string,
      },
      source: "claude",
    };
  }

  if (schema === "cursor") {
    const tool = String(payload.tool || payload.name || "");
    const args = (payload.arguments || payload.params || {}) as Record<string, unknown>;
    return {
      tool,
      params: {
        ...args,
        command: args.command ?? args.cmd,
        path: args.file_path ?? args.path,
      },
      source: "cursor",
    };
  }

  const codexPayload = payload;
  const tool = String(codexPayload.tool || codexPayload.recipient_name || "");
  const params = (codexPayload.parameters || codexPayload.params || {}) as Record<string, unknown>;
  return {
    tool,
    params: {
      ...params,
      command: params.command ?? params.cmd,
      path: params.file_path ?? params.path,
    },
    source: "codex",
  };
}
