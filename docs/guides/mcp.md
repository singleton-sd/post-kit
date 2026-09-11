# MCP (iteration 2)

Stateless Model Context Protocol endpoint on the existing PostKit Azure
Function App. MCP is an **adapter** over the same template application
services used by REST — it does not send email in this iteration.

| Property | Value |
| --- | --- |
| Route | `POST /mcp` |
| Transport | MCP Streamable HTTP (JSON responses, no sessions) |
| Auth | `Authorization: Bearer <token>` → shared `Principal` (same hashed `TENANT_KEY_MAP` registry as `POST /emails/send`) |
| Scopes | Tools enforce `templates:read` / `templates:validate` / `templates:preview` centrally in `runTool` |
| Tools | `postkit.list_templates`, `postkit.get_template`, `postkit.get_template_schema`, `postkit.validate_template`, `postkit.preview_template` |

`send_email` is intentionally absent. Azure Function keys are **not** the
PostKit authorization model — the Function route uses `authLevel: anonymous`
and PostKit authenticates the Bearer token to a `Principal` with scopes
(`apps/api/src/auth/`; hashed store, revoke, and expiry via schema v2).

## Architecture

```text
MCP client
   |
   |  POST /mcp   Authorization: Bearer <token>
   v
apps/api Azure Function (functions/mcp.ts)
   |
   +--> ApiKeyAuthenticator  (TENANT_KEY_MAP schema v2 hash match → Principal;
   |                         dual-read legacy plaintext / legacyPlaintext)
   +--> createPostkitMcpServer (requireScope per tool via MCP_TOOL_SCOPES)
   +--> TemplateApplicationService
           |
           +--> TemplateStore.list / load
           +--> validateRequiredVariables / renderCompiledTemplate
                (shared with POST /emails/send)
```

Implementation lives under `apps/api/src/mcp/` (adapter) and
`apps/api/src/templates/` (shared services). Official
`@modelcontextprotocol/sdk` (`McpServer` +
`WebStandardStreamableHTTPServerTransport`) drives the protocol.

## Observability

Structured logs (no secrets, no recipient PII, no variable values):

- `mcp.request.received` / `mcp.request.completed` / `mcp.request.failed`
- `mcp.tool.completed` / `mcp.tool.failed`
- Fields: `correlationId`, `mcpMethod`, `mcpTool`, `tenantId`, `environment`,
  `principalId`, `templateKey`, `outcome`, `durationMs`, `errorCode`

Pass `X-Correlation-Id` on requests when you want a stable client-side id
(same rules as send).

## Local development

1. Bootstrap the API as usual (`pnpm --filter @singleton-sd/post-kit-api build`,
   `az login`, App Configuration / storage roles — see
   [`apps/api/README.md`](../../apps/api/README.md)).
2. Set a key map in `local.settings.json` **Values** (never commit real
   tokens). Legacy plaintext still works for local PoC; prefer schema v2 via
   the register script:

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "AZURE_APPCONFIGURATION_ENDPOINT": "https://ssd-postkit-appcs-prod-ae.azconfig.io",
    "TENANT_KEY_MAP": "{\"tk_dev_local\":{\"tenantId\":\"acme\",\"environment\":\"development\"}}"
  }
}
```

3. Start the Function App:

```bash
pnpm --filter @singleton-sd/post-kit-api build
pnpm --filter @singleton-sd/post-kit-api start
```

4. Point an MCP client at `http://localhost:7071/mcp` with header
   `Authorization: Bearer tk_dev_local`.

### Cursor / Claude Desktop style config (example)

```json
{
  "mcpServers": {
    "post-kit": {
      "url": "http://localhost:7071/mcp",
      "headers": {
        "Authorization": "Bearer tk_dev_local"
      }
    }
  }
}
```

Exact client config keys vary by product; the important parts are the `/mcp`
URL and the Bearer header.

### Smoke with curl (initialize)

```bash
curl -sS http://localhost:7071/mcp \
  -H "Authorization: Bearer tk_dev_local" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc":"2.0",
    "id":1,
    "method":"initialize",
    "params":{
      "protocolVersion":"2025-03-26",
      "capabilities":{},
      "clientInfo":{"name":"curl","version":"1.0.0"}
    }
  }'
```

## Deployed environment

Endpoint:

```text
https://postkit.singletonsd.com/mcp
```

Use a Bearer token registered via `./scripts/register-tenant-api-key.sh` (hashed
schema v2 in Key Vault `ssd-postkit-kv-prod-ae`). Configure the Function App
setting as a Key Vault reference (do not put the map in App Configuration or as
plain-text app settings). Do not put secrets in this public repository, issues,
or PR descriptions.

```json
{
  "mcpServers": {
    "post-kit": {
      "url": "https://postkit.singletonsd.com/mcp",
      "headers": {
        "Authorization": "Bearer <token-from-secure-store>"
      }
    }
  }
}
```

## Automated tests

```bash
pnpm --filter @singleton-sd/post-kit-api test
```

Coverage includes tool input validation (unsafe `templateKey`), representative
tool calls via the MCP in-memory transport, HTTP auth rejection on `/mcp`, and
hashed-key / revoke / expiry / legacy dual-read cases in
`apps/api/src/auth/authenticate.spec.ts`.

## Follow-ups

- #84 — Entra OAuth/OIDC
- #85 — hardening and optional `postkit.send_email`
