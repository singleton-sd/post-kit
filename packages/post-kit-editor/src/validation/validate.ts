import type { TemplateSourceFiles } from '../types';
import { templateKeyInputError } from '../metadata/template-key';
import {
  extractPlaceholdersFromDocument,
  extractPlaceholdersFromText,
} from './extract-placeholders';

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  severity: ValidationSeverity;
  /** Stable machine-readable identifier, e.g. `undeclared-variable`. */
  code: string;
  /** Human-readable message shown in the UI. */
  message: string;
  /** Which part of the editor the issue belongs to. */
  field: 'metadata' | 'subject' | 'document' | 'previewData';
  /** Variable name, when the issue concerns one. */
  variable?: string;
}

export interface ValidateTemplateOptions {
  /**
   * When the preview pane already failed to render, pass its error message so
   * `render-failed` is reported without compiling a second time.
   */
  renderError?: string | null;
}

/**
 * Pure, synchronous validation of working template source.
 * Does not auto-fix files. Warnings never imply save should be blocked —
 * callers gate on `severity === 'error'` only.
 */
export function validateTemplate(
  files: TemplateSourceFiles,
  options: ValidateTemplateOptions = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { metadata, previewData, templateJson } = files;

  const key = metadata.key.trim();
  if (key === '') {
    issues.push({
      severity: 'error',
      code: 'missing-key',
      message: 'Template key is required.',
      field: 'metadata',
    });
  } else {
    const keyError = templateKeyInputError(metadata.key);
    if (keyError) {
      issues.push({
        severity: 'error',
        code: 'invalid-key',
        message: keyError,
        field: 'metadata',
      });
    }
  }

  if (metadata.name.trim() === '') {
    issues.push({
      severity: 'error',
      code: 'missing-name',
      message: 'Template name is required.',
      field: 'metadata',
    });
  }

  if (metadata.subject.trim() === '') {
    issues.push({
      severity: 'error',
      code: 'missing-subject',
      message: 'Subject is required.',
      field: 'subject',
    });
  }

  const declared = metadata.variables;
  const declaredSet = new Set(declared);
  const subjectPlaceholders = extractPlaceholdersFromText(metadata.subject);
  const documentPlaceholders = extractPlaceholdersFromDocument(templateJson);
  const used = new Set([...subjectPlaceholders, ...documentPlaceholders]);

  for (const name of subjectPlaceholders) {
    if (!declaredSet.has(name)) {
      issues.push({
        severity: 'error',
        code: 'undeclared-variable',
        message: `Variable "{{${name}}}" is used in the subject but is not declared.`,
        field: 'subject',
        variable: name,
      });
    }
  }

  for (const name of documentPlaceholders) {
    if (!declaredSet.has(name)) {
      issues.push({
        severity: 'error',
        code: 'undeclared-variable',
        message: `Variable "{{${name}}}" is used in the document but is not declared.`,
        field: 'document',
        variable: name,
      });
    }
  }

  for (const name of declared) {
    const value = previewData[name];
    if (value === undefined || value.trim() === '') {
      issues.push({
        severity: 'error',
        code: 'missing-preview-value',
        message: `Declared variable "${name}" has no preview value.`,
        field: 'previewData',
        variable: name,
      });
    }
  }

  for (const name of declared) {
    if (!used.has(name)) {
      issues.push({
        severity: 'warning',
        code: 'unused-variable',
        message: `Declared variable "${name}" is not used in the subject or document.`,
        field: 'metadata',
        variable: name,
      });
    }
  }

  for (const name of Object.keys(previewData)) {
    if (!declaredSet.has(name)) {
      issues.push({
        severity: 'warning',
        code: 'extra-preview-value',
        message: `Preview value "${name}" is not declared in metadata.variables.`,
        field: 'previewData',
        variable: name,
      });
    }
  }

  if (options.renderError) {
    issues.push({
      severity: 'error',
      code: 'render-failed',
      message: options.renderError,
      field: 'document',
    });
  }

  return issues;
}

/** True when any issue would block Save / Send-test. */
export function hasValidationErrors(issues: readonly ValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}

/**
 * DOM id of the control that owns an issue (matches MetadataPanel /
 * PreviewDataEditor / canvas / variables ids).
 */
export function focusTargetIdForIssue(issue: ValidationIssue): string {
  const p = 'pk-editor-';
  switch (issue.field) {
    case 'metadata':
      if (issue.code === 'missing-key' || issue.code === 'invalid-key') {
        return `${p}meta-key`;
      }
      if (issue.code === 'missing-name') {
        return `${p}meta-name`;
      }
      if (issue.code === 'unused-variable') {
        return `${p}variables`;
      }
      return `${p}meta-key`;
    case 'subject':
      return `${p}meta-subject`;
    case 'document':
      return `${p}canvas`;
    case 'previewData':
      return issue.variable ? `${p}preview-${domIdSegment(issue.variable)}` : `${p}preview-data`;
    default:
      return `${p}root`;
  }
}

/**
 * Encode a variable/key name into a single DOM id token (no whitespace) so
 * `aria-describedby` lists stay valid.
 */
export function domIdSegment(value: string): string {
  return encodeURIComponent(value).replace(/%/g, '_');
}

/** Element id for an inline issue description (aria-describedby). */
export function inlineIssueId(code: string, variable?: string): string {
  const suffix = variable ? `${code}-${domIdSegment(variable)}` : code;
  return `pk-editor-issue-${suffix}`;
}
