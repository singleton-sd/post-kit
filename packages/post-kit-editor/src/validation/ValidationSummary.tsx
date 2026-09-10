import React from 'react';

import { EDITOR_CLASS_PREFIX } from '../email-template-editor';
import { focusTargetIdForIssue, type ValidationIssue, type ValidationSeverity } from './validate';

export interface ValidationSummaryProps {
  issues: readonly ValidationIssue[];
}

/**
 * Lists validation issues grouped by severity. Live region announces changes.
 * Each entry focuses the responsible control when activated.
 */
export function ValidationSummary({ issues }: ValidationSummaryProps): JSX.Element | null {
  const p = EDITOR_CLASS_PREFIX;
  if (issues.length === 0) {
    return null;
  }

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  return (
    <section
      className={`${p}validation`}
      data-testid={`${p}validation`}
      aria-label="Template validation"
    >
      <h2 className={`${p}validation-heading`}>Validation</h2>
      <div
        className={`${p}validation-live`}
        data-testid={`${p}validation-live`}
        aria-live="polite"
        aria-relevant="additions text"
      >
        {errors.length > 0 ? <IssueGroup title="Errors" severity="error" issues={errors} /> : null}
        {warnings.length > 0 ? (
          <IssueGroup title="Warnings" severity="warning" issues={warnings} />
        ) : null}
      </div>
    </section>
  );
}

function IssueGroup({
  title,
  severity,
  issues,
}: {
  title: string;
  severity: ValidationSeverity;
  issues: readonly ValidationIssue[];
}): JSX.Element {
  const p = EDITOR_CLASS_PREFIX;
  return (
    <div
      className={`${p}validation-group ${p}validation-group-${severity}`}
      data-testid={`${p}validation-${severity}s`}
    >
      <h3 className={`${p}validation-group-title`}>
        <span className={`${p}validation-icon`} aria-hidden="true">
          {severity === 'error' ? '!' : 'i'}
        </span>{' '}
        {title}
      </h3>
      <ul className={`${p}validation-list`}>
        {issues.map((issue) => {
          const targetId = focusTargetIdForIssue(issue);
          const key = `${issue.code}:${issue.field}:${issue.variable ?? ''}:${issue.message}`;
          return (
            <li key={key} className={`${p}validation-item`}>
              <button
                type="button"
                className={`${p}validation-link`}
                data-testid={`${p}validation-link-${issue.code}`}
                data-focus-target={targetId}
                onClick={() => {
                  const el = document.getElementById(targetId);
                  if (el && 'focus' in el && typeof el.focus === 'function') {
                    el.focus();
                  }
                }}
              >
                <span className={`${p}validation-code`}>{issue.code}</span>
                {': '}
                {issue.message}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
