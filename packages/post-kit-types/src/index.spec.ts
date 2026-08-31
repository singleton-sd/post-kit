/**
 * Compile-time assertion tests for @singleton-sd/post-kit-types.
 *
 * These tests verify the shape of every exported contract using TypeScript's
 * type system. If any assertion fails the package will not compile, catching
 * contract regressions before they reach dependent packages.
 *
 * Runtime assertions (node --test) are included to confirm the enum values
 * and schema version constant are correct at runtime.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PostKitErrorCode,
  TEMPLATE_SCHEMA_VERSION,
  type CompiledTemplate,
  type PostKitErrorResponse,
  type SendRequest,
  type SendResponse,
  type TenantBranding,
  type TenantContext,
  type TenantEnvironment,
  type TemplateManifest,
  type TemplatePreviewData,
  type TemplateSourceMetadata,
  type TemplateVariables,
} from './index';

// ---------------------------------------------------------------------------
// Compile-time shape assertions via `satisfies`
// ---------------------------------------------------------------------------

// TemplateSourceMetadata — all required fields + optional description
const _metadata = {
  key: 'marketing.contact-us',
  name: 'Contact Us',
  subject: 'New message from {{name}}',
  variables: ['name', 'email', 'message'],
  schemaVersion: '1',
} satisfies TemplateSourceMetadata;

// TemplateSourceMetadata with optional description
const _metadataWithDesc = {
  key: 'auth.password-reset',
  name: 'Password Reset',
  subject: 'Reset your password',
  description: 'Sent when a user requests a password reset',
  variables: ['resetUrl'],
  schemaVersion: '1',
} satisfies TemplateSourceMetadata;

// TemplatePreviewData
const _preview = {
  name: 'Jane Doe',
  email: 'jane@example.com',
  message: 'Hello!',
} satisfies TemplatePreviewData;

// TemplateManifest
const _manifest = {
  key: 'marketing.contact-us',
  schemaVersion: '1',
  compiledAt: '2026-01-01T00:00:00.000Z',
  sourceCommit: 'abc123',
  variables: ['name', 'email', 'message'],
  contentHash: 'sha256-abc123',
} satisfies TemplateManifest;

// TemplateManifest with empty sourceCommit (local build)
const _manifestLocal = {
  key: 'marketing.contact-us',
  schemaVersion: '1',
  compiledAt: '2026-01-01T00:00:00.000Z',
  sourceCommit: '',
  variables: [],
  contentHash: 'sha256-def456',
} satisfies TemplateManifest;

// CompiledTemplate
const _compiled = {
  templateHtml: '<html>Hello {{name}}</html>',
  metadata: _metadata,
  manifest: _manifest,
} satisfies CompiledTemplate;

// SendRequest — required fields
const _sendReq = {
  template: 'marketing.contact-us',
  to: 'hello@example.com',
  variables: { name: 'Jane', email: 'jane@example.com', message: 'Hi' },
} satisfies SendRequest;

// SendRequest — empty variables is valid (template may have no variables)
const _sendReqNoVars = {
  template: 'system.ping',
  to: 'admin@example.com',
  variables: {},
} satisfies SendRequest;

// SendResponse
const _sendResp = {
  id: 'req_01abc',
  status: 'sent',
} satisfies SendResponse;

// PostKitErrorResponse
const _errResp = {
  error: 'Template not found',
  code: PostKitErrorCode.TEMPLATE_NOT_FOUND,
  correlationId: 'req_01abc',
} satisfies PostKitErrorResponse;

// TenantEnvironment — each valid value
const _envDev: TenantEnvironment = 'development';
const _envStg: TenantEnvironment = 'staging';
const _envPrd: TenantEnvironment = 'production';

// TenantContext
const _ctx = {
  tenantId: 'inkads',
  environment: 'production',
} satisfies TenantContext;

// TenantBranding — all fields optional, all present
const _brandingFull = {
  companyName: 'InkAds',
  logoUrl: 'https://cdn.inkads.com/logo.svg',
  websiteUrl: 'https://inkads.com',
  supportEmail: 'hello@inkads.com',
} satisfies TenantBranding;

// TenantBranding — empty is valid
const _brandingEmpty = {} satisfies TenantBranding;

// TemplateVariables
const _vars = {
  name: 'Jane',
  resetUrl: 'https://example.com/reset/abc',
} satisfies TemplateVariables;

// Suppress unused-variable warnings — values are referenced to confirm types compile
void [
  _metadata,
  _metadataWithDesc,
  _preview,
  _manifest,
  _manifestLocal,
  _compiled,
  _sendReq,
  _sendReqNoVars,
  _sendResp,
  _errResp,
  _envDev,
  _envStg,
  _envPrd,
  _ctx,
  _brandingFull,
  _brandingEmpty,
  _vars,
];

// ---------------------------------------------------------------------------
// Runtime assertions — enum values and constants
// ---------------------------------------------------------------------------

describe('PostKitErrorCode', () => {
  it('has all required enum values', () => {
    assert.equal(PostKitErrorCode.UNAUTHENTICATED, 'UNAUTHENTICATED');
    assert.equal(PostKitErrorCode.UNAUTHORIZED, 'UNAUTHORIZED');
    assert.equal(PostKitErrorCode.TEMPLATE_NOT_FOUND, 'TEMPLATE_NOT_FOUND');
    assert.equal(PostKitErrorCode.INVALID_TEMPLATE, 'INVALID_TEMPLATE');
    assert.equal(PostKitErrorCode.MISSING_VARIABLES, 'MISSING_VARIABLES');
    assert.equal(PostKitErrorCode.INVALID_RECIPIENT, 'INVALID_RECIPIENT');
    assert.equal(PostKitErrorCode.PAYLOAD_TOO_LARGE, 'PAYLOAD_TOO_LARGE');
    assert.equal(PostKitErrorCode.RATE_LIMITED, 'RATE_LIMITED');
    assert.equal(PostKitErrorCode.PROVIDER_FAILURE, 'PROVIDER_FAILURE');
    assert.equal(PostKitErrorCode.STORAGE_FAILURE, 'STORAGE_FAILURE');
    assert.equal(PostKitErrorCode.TENANT_CONFIG_NOT_FOUND, 'TENANT_CONFIG_NOT_FOUND');
  });

  it('has exactly 11 codes', () => {
    const codes = Object.keys(PostKitErrorCode).filter(
      (k) => typeof PostKitErrorCode[k as keyof typeof PostKitErrorCode] === 'string',
    );
    assert.equal(codes.length, 11);
  });
});

describe('TEMPLATE_SCHEMA_VERSION', () => {
  it('is the string "1"', () => {
    assert.equal(TEMPLATE_SCHEMA_VERSION, '1');
  });
});

describe('TenantEnvironment values', () => {
  it('the three valid environments are distinct strings', () => {
    const envs: TenantEnvironment[] = ['development', 'staging', 'production'];
    const unique = new Set(envs);
    assert.equal(unique.size, 3);
  });
});
