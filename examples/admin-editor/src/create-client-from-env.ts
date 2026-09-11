/**
 * Build a {@link PostKitClient} from process env for admin Send-test BFFs.
 *
 * Required:
 * - `POSTKIT_API_BASE_URL` — PostKit API base (no trailing slash required)
 * - `POSTKIT_API_KEY` — Bearer credential (consumer Key Vault / secret store)
 *
 * Never call this from a browser bundle.
 */
import { PostKitClient } from '@singleton-sd/post-kit-client';

/** True when both Send-test env vars are non-empty (same gate as the BFF). */
export function isSendTestEnvConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env['POSTKIT_API_BASE_URL']?.trim() && env['POSTKIT_API_KEY']?.trim());
}

export function createPostKitClientFromEnv(env: NodeJS.ProcessEnv = process.env): PostKitClient {
  if (!isSendTestEnvConfigured(env)) {
    const endpoint = env['POSTKIT_API_BASE_URL']?.trim();
    if (!endpoint) {
      throw new Error('POSTKIT_API_BASE_URL is required for Send-test.');
    }
    throw new Error('POSTKIT_API_KEY is required for Send-test.');
  }
  return new PostKitClient({
    endpoint: env['POSTKIT_API_BASE_URL']!.trim(),
    apiKey: env['POSTKIT_API_KEY']!.trim(),
  });
}
