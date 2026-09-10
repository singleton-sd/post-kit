import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_POC_SCOPES,
  PostKitErrorCode,
  TEMPLATE_SCHEMA_VERSION,
  type CompiledTemplate,
  type Principal,
  type TenantContext,
} from '@singleton-sd/post-kit-types';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createLogger } from '../telemetry';
import {
  TemplateApplicationService,
  TemplateStoreError,
  type TemplateListItem,
  type TemplateStore,
} from '../templates';
import { createPostkitMcpServer, POSTKIT_MCP_TOOL_NAMES } from './create-server';

const TENANT: TenantContext = { tenantId: 'acme', environment: 'production' };

const PRINCIPAL: Principal = {
  id: 'ak_test',
  tenantId: TENANT.tenantId,
  environment: TENANT.environment,
  authType: 'api-key',
  scopes: DEFAULT_POC_SCOPES,
};

const COMPILED: CompiledTemplate = {
  templateHtml: '<p>Hello {{name}}</p>',
  metadata: {
    key: 'marketing.welcome',
    name: 'Welcome',
    subject: 'Hi {{name}}',
    description: 'Welcome email',
    variables: ['name'],
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
  },
  manifest: {
    key: 'marketing.welcome',
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    compiledAt: '',
    sourceCommit: '',
    variables: ['name'],
    contentHash: '',
  },
};

function memoryStore(
  items: TemplateListItem[] = [
    {
      key: COMPILED.metadata.key,
      name: COMPILED.metadata.name,
      description: COMPILED.metadata.description,
      variables: COMPILED.metadata.variables,
    },
  ],
  compiled: CompiledTemplate | TemplateStoreError = COMPILED,
): TemplateStore {
  return {
    list: async () => items,
    load: async (_tenant, key) => {
      if (compiled instanceof TemplateStoreError) {
        throw compiled;
      }
      if (key !== compiled.metadata.key) {
        throw new TemplateStoreError('not found', PostKitErrorCode.TEMPLATE_NOT_FOUND);
      }
      return compiled;
    },
  };
}

