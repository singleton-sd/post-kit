import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

describe('theme monospace pre styles', () => {
  it('terminates the font-family declaration before white-space', () => {
    const themePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'theme.ts');
    const source = readFileSync(themePath, 'utf8');
    assert.match(source, /font-family:\s*\$\{MONOSPACE_FONT_FAMILY\};/);
    assert.match(source, /font-family:\s*\$\{MONOSPACE_FONT_FAMILY\};\s*white-space:/s);
  });
});
