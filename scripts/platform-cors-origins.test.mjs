import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  originUrlForHost,
  parseOriginsList,
  platformCorsOriginsFromAppConfig,
} from './platform-cors-origins.mjs';

describe('platformCorsOriginsFromAppConfig', () => {
  it('maps profile hosts to https origins and exact ORIGINS localhost to http', () => {
    const origins = platformCorsOriginsFromAppConfig({
      originsRaw: '*.poc.singletonsd.com,localhost:4321',
      profilesByHostRaw: JSON.stringify({
        'inkads.poc.singletonsd.com': { fromAddress: 'noreply@mail.inkads.poc.singletonsd.com' },
        'plattform-kit.poc.singletonsd.com': {
          fromAddress: 'noreply@mail.plattform-kit.poc.singletonsd.com',
        },
      }),
    });
    assert.deepEqual(origins, [
      'http://localhost:4321',
      'https://inkads.poc.singletonsd.com',
      'https://plattform-kit.poc.singletonsd.com',
    ]);
  });

  it('skips ORIGINS globs (platform CORS cannot express them)', () => {
    const origins = platformCorsOriginsFromAppConfig({
      originsRaw: '*.poc.singletonsd.com,*.azurestaticapps.net',
      profilesByHostRaw: '{}',
    });
    assert.deepEqual(origins, []);
  });

  it('includes exact ORIGINS hosts even without a profile', () => {
    const origins = platformCorsOriginsFromAppConfig({
      originsRaw: 'demo.example.com,localhost:3000',
      profilesByHostRaw: undefined,
    });
    assert.deepEqual(origins, ['http://localhost:3000', 'https://demo.example.com']);
  });

  it('dedupes and lowercases hosts', () => {
    const origins = platformCorsOriginsFromAppConfig({
      originsRaw: 'InkAds.poc.singletonsd.com',
      profilesByHostRaw: JSON.stringify({
        'inkads.poc.singletonsd.com': { fromName: 'InkAds' },
      }),
    });
    assert.deepEqual(origins, ['https://inkads.poc.singletonsd.com']);
  });

  it('rejects invalid profiles JSON', () => {
    assert.throws(
      () =>
        platformCorsOriginsFromAppConfig({
          originsRaw: 'localhost:4321',
          profilesByHostRaw: '{bad',
        }),
      /profilesByHost must be valid JSON/,
    );
  });
});

describe('parseOriginsList / originUrlForHost', () => {
  it('parses comma lists', () => {
    assert.deepEqual(parseOriginsList(' a ,b,'), ['a', 'b']);
    assert.deepEqual(parseOriginsList(''), []);
  });

  it('uses http only for localhost', () => {
    assert.equal(originUrlForHost('localhost:4321'), 'http://localhost:4321');
    assert.equal(originUrlForHost('example.com'), 'https://example.com');
  });
});
