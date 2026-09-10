import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TEMPLATE_SCHEMA_VERSION,
  type CompiledTemplate,
  type TenantContext,
} from '@singleton-sd/post-kit-types';
import { PostKitErrorCode } from '@singleton-sd/post-kit-types';
import { TemplateApplicationService } from './template-application-service';
import { TemplateStoreError, type TemplateStore } from './index';

const TENANT: TenantContext = { tenantId: 'acme', environment: 'staging' };

const COMPILED: CompiledTemplate = {
  templateHtml: '<p>{{name}}</p>',
  metadata: {
    key: 'n.hello',
    name: 'Hello',
    subject: 'Hey {{name}}',
    description: 'Greeting',
    variables: ['name'],
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
  },
  manifest: {
    key: 'n.hello',
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    compiledAt: '',
    sourceCommit: '',
    variables: ['name'],
    contentHash: '',
  },
};

function store(overrides?: Partial<TemplateStore>): TemplateStore {
  return {
    list: async () => [
      {
        key: COMPILED.metadata.key,
        name: COMPILED.metadata.name,
        description: COMPILED.metadata.description,
        variables: COMPILED.metadata.variables,
      },
    ],
    load: async () => COMPILED,
    ...overrides,
  };
}

describe('TemplateApplicationService', () => {
  it('listTemplates / getTemplate / getTemplateSchema delegate to the store', async () => {
    const service = new TemplateApplicationService({ templateStore: store() });
    const listed = await service.listTemplates(TENANT);
    assert.equal(listed[0]!.key, 'n.hello');

    const got = await service.getTemplate(TENANT, 'n.hello');
    assert.equal(got.templateHtml, COMPILED.templateHtml);

    const schema = await service.getTemplateSchema(TENANT, 'n.hello');
    assert.equal(schema.key, 'n.hello');
    assert.deepEqual(schema.variablesSchema.required, ['name']);
  });

  it('validateTemplate and previewTemplate share required-variable rules', async () => {
    const service = new TemplateApplicationService({
      templateStore: store(),
      resolveBranding: async () => ({ name: 'Brand' }),
    });

    const viaBranding = await service.validateTemplate(TENANT, 'n.hello', {});
    assert.equal(viaBranding.ok, true);

    const preview = await service.previewTemplate(TENANT, 'n.hello', { name: 'Ada' });
    assert.equal(preview.ok, true);
    if (preview.ok) {
      assert.equal(preview.subject, 'Hey Ada');
      assert.equal(preview.html, '<p>Ada</p>');
    }
  });

  it('surfaces TemplateStoreError from load', async () => {
    const service = new TemplateApplicationService({
      templateStore: store({
        load: async () => {
          throw new TemplateStoreError('missing', PostKitErrorCode.TEMPLATE_NOT_FOUND);
        },
      }),
    });
    await assert.rejects(
      () => service.getTemplate(TENANT, 'missing'),
      (err: unknown) =>
        err instanceof TemplateStoreError && err.code === PostKitErrorCode.TEMPLATE_NOT_FOUND,
    );
  });
});
