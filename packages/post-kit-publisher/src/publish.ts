import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BlobServiceClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { compileFromDirectory } from '@singleton-sd/post-kit-compiler';
import type { CompiledTemplate, TenantEnvironment } from '@singleton-sd/post-kit-types';
import {
  assertSafeEnvironment,
  assertSafeStorageAccount,
  assertSafeTenantId,
  assertSafeTemplateKey,
  blobBasePath,
} from './path-safety';

export interface PublishOptions {
  /** Root directory; each subdirectory is one template. */
  templatesDir: string;
  tenant: string;
  environment: TenantEnvironment;
  storageAccount: string;
  container: string;
  /** Passed through to TemplateManifest.sourceCommit. */
  commit?: string;
}

export interface PublishResult {
  published: string[];
  failed: Array<{ key: string; error: string }>;
}

/** Internal batch row — not part of the public package API. */
interface CompiledEntry {
  dirName: string;
  compiled: CompiledTemplate;
}

/**
 * Compile every template under `templatesDir`, then upload artifacts.
 *
 * Fail-fast for publishing: if any compile fails, nothing is uploaded.
 * Storage auth always uses `DefaultAzureCredential` (Managed Identity / az login).
 */
export async function publishTemplates(options: PublishOptions): Promise<PublishResult> {
  assertSafeTenantId(options.tenant);
  assertSafeEnvironment(options.environment);
  assertSafeStorageAccount(options.storageAccount);

  const client = new BlobServiceClient(
    `https://${options.storageAccount}.blob.core.windows.net`,
    new DefaultAzureCredential(),
  );
  return runPublish(options, client);
}

/**
 * Test-only seam that injects a Blob client. Not re-exported from the package root;
 * package `exports` only expose `.` so consumers cannot import this via the public API.
 */
export async function publishTemplatesWithClient(
  options: PublishOptions,
  client: BlobServiceClient,
): Promise<PublishResult> {
  assertSafeTenantId(options.tenant);
  assertSafeEnvironment(options.environment);
  assertSafeStorageAccount(options.storageAccount);
  return runPublish(options, client);
}

async function runPublish(
  options: PublishOptions,
  client: BlobServiceClient,
): Promise<PublishResult> {
  const entries = await listTemplateDirs(options.templatesDir);
  const compiled: CompiledEntry[] = [];
  const failed: PublishResult['failed'] = [];
  const seenKeys = new Set<string>();

  for (const dirName of entries) {
    const dir = join(options.templatesDir, dirName);
    try {
      const result = await compileFromDirectory(dir, { sourceCommit: options.commit ?? '' });
      assertSafeTemplateKey(result.metadata.key);
      if (seenKeys.has(result.metadata.key)) {
        failed.push({
          key: dirName,
          error: `Duplicate template key "${result.metadata.key}" (already compiled from another directory).`,
        });
        continue;
      }
      seenKeys.add(result.metadata.key);
      compiled.push({ dirName, compiled: result });
    } catch (err) {
      failed.push({
        key: dirName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (failed.length > 0) {
    return { published: [], failed };
  }

  const containerClient = client.getContainerClient(options.container);
  const published: string[] = [];

  for (const entry of compiled) {
    const key = entry.compiled.metadata.key;
    const base = blobBasePath(options.tenant, options.environment, key);
    const htmlPath = `${base}/template.html`;
    const metaPath = `${base}/metadata.json`;

    await containerClient
      .getBlockBlobClient(htmlPath)
      .upload(entry.compiled.templateHtml, Buffer.byteLength(entry.compiled.templateHtml, 'utf8'), {
        blobHTTPHeaders: { blobContentType: 'text/html; charset=utf-8' },
      });
    const metadataJson = JSON.stringify(entry.compiled.metadata, null, 2);
    await containerClient
      .getBlockBlobClient(metaPath)
      .upload(metadataJson, Buffer.byteLength(metadataJson, 'utf8'), {
        blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' },
      });

    published.push(key);
    console.log(
      JSON.stringify({
        key,
        contentHash: entry.compiled.manifest.contentHash,
        templateHtml: htmlPath,
        metadataJson: metaPath,
      }),
    );
  }

  return { published, failed: [] };
}

async function listTemplateDirs(templatesDir: string): Promise<string[]> {
  const names = await readdir(templatesDir, { withFileTypes: true });
  const dirs = names.filter((d) => d.isDirectory()).map((d) => d.name);
  dirs.sort();

  for (const name of dirs) {
    for (const file of ['template.json', 'metadata.json', 'preview.json'] as const) {
      try {
        await readFile(join(templatesDir, name, file));
      } catch {
        throw new Error(`Template directory "${name}" is missing required file ${file}`);
      }
    }
  }

  return dirs;
}
