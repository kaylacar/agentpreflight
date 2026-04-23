import type { ToolCall } from "./types.js";

export type InputSchema = "raw" | "claude" | "cursor" | "codex" | "openclaw";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeCodexTool(tool: string): string {
  const lower = tool.toLowerCase();
  if (lower === "bash") {
    return "bash";
  }
  if (lower === "functions.shell_command" || lower.endsWith(".shell_command") || lower === "shell_command") {
    return "bash";
  }
  if (lower === "functions.apply_patch" || lower.endsWith(".apply_patch") || lower === "apply_patch") {
    return "edit";
  }
  if (lower === "web.run" || lower.endsWith(".run")) {
    return "web_fetch";
  }
  return tool;
}

function getCodexParams(payload: Record<string, unknown>): Record<string, unknown> {
  const raw = payload.tool_input ?? payload.parameters ?? payload.params ?? payload.arguments ?? {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") return { content: raw, patch: raw };
  return {};
}

function extractPatchPath(params: Record<string, unknown>): string | undefined {
  const patch = params.patch ?? params.content ?? params.input;
  if (typeof patch !== "string") return undefined;
  const match = patch.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/m);
  return match?.[1]?.trim();
}

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

  const payload = asRecord(input);

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

  if (schema === "openclaw") {
    const tool = String(payload.tool || payload.tool_name || payload.name || "");
    const args = (payload.arguments || payload.parameters || payload.params || payload.tool_input || {}) as Record<
      string,
      unknown
    >;
    return {
      tool,
      params: {
        ...args,
        command: args.command ?? args.cmd,
        path: args.file_path ?? args.path,
        content: args.file_text ?? args.content ?? args.new_string,
      },
      source: "raw",
    };
  }

  const codexPayload = payload;
  const rawTool = String(codexPayload.tool || codexPayload.recipient_name || codexPayload.tool_name || codexPayload.name || "");
  const tool = normalizeCodexTool(rawTool);
  const params = getCodexParams(codexPayload);
  const patchPath = extractPatchPath(params);
  return {
    tool,
    params: {
      ...params,
      command: params.command ?? params.cmd,
      path: params.file_path ?? params.path ?? patchPath,
      content: params.content ?? params.new_string ?? params.patch ?? params.input,
      codexTool: rawTool,
    },
    source: "codex",
  };
}
