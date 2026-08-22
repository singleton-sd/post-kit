import {
  type EmailDomainBrandingValidationConfig,
  validateEmailDomainBranding,
} from './email-domain-branding-validator';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = buildConfigFromEnvAndArgs(args);
  const report = await validateEmailDomainBranding(config);

  for (const check of report.checks) {
    const icon =
      check.status === 'pass'
        ? 'PASS'
        : check.status === 'fail'
          ? 'FAIL'
          : check.status === 'warn'
            ? 'WARN'
            : 'SKIP';
    console.log(`[${icon}] ${check.id}: ${check.message}`);
  }

  if (report.errors.length > 0) {
    console.error(
      `\nEmail-domain branding validation failed with ${report.errors.length} error(s).`,
    );
    process.exitCode = 1;
    return;
  }

  if (report.warnings.length > 0) {
    console.warn(`\nValidation passed with ${report.warnings.length} warning(s).`);
  } else {
    console.log('\nValidation passed.');
  }
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      out[key] = 'true';
      continue;
    }
    out[key] = value;
    index += 1;
  }
  return out;
}

function buildConfigFromEnvAndArgs(
  args: Record<string, string>,
): EmailDomainBrandingValidationConfig {
  const domain =
    args.domain ?? process.env.EMAIL_VALIDATION_DOMAIN ?? process.env.EMAIL_FROM_DOMAIN ?? '';
  const dkimSelector =
    args.dkimSelector ??
    process.env.EMAIL_VALIDATION_DKIM_SELECTOR ??
    process.env.EMAIL_DKIM_SELECTOR ??
    'fe';
  const expectedDmarcPolicy = (args.expectedDmarcPolicy ??
    process.env.EMAIL_VALIDATION_DMARC_POLICY ??
    process.env.EMAIL_DMARC_POLICY ??
    'quarantine') as EmailDomainBrandingValidationConfig['expectedDmarcPolicy'];
  const bimiSelector = args.bimiSelector ?? process.env.EMAIL_VALIDATION_BIMI_SELECTOR ?? 'default';
  const expectedBimiLogoUrl =
    args.expectedBimiLogoUrl ?? process.env.EMAIL_VALIDATION_BIMI_LOGO_URL;
  const requireBimiSvg = (
    args.requireBimiSvg ??
    process.env.EMAIL_VALIDATION_REQUIRE_BIMI_SVG ??
    'true'
  )
    .toLowerCase()
    .trim();

  return {
    domain,
    dkimSelector,
    expectedDmarcPolicy,
    bimiSelector,
    expectedBimiLogoUrl,
    requireBimiSvg: requireBimiSvg !== 'false',
  };
}

void main();
