import React, { useCallback, useId, useState } from 'react';
import type { TemplatePreviewData } from '@singleton-sd/post-kit-types';

import { EDITOR_CLASS_PREFIX } from '../email-template-editor';
import { addPreviewKey, buildPreviewRows, removePreviewKey, setPreviewValue } from './preview-rows';

export interface PreviewDataEditorProps {
  /** Declared variable names from working `metadata.variables`. */
  declaredVariables: readonly string[];
  /** Working `preview.json` values. */
  previewData: TemplatePreviewData;
  /** Replace the working preview data object. */
  onChange: (previewData: TemplatePreviewData) => void;
}

/**
 * Key/value editor for `TemplatePreviewData`.
 *
 * Shows one row per declared variable (empty when missing from preview data)
 * plus removable rows for undeclared extras.
 */
export function PreviewDataEditor({
  declaredVariables,
  previewData,
  onChange,
}: PreviewDataEditorProps): JSX.Element {
  const p = EDITOR_CLASS_PREFIX;
  const rows = buildPreviewRows(declaredVariables, previewData);
  const [newKey, setNewKey] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const addInputId = useId();

  const handleValueChange = useCallback(
    (key: string, value: string) => {
      onChange(setPreviewValue(previewData, key, value));
    },
    [onChange, previewData],
  );

  const handleRemove = useCallback(
    (key: string) => {
      onChange(removePreviewKey(previewData, key));
    },
    [onChange, previewData],
  );

  const handleAdd = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      const next = addPreviewKey(previewData, newKey);
      if (next === null) {
        const trimmed = newKey.trim();
        setAddError(
          trimmed === '' ? 'Enter a variable name.' : `"${trimmed}" is already in preview data.`,
        );
        return;
      }
      setAddError(null);
      setNewKey('');
      onChange(next);
    },
    [newKey, onChange, previewData],
  );

  return (
    <section className={`${p}preview-data`} data-testid={`${p}preview-data`}>
      <h2 className={`${p}preview-data-heading`}>Preview data</h2>
      <p className={`${p}preview-data-hint`}>
        Sample values only — never real personal data. These are committed with the template source.
      </p>

      <ul className={`${p}preview-data-list`} data-testid={`${p}preview-data-list`}>
        {rows.map((row) => (
          <li
            key={row.key}
            className={`${p}preview-data-row${row.extra ? ` ${p}preview-data-row-extra` : ''}`}
            data-testid={`${p}preview-data-row`}
            data-extra={row.extra ? 'true' : 'false'}
            data-key={row.key}
          >
            <label className={`${p}preview-data-key`} htmlFor={`${p}preview-${row.key}`}>
              {row.key}
              {row.extra ? (
                <span className={`${p}preview-data-extra-badge`} data-testid={`${p}preview-extra`}>
                  extra
                </span>
              ) : null}
            </label>
            <input
              id={`${p}preview-${row.key}`}
              className={`${p}preview-data-value`}
              type="text"
              value={row.value}
              onChange={(event) => handleValueChange(row.key, event.target.value)}
              data-testid={`${p}preview-value-${row.key}`}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className={`${p}preview-data-remove`}
              onClick={() => handleRemove(row.key)}
              data-testid={`${p}preview-remove-${row.key}`}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      <form
        className={`${p}preview-data-add`}
        onSubmit={handleAdd}
        data-testid={`${p}preview-data-add`}
      >
        <label className={`${p}preview-data-label`} htmlFor={addInputId}>
          Add preview key
        </label>
        <input
          id={addInputId}
          className={`${p}preview-data-input`}
          type="text"
          value={newKey}
          onChange={(event) => {
            setNewKey(event.target.value);
            setAddError(null);
          }}
          placeholder="variable.name"
          autoComplete="off"
          spellCheck={false}
          data-testid={`${p}preview-add-key`}
        />
        <button
          type="submit"
          className={`${p}preview-data-add-button`}
          data-testid={`${p}preview-add`}
        >
          Add
        </button>
        {addError ? (
          <p
            className={`${p}preview-data-error`}
            data-testid={`${p}preview-add-error`}
            role="status"
          >
            {addError}
          </p>
        ) : null}
      </form>
    </section>
  );
}
