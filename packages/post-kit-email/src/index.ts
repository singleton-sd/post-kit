export type {
  EmailProvider,
  EmailProviderErrorKind,
  EmailProviderName,
  EmailSendRequest,
  EmailSendResult,
  EmailRuntimeConfig,
  ForwardEmailProviderOptions,
  DevelopmentEmailProviderOptions,
} from './providers/email-provider';
export {
  assertSafeEmailHeader,
  createEmailProvider,
  DevelopmentEmailProvider,
  EmailProviderError,
  formatFromHeader,
  ForwardEmailProvider,
  loadEmailRuntimeConfig,
  sanitizeHeaderValue,
} from './providers/email-provider';

export type {
  ContactInquiryInput,
  ContactSubject,
  ContactValidationResult,
} from './contact/contact-email';
export type {
  ContactEmailProfile,
  TenantEmailProfileOverride,
} from './contact/contact-email-profile';
export {
  CONTACT_SUBJECTS,
  buildContactEmailRequest,
  hasForbiddenControls,
  sendContactInquiryEmail,
  validateContactInquiry,
} from './contact/contact-email';
export {
  clearHostProfileMapCache,
  getHostProfileMap,
  resolveContactEmailProfile,
  resolveTenantEmailProfileOverride,
} from './contact/contact-email-profile';
export type {
  DmarcPolicy,
  TransactionalEmailAuthProfile,
} from './contact/transactional-email-auth-profile';
export {
  extractEmailDomain,
  loadTransactionalEmailAuthProfile,
  validateResolvedSenderDomainAlignment,
  validateTransactionalEmailAuthProfile,
} from './contact/transactional-email-auth-profile';

export type {
  ForwardEmailAliasSummary,
  ForwardEmailDnsRecord,
  ForwardEmailDomainSummary,
  ForwardEmailManagementClientOptions,
} from './provisioning/forward-email-management';
export {
  ForwardEmailManagementClient,
  getRequiredDnsRecords,
  mergeSpfInclude,
} from './provisioning/forward-email-management';

export type {
  EmailDomainBrandingValidationCheck,
  EmailDomainBrandingValidationConfig,
  EmailDomainBrandingValidationDependencies,
  EmailDomainBrandingValidationReport,
  ValidationStatus,
} from './provisioning/email-domain-branding-validator';
export {
  validateBimiSvgStructure,
  validateEmailDomainBranding,
} from './provisioning/email-domain-branding-validator';
