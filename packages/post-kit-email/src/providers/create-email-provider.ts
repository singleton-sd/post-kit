import { DevelopmentEmailProvider } from './development-email.provider';
import type { EmailProvider, EmailProviderName } from './email-types';
import { ForwardEmailProvider } from './forward-email.provider';

export interface EmailRuntimeConfig {
  provider: EmailProviderName;
  fromAddress: string;
  fromName: string;
  contactInboxAddress: string;
  forwardEmailTokenConfigured: boolean;
}

/**
 * Resolve non-secret email configuration.
 * Prefer EMAIL_* / CONTACT_INBOX_ADDRESS; accept legacy CONTACT_* aliases.
 */
/** Whether live Forward Email sends are permitted for the current environment. */
function isProductionSendAllowed(env: NodeJS.ProcessEnv): boolean {
  return env.EMAIL_ALLOW_PRODUCTION_SEND === 'true';
}

export function loadEmailRuntimeConfig(env: NodeJS.ProcessEnv = process.env): EmailRuntimeConfig {
  const explicit = (env.EMAIL_PROVIDER ?? '').trim().toLowerCase();
  let provider: EmailProviderName;
  if (explicit === 'forward-email' || explicit === 'forwardemail') {
    provider = isProductionSendAllowed(env) ? 'forward-email' : 'development';
  } else if (explicit === 'development' || explicit === 'dev') {
    provider = 'development';
  } else if (env.NODE_ENV === 'production') {
    // Production must opt into Forward Email explicitly via EMAIL_PROVIDER or
    // by having a token *and* not running a PR preview marker.
    provider = isProductionSendAllowed(env) ? 'forward-email' : 'development';
  } else {
    provider = 'development';
  }

  const fromAddress =
    env.EMAIL_FROM_ADDRESS?.trim() ||
    env.CONTACT_FROM_EMAIL?.trim() ||
    'noreply@mail.plattform-kit.poc.singletonsd.com';
  const fromName = env.EMAIL_FROM_NAME?.trim() || 'Plattform Kit';
  const contactInboxAddress =
    env.CONTACT_INBOX_ADDRESS?.trim() || env.CONTACT_INBOX_EMAIL?.trim() || 'hello@singletonsd.com';

  const forwardEmailTokenConfigured = Boolean(
    env.FORWARD_EMAIL_TOKEN?.trim() || env.FORWARDEMAIL_API_KEY?.trim(),
  );

  return {
    provider,
    fromAddress,
    fromName,
    contactInboxAddress,
    forwardEmailTokenConfigured,
  };
}

export function createEmailProvider(env: NodeJS.ProcessEnv = process.env): EmailProvider {
  const config = loadEmailRuntimeConfig(env);
  if (config.provider === 'forward-email') {
    return new ForwardEmailProvider({
      apiToken: env.FORWARD_EMAIL_TOKEN ?? env.FORWARDEMAIL_API_KEY,
      baseUrl: env.FORWARD_EMAIL_BASE_URL ?? env.FORWARDEMAIL_BASE_URL,
    });
  }
  return new DevelopmentEmailProvider();
}
