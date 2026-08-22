import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const cli = fileURLToPath(new URL('./email-domain-branding-validator.cli.ts', import.meta.url));

function runCli(args: string[]) {
  const env = { ...process.env };
  delete env.EMAIL_VALIDATION_DOMAIN;
  delete env.EMAIL_FROM_DOMAIN;
  return spawnSync(process.execPath, ['--import', 'tsx', cli, ...args], {
    encoding: 'utf8',
    cwd: path.dirname(cli),
    env,
  });
}

describe('email-domain-branding-validator CLI', () => {
  it('rejects a string option with no value', () => {
    const result = runCli(['--domain']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing value for --domain/);
  });

  it('rejects a string option whose next token is another flag', () => {
    const result = runCli(['--domain', '--dkimSelector', 'fe']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Missing value for --domain/);
  });
});
