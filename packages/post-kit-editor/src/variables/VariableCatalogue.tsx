import React, { useCallback, useId, useRef, useState } from 'react';

import { EDITOR_CLASS_PREFIX } from '../email-template-editor';
import { useInsertionTarget } from '../insertion-target';
import { variablePlaceholder } from '../metadata/insert-at-cursor';
import type { TemplateVariable } from '../types';
import { copyTextToClipboard } from './clipboard';
import { resolveCatalogueVariables } from './resolve-catalogue';

export interface VariableCatalogueProps {
  /** Consumer-supplied catalogue; when omitted, derived from `metadataVariables`. */
  availableVariables?: TemplateVariable[];
  /** Declared variable names from working metadata (validation / compiler source). */
  metadataVariables: string[];
  onMetadataVariablesChange: (variables: string[]) => void;
}

/**
 * Lists available template variables with copy / insert affordances, and lets
 * the user add or remove declared `metadata.variables` entries.
 */
export function VariableCatalogue({
  availableVariables,
  metadataVariables,
  onMetadataVariablesChange,
}: VariableCatalogueProps): JSX.Element {
  const p = EDITOR_CLASS_PREFIX;
  const { target } = useInsertionTarget();
  const entries = resolveCatalogueVariables(availableVariables, metadataVariables);
  const [copiedName, setCopiedName] = useState<string | null>(null);
  const [newVariable, setNewVariable] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const fallbackSelectRef = useRef<HTMLInputElement | null>(null);
  const addInputId = useId();

  const handleCopy = useCallback(async (name: string) => {
    const text = variablePlaceholder(name);
    const result = await copyTextToClipboard(text);
    if (!result.ok) {
      const el = fallbackSelectRef.current;
      if (el) {
        el.value = text;
        el.focus();
        el.select();
      }
    }
    setCopiedName(name);
  }, []);

  const handleInsert = useCallback(
    (name: string) => {
      if (!target) {
        return;
      }
      target.insert(variablePlaceholder(name));
    },
    [target],
  );

  const handleAdd = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      const name = newVariable.trim();
      if (!name) {
        setAddError('Enter a variable name.');
        return;
      }
      if (metadataVariables.includes(name)) {
        setAddError(`"${name}" is already declared.`);
        return;
      }
      setAddError(null);
      setNewVariable('');
      onMetadataVariablesChange([...metadataVariables, name]);
    },
    [metadataVariables, newVariable, onMetadataVariablesChange],
  );

  const handleRemove = useCallback(
    (name: string) => {
      onMetadataVariablesChange(metadataVariables.filter((entry) => entry !== name));
    },
    [metadataVariables, onMetadataVariablesChange],
  );

  const insertDisabled = target === null;
  const insertDisabledReason =
    'Focus the subject field (or another editable target) before inserting a variable.';

  return (
    <section className={`${p}variables`} data-testid={`${p}variables`}>
      <h2 className={`${p}variables-heading`}>Available variables</h2>

      {/* Hidden fallback for clipboard-unavailable environments */}
      <input
        ref={fallbackSelectRef}
        className={`${p}variables-clipboard-fallback`}
        type="text"
        readOnly
        aria-hidden="true"
        tabIndex={-1}
        data-testid={`${p}variables-clipboard-fallback`}
      />

      {entries.length === 0 ? (
        <p className={`${p}variables-empty`}>No variables declared yet.</p>
      ) : (
        <ul className={`${p}variables-list`}>
          {entries.map((entry) => {
            const placeholder = variablePlaceholder(entry.name);
            const label = entry.label ?? entry.name;
            return (
              <li key={entry.name} className={`${p}variables-item`}>
                <div className={`${p}variables-item-main`}>
                  <span className={`${p}variables-item-label`}>{label}</span>
                  <code className={`${p}variables-item-placeholder`}>{placeholder}</code>
                  {entry.description ? (
                    <span className={`${p}variables-item-description`}>{entry.description}</span>
                  ) : null}
                </div>
                <div className={`${p}variables-item-actions`}>
                  <button
                    type="button"
                    className={`${p}variables-copy`}
                    onClick={() => {
                      void handleCopy(entry.name);
                    }}
                    data-testid={`${p}variables-copy-${entry.name}`}
                  >
                    {copiedName === entry.name ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    type="button"
                    className={`${p}variables-insert`}
                    onClick={() => handleInsert(entry.name)}
                    disabled={insertDisabled}
                    title={insertDisabled ? insertDisabledReason : `Insert ${placeholder}`}
                    aria-label={
                      insertDisabled
                        ? insertDisabledReason
                        : `Insert ${placeholder} into the focused field`
                    }
                    data-testid={`${p}variables-insert-${entry.name}`}
                  >
                    Insert
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className={`${p}variables-declared`}>
        <h3 className={`${p}variables-declared-heading`}>Declared variables</h3>
        <p className={`${p}variables-declared-hint`}>
          The declared list is what validation and the compiler use. Removing an entry does not
          rewrite the subject or document.
        </p>
        {metadataVariables.length > 0 ? (
          <ul className={`${p}variables-declared-list`}>
            {metadataVariables.map((name) => (
              <li key={name} className={`${p}variables-declared-item`}>
                <code>{variablePlaceholder(name)}</code>
                <button
                  type="button"
                  className={`${p}variables-remove`}
                  onClick={() => handleRemove(name)}
                  data-testid={`${p}variables-remove-${name}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <form className={`${p}variables-add`} onSubmit={handleAdd}>
          <label className={`${p}variables-add-label`} htmlFor={addInputId}>
            Add variable
          </label>
          <input
            id={addInputId}
            className={`${p}variables-add-input`}
            type="text"
            value={newVariable}
            onChange={(event) => {
              setNewVariable(event.target.value);
              setAddError(null);
            }}
            placeholder="e.g. firstName"
            data-testid={`${p}variables-add-input`}
          />
          <button
            type="submit"
            className={`${p}variables-add-submit`}
            data-testid={`${p}variables-add-submit`}
          >
            Add
          </button>
          {addError ? (
            <p className={`${p}variables-add-error`} role="status">
              {addError}
            </p>
          ) : null}
        </form>
      </div>
    </section>
  );
}
