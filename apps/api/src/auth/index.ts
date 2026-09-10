export {
  ApiKeyAuthenticator,
  AuthError,
  extractBearerToken,
  principalFromTenantKeyMap,
  principalIdFromApiKey,
  requireScope,
  tenantContextFromPrincipal,
  type Authenticator,
} from './authenticate';
export { MCP_TOOL_SCOPES, scopeForMcpTool, type McpScopedToolName } from './mcp-scopes';
export {
  apiKeyHashesEqual,
  asTenantKeyRegistry,
  hashApiKey,
  parseTenantKeyRegistry,
  TENANT_KEY_REGISTRY_SCHEMA_VERSION,
  type ApiKeyRecord,
  type ParsedTenantKeyRegistry,
} from './tenant-key-registry';
