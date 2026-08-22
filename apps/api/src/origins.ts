const AZURE_SWA_ROOT = 'azurestaticapps.net';
const SWA_INSTANCE_SUFFIX = `*.${AZURE_SWA_ROOT}`;

export function parseOrigins(raw: string | undefined): string[] {
  if (!raw?.trim()) {
    throw new Error('ORIGINS must be a comma-separated list of allowed hostnames');
  }
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

/**
 * Allow exact hostnames, generic `*` globs, and marketing SWA instance prefixes
 * (`purple-field-05048bf00*.azurestaticapps.net`) for default + PR preview hosts.
 * Do not use open `*.azurestaticapps.net` (any Azure customer’s SWA).
 */
export function isAllowedHostname(host: string, origins: readonly string[]): boolean {
  for (const entry of origins) {
    if (entry === host) {
      return true;
    }

    if (entry.endsWith(SWA_INSTANCE_SUFFIX)) {
      const swaName = entry.slice(0, -SWA_INSTANCE_SUFFIX.length);
      if (!swaName || swaName.includes('*')) {
        continue;
      }
      if (!host.endsWith(`.${AZURE_SWA_ROOT}`)) {
        continue;
      }
      if (host.startsWith(`${swaName}.`) || host.startsWith(`${swaName}-`)) {
        return true;
      }
      continue;
    }

    if (entry.includes('*')) {
      const regex = new RegExp(`^${entry.replace(/\./g, '\\.').replace(/\*/g, '[\\w_.-]+')}$`);
      if (regex.test(host)) {
        return true;
      }
    }
  }
  return false;
}