async function connectClient(
  store: TemplateStore = memoryStore(),
  principal: Principal = PRINCIPAL,
) {
  const lines: string[] = [];
  const logger = createLogger('mcp-test', (line) => lines.push(line));
  const templates = new TemplateApplicationService({ templateStore: store });
  const server = createPostkitMcpServer({
    templates,
    principal,
    logger,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, lines };
}

describe('PostKit MCP tools', () => {
  it('lists the iteration-1 tool set and does not expose send_email', async () => {
    const { client, server } = await connectClient();
    try {
      const listed = await client.listTools();
      const names = listed.tools.map((t) => t.name).sort();
      assert.deepEqual(names, [...POSTKIT_MCP_TOOL_NAMES].sort());
      assert.ok(!names.includes('postkit.send_email'));
      assert.ok(!names.includes('send_email'));
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('rejects tools when the principal lacks the required scope', async () => {
    const limited: Principal = {
      ...PRINCIPAL,
      scopes: ['templates:read'],
    };
    const { client, server } = await connectClient(memoryStore(), limited);
    try {
      const preview = await client.callTool({
        name: 'postkit.preview_template',
        arguments: { templateKey: 'marketing.welcome', variables: { name: 'Ada' } },
      });
      assert.equal(preview.isError, true);
      const body = JSON.parse((preview.content as { text: string }[])[0]!.text) as {
        code: string;
        error: string;
      };
      assert.equal(body.code, PostKitErrorCode.UNAUTHORIZED);
      assert.equal(body.error, 'The credential does not have the required permission.');

      const listed = await client.callTool({ name: 'postkit.list_templates', arguments: {} });
      assert.notEqual(listed.isError, true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('rejects invalid templateKey input before calling the store', async () => {
    let loadCalls = 0;
    const store: TemplateStore = {
      list: async () => [],
      load: async () => {
        loadCalls += 1;
        return COMPILED;
      },
    };
    const { client, server } = await connectClient(store);
    try {
      const result = await client.callTool({
        name: 'postkit.get_template',
        arguments: { templateKey: '../etc/passwd' },
      });
      assert.equal(result.isError, true);
      const body = JSON.parse((result.content as { text: string }[])[0]!.text) as {
        code: string;
      };
      assert.equal(body.code, PostKitErrorCode.INVALID_TEMPLATE);
      assert.equal(loadCalls, 0);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('list_templates returns store summaries for the authenticated tenant', async () => {
    const { client, server } = await connectClient();
    try {
      const result = await client.callTool({ name: 'postkit.list_templates', arguments: {} });
      assert.notEqual(result.isError, true);
      const text = (result.content as { type: string; text: string }[])[0]!.text;
      const payload = JSON.parse(text) as { templates: TemplateListItem[] };
      assert.equal(payload.templates.length, 1);
      assert.equal(payload.templates[0]!.key, 'marketing.welcome');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('list_templates maps store rejection like other tools without leaking Error.message', async () => {
    const store: TemplateStore = {
      list: async () => {
        throw new Error('Blob https://acct.blob.core.windows.net/c failed');
      },
      load: async () => COMPILED,
    };
    const { client, server } = await connectClient(store);
    try {
      const result = await client.callTool({ name: 'postkit.list_templates', arguments: {} });
      assert.equal(result.isError, true);
      const body = JSON.parse((result.content as { text: string }[])[0]!.text) as {
        code: string;
        error: string;
      };
      assert.equal(body.code, 'INTERNAL_ERROR');
      assert.equal(body.error, 'Internal error');
      assert.ok(!body.error.includes('blob.core.windows.net'));
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('list_templates maps TemplateStoreError code and message', async () => {
    const store: TemplateStore = {
      list: async () => {
        throw new TemplateStoreError('list failed', PostKitErrorCode.STORAGE_FAILURE);
      },
      load: async () => COMPILED,
    };
    const { client, server } = await connectClient(store);
    try {
      const result = await client.callTool({ name: 'postkit.list_templates', arguments: {} });
      assert.equal(result.isError, true);
      const body = JSON.parse((result.content as { text: string }[])[0]!.text) as {
        code: string;
        error: string;
      };
      assert.equal(body.code, PostKitErrorCode.STORAGE_FAILURE);
      assert.equal(body.error, 'list failed');
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('get_template_schema / validate / preview match application service behavior', async () => {
    const { client, server } = await connectClient();
    try {
      const schemaResult = await client.callTool({
        name: 'postkit.get_template_schema',
        arguments: { templateKey: 'marketing.welcome' },
      });
      const schema = JSON.parse((schemaResult.content as { text: string }[])[0]!.text) as {
        key: string;
        variables: string[];
        variablesSchema: { required: string[] };
      };
      assert.equal(schema.key, 'marketing.welcome');
      assert.deepEqual(schema.variables, ['name']);
      assert.deepEqual(schema.variablesSchema.required, ['name']);

      const invalid = await client.callTool({
        name: 'postkit.validate_template',
        arguments: { templateKey: 'marketing.welcome', variables: {} },
      });
      assert.equal(invalid.isError, true);
      const invalidBody = JSON.parse((invalid.content as { text: string }[])[0]!.text) as {
        code: string;
        missing: string[];
      };
      assert.equal(invalidBody.code, PostKitErrorCode.MISSING_VARIABLES);
      assert.deepEqual(invalidBody.missing, ['name']);

      const preview = await client.callTool({
        name: 'postkit.preview_template',
        arguments: {
          templateKey: 'marketing.welcome',
          variables: { name: 'Ada' },
        },
      });
      assert.notEqual(preview.isError, true);
      const previewBody = JSON.parse((preview.content as { text: string }[])[0]!.text) as {
        subject: string;
        html: string;
      };
      assert.equal(previewBody.subject, 'Hi Ada');
      assert.equal(previewBody.html, '<p>Hello Ada</p>');
    } finally {
      await client.close();
      await server.close();
    }
  });
});
