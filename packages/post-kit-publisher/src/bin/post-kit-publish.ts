#!/usr/bin/env node
import { publishTemplates } from '../publish';
import type { TenantEnvironment } from '@singleton-sd/post-kit-types';

function usage(): never {
  console.error(`Usage:
  post-kit-publish \\
    --templates <dir> \\
    --tenant <id> \\
    --environment <development|staging|production> \\
    --storage-account <name> \\
    --container <name> \\
    [--commit <sha>] \\
    [--dry-run] \\
    [--prune]`);
  process.exit(2);
}

function readFlag(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  if (idx === -1) return undefined;
  return argv[idx + 1];
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) usage();

  const templates = readFlag(argv, '--templates');
  const tenant = readFlag(argv, '--tenant');
  const environment = readFlag(argv, '--environment');
  const storageAccount = readFlag(argv, '--storage-account');
  const container = readFlag(argv, '--container');
  const commit = readFlag(argv, '--commit');
  const dryRun = argv.includes('--dry-run');
  const prune = argv.includes('--prune');

  if (!templates || !tenant || !environment || !storageAccount || !container) {
    usage();
  }

  const result = await publishTemplates({
    templatesDir: templates,
    tenant,
    environment: environment as TenantEnvironment,
    storageAccount,
    container,
    commit,
    dryRun,
    prune,
  });

  if (result.failed.length > 0) {
    for (const failure of result.failed) {
      console.error(`FAILED ${failure.key}: ${failure.error}`);
    }
    process.exit(1);
  }

  if (dryRun) {
    const parts = [
      result.added.length ? `${result.added.length} add(s)` : null,
      result.updated.length ? `${result.updated.length} update(s)` : null,
      result.deleted.length ? `${result.deleted.length} delete(s)` : null,
    ].filter(Boolean);
    console.error(`Dry run: ${parts.length ? parts.join(', ') : 'no changes'}`);
    return;
  }

  const summary = [
    `Published ${result.published.length} template(s): ${result.published.join(', ')}`,
  ];
  if (result.deleted.length > 0) {
    summary.push(`Pruned ${result.deleted.length} template(s): ${result.deleted.join(', ')}`);
  }
  console.error(summary.join('; '));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
