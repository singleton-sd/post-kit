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

export function createPostKitClientFromEnv(env: NodeJS.ProcessEnv = process.env): PostKitClient {
  const endpoint = env['POSTKIT_API_BASE_URL']?.trim();
  const apiKey = env['POSTKIT_API_KEY']?.trim();
  if (!endpoint) {
    throw new Error('POSTKIT_API_BASE_URL is required for Send-test.');
  }
  if (!apiKey) {
    throw new Error('POSTKIT_API_KEY is required for Send-test.');
  }
  return new PostKitClient({ endpoint, apiKey });
}
