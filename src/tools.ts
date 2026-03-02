/**
 * Centralized tool name matching.
 *
 * Different AI coding tools use different names for the same operation:
 * Claude Code uses "Write", Cursor uses "write_file", Copilot uses "create_file".
 * Instead of hardcoding these in every rule, this module provides a single
 * configurable matcher that rules use for tool classification.
 *
 * Users can extend the defaults via the `toolMappings` option in createPreflight().
 */

/**
 * Maps tool categories to the tool names that belong to them.
 * All names are matched case-insensitively at runtime.
 */
export interface ToolMappings {
  /** Tools that write/edit/create files */
  write?: string[];
  /** Tools that read files */
  read?: string[];
  /** Tools that execute shell commands */
  bash?: string[];
  /** Tools that make network requests */
  network?: string[];
}

/** Default tool name mappings covering Claude Code, Cursor, Copilot, and common variants */
export const DEFAULT_TOOL_MAPPINGS: Required<ToolMappings> = {
  write: [
    'write_file', 'write', 'edit', 'edit_file', 'create_file',
    'notebookedit', 'delete_file', 'move_file',
  ],
  read: [
    'read_file', 'read', 'glob', 'grep',
  ],
  bash: [
    'bash', 'shell', 'run_command', 'execute',
  ],
  network: [
    'web_fetch', 'webfetch', 'fetch', 'http_request', 'httprequest',
    'curl', 'wget', 'request', 'get', 'post',
  ],
};

/**
 * Resolved tool matcher — the fast, Set-based lookup that rules use.
 * Created once per Preflight instance from merged mappings.
 */
export interface ToolMatcher {
  /** Is this a file write/edit/create/delete tool? */
  isWrite(tool: string): boolean;
  /** Is this a file read tool? */
  isRead(tool: string): boolean;
  /** Is this any file operation (write or read)? */
  isFile(tool: string): boolean;
  /** Is this a shell/bash execution tool? */
  isBash(tool: string): boolean;
  /** Is this a network request tool? */
  isNetwork(tool: string): boolean;
}

/**
 * Create a ToolMatcher from user mappings merged with defaults.
 * User-provided arrays extend (not replace) the defaults.
 */
export function createToolMatcher(custom?: ToolMappings): ToolMatcher {
  const merged: Required<ToolMappings> = {
    write: [...DEFAULT_TOOL_MAPPINGS.write],
    read: [...DEFAULT_TOOL_MAPPINGS.read],
    bash: [...DEFAULT_TOOL_MAPPINGS.bash],
    network: [...DEFAULT_TOOL_MAPPINGS.network],
  };

  // Merge custom mappings — add to defaults (no duplicates)
  if (custom) {
    for (const key of ['write', 'read', 'bash', 'network'] as const) {
      if (custom[key]) {
        for (const name of custom[key]) {
          const lower = name.toLowerCase();
          if (!merged[key].includes(lower)) {
            merged[key].push(lower);
          }
        }
      }
    }
  }

  // Build Sets for O(1) lookup
  const writeSet = new Set(merged.write.map((s) => s.toLowerCase()));
  const readSet = new Set(merged.read.map((s) => s.toLowerCase()));
  const bashSet = new Set(merged.bash.map((s) => s.toLowerCase()));
  const networkSet = new Set(merged.network.map((s) => s.toLowerCase()));
  const fileSet = new Set([...writeSet, ...readSet]);

  return {
    isWrite(tool: string) { return writeSet.has(tool.toLowerCase()); },
    isRead(tool: string) { return readSet.has(tool.toLowerCase()); },
    isFile(tool: string) { return fileSet.has(tool.toLowerCase()); },
    isBash(tool: string) { return bashSet.has(tool.toLowerCase()); },
    isNetwork(tool: string) { return networkSet.has(tool.toLowerCase()); },
  };
}
