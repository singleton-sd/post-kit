/**
 * Derive Function App platform CORS allowedOrigins from App Config values.
 *
 * Azure platform CORS requires exact origin URLs (scheme + host[:port]).
 * It does not support hostname globs like `*.poc.singletonsd.com`.
 *
 * Source of truth for *which* consumers exist is App Config:
 * - exact entries in `app:email:origins` (no `*`)
 * - every host key in `app:email:profilesByHost`
 *
 * Globs in ORIGINS still apply at the function layer (`contactCorsHeaders`)
 * once the request reaches the worker; platform preflight uses this list.
 */

/**
 * @param {string | undefined} raw
 * @returns {string[]}
 */
export function parseOriginsList(raw) {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * @param {string} host hostname or host:port (no scheme)
 * @returns {string} origin URL
 */
export function originUrlForHost(host) {
  const normalized = host.trim().toLowerCase();
  if (!normalized) {
    throw new Error('host must be non-empty');
  }
  if (normalized === 'localhost' || normalized.startsWith('localhost:')) {
    return `http://${normalized}`;
  }
  return `https://${normalized}`;
}

/**
 * @param {{ originsRaw?: string, profilesByHostRaw?: string }} input
 * @returns {string[]} sorted unique origin URLs
 */
export function platformCorsOriginsFromAppConfig(input) {
  const hosts = new Set();

  for (const entry of parseOriginsList(input.originsRaw)) {
    if (entry.includes('*')) continue;
    hosts.add(entry.toLowerCase());
  }

  const profilesRaw = input.profilesByHostRaw?.trim();
  if (profilesRaw) {
    let profiles;
    try {
      profiles = JSON.parse(profilesRaw);
    } catch {
      throw new Error('app:email:profilesByHost must be valid JSON');
    }
    if (profiles === null || typeof profiles !== 'object' || Array.isArray(profiles)) {
      throw new Error('app:email:profilesByHost must be a JSON object map by host');
    }
    for (const host of Object.keys(profiles)) {
      const h = host.trim().toLowerCase();
      if (h) hosts.add(h);
    }
  }

  return [...hosts].map(originUrlForHost).sort();
}
