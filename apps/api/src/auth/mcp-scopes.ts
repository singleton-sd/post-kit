import type { PostKitScope } from '@singleton-sd/post-kit-types';

/**
 * Central MCP tool → scope map.
 * Enforced in create-server runTool — tools must not re-implement ad-hoc checks.
 */
export const MCP_TOOL_SCOPES = {
  'postkit.list_templates': 'templates:read',
  'postkit.get_template': 'templates:read',
  'postkit.get_template_schema': 'templates:read',
  'postkit.validate_template': 'templates:validate',
  'postkit.preview_template': 'templates:preview',
} as const satisfies Record<string, PostKitScope>;

export type McpScopedToolName = keyof typeof MCP_TOOL_SCOPES;

export function scopeForMcpTool(tool: McpScopedToolName): PostKitScope {
  return MCP_TOOL_SCOPES[tool];
}
