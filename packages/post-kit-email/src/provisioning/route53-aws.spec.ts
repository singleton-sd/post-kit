import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertHostedZoneMatchesDomain, selectPublicHostedZoneId } from './route53-aws';

describe('selectPublicHostedZoneId', () => {
  it('returns the public zone and ignores a private zone with the same name', () => {
    const id = selectPublicHostedZoneId(
      [
        { Id: '/hostedzone/ZPRIVATE', Name: 'example.com.', Config: { PrivateZone: true } },
        { Id: '/hostedzone/ZPUBLIC', Name: 'example.com.', Config: { PrivateZone: false } },
      ],
      'example.com',
    );
    assert.equal(id, 'ZPUBLIC');
  });

  it('fails when more than one public zone matches', () => {
    assert.throws(
      () =>
        selectPublicHostedZoneId(
          [
            { Id: '/hostedzone/Z1', Name: 'example.com.', Config: { PrivateZone: false } },
            { Id: '/hostedzone/Z2', Name: 'example.com.', Config: { PrivateZone: false } },
          ],
          'example.com',
        ),
      /Multiple public/,
    );
  });
});

describe('assertHostedZoneMatchesDomain', () => {
  it('rejects a zone whose canonical name does not match', () => {
    assert.throws(
      () =>
        assertHostedZoneMatchesDomain(
          { Name: 'other.com.', Config: { PrivateZone: false } },
          'example.com',
          'Z123',
        ),
      /does not match/,
    );
  });

  it('rejects a private hosted zone', () => {
    assert.throws(
      () =>
        assertHostedZoneMatchesDomain(
          { Name: 'example.com.', Config: { PrivateZone: true } },
          'example.com',
          'Z123',
        ),
      /private/,
    );
  });
});
