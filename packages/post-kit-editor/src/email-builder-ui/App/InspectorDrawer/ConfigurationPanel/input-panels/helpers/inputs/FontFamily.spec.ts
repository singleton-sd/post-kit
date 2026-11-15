import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FONT_FAMILY_INHERIT_VALUE, fontFamilySelectValueToEmit } from './FontFamily';

describe('fontFamilySelectValueToEmit', () => {
  it('emits null for the Match email settings sentinel', () => {
    assert.equal(fontFamilySelectValueToEmit(FONT_FAMILY_INHERIT_VALUE), null);
  });

  it('passes through concrete font family keys', () => {
    assert.equal(fontFamilySelectValueToEmit('MODERN_SANS'), 'MODERN_SANS');
    assert.equal(fontFamilySelectValueToEmit('BOOK_SERIF'), 'BOOK_SERIF');
  });
});
