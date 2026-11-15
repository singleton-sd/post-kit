/**
 * Wrap documents as `TemplateSourceFiles` for Admin / Editor stories.
 */
import { loadTemplateSource, type TemplateSourceFiles, type TemplateVariable } from '../../src';
import type { EmailBuilderDocument } from '../../src';

import {
  createEmptyEmailDocument,
  otpDocument,
  passwordResetDocument,
  receiptDocument,
  reportDocument,
  transactionalDocument,
  welcomeDocument,
} from './documents';

export function createTemplateSource(options: {
  key: string;
  name: string;
  subject: string;
  document: EmailBuilderDocument;
  variables?: string[];
  description?: string;
  previewData?: Record<string, string>;
}): TemplateSourceFiles {
  const variables = options.variables ?? [];
  const previewData = options.previewData ?? Object.fromEntries(variables.map((v) => [v, v]));
  return loadTemplateSource({
    templateJson: options.document,
    metadata: {
      key: options.key,
      name: options.name,
      subject: options.subject,
      description: options.description,
      variables,
      schemaVersion: '1',
    },
    previewData,
  });
}

export const emptyTemplate = createTemplateSource({
  key: 'demo.empty',
  name: 'Empty',
  subject: 'Empty draft',
  document: createEmptyEmailDocument(),
  description: 'Blank EmailLayout for Storybook',
});

export const welcomeTemplate = createTemplateSource({
  key: 'demo.welcome',
  name: 'Welcome',
  subject: 'Welcome, {{name}}',
  document: welcomeDocument,
  variables: ['name'],
  previewData: { name: 'Alex' },
  description: 'Welcome email sample (images as data URIs)',
});

export const otpTemplate = createTemplateSource({
  key: 'demo.otp',
  name: 'One-time passcode',
  subject: 'Your code is {{code}}',
  document: otpDocument,
  variables: ['code'],
  previewData: { code: '482910' },
});

export const passwordResetTemplate = createTemplateSource({
  key: 'demo.password-reset',
  name: 'Password reset',
  subject: 'Reset your password',
  document: passwordResetDocument,
  variables: [],
});

export const transactionalTemplate = createTemplateSource({
  key: 'demo.transactional',
  name: 'Respond to inquiry',
  subject: 'Re: your message',
  document: transactionalDocument,
  variables: [],
});

export const receiptTemplate = createTemplateSource({
  key: 'demo.receipt',
  name: 'Order receipt',
  subject: 'Your order receipt',
  document: receiptDocument,
  variables: [],
});

export const reportTemplate = createTemplateSource({
  key: 'demo.report',
  name: 'Post metrics report',
  subject: 'Your weekly report',
  document: reportDocument,
  variables: [],
});

/** Catalog used by Overview / ExistingWelcome. */
export const demoCatalog: TemplateSourceFiles[] = [
  welcomeTemplate,
  otpTemplate,
  passwordResetTemplate,
  transactionalTemplate,
  receiptTemplate,
  reportTemplate,
  emptyTemplate,
];

export const sampleAvailableVariables: TemplateVariable[] = [
  { name: 'name', label: 'Recipient name', description: 'Synthetic display name' },
  { name: 'code', label: 'OTP code', description: 'One-time passcode' },
];
