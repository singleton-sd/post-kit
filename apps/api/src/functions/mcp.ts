import { app } from '@azure/functions';
import { createProductionMcpHandler } from '../mcp/handler';

/**
 * Stateless MCP Streamable HTTP endpoint on the existing Function App.
 * Auth: Bearer API key → Principal + scopes (TENANT_KEY_MAP PoC; see #83).
 */
app.http('mcp', {
  methods: ['POST', 'GET', 'DELETE', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'mcp',
  handler: createProductionMcpHandler(),
});
