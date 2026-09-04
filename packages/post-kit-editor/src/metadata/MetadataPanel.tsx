import React, { useCallback, useRef, useState } from 'react';
import type { TemplatePreviewData, TemplateSourceMetadata } from '@singleton-sd/post-kit-types';

import { EDITOR_CLASS_PREFIX } from '../email-template-editor';
import { useRegisterInsertionTarget } from '../insertion-target';
import { insertAtCursor } from './insert-at-cursor';
import { previewSubject } from './subject-preview';
import { isAcceptableTemplateKeyInput, templateKeyInputError } from './template-key';

export interface MetadataPanelProps {
  metadata: TemplateSourceMetadata;
  previewData: TemplatePreviewData;
  onChange: (metadata: TemplateSourceMetadata) => void;
}

/**
 * Controlled metadata fields bound to `TemplateSourceMetadata`.
 * Subject supports variable insert via the shared insertion-target registry.
 */
export function MetadataPanel({
  metadata,
  previewData,
  onChange,
}: MetadataPanelProps): JSX.Element {
  const [keyError, setKeyError] = useState<string | null>(null);
  const subjectRef = useRef<HTMLInputElement | null>(null);

  const patch = useCallback(
    (partial: Partial<TemplateSourceMetadata>) => {
      onChange({ ...metadata, ...partial });
    },
    [metadata, onChange],
  );

  const handleKeyChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value;
      const error = templateKeyInputError(next);
      if (!isAcceptableTemplateKeyInput(next)) {
        setKeyError(error);
        return;
      }
      setKeyError(null);
      patch({ key: next });
    },
    [patch],
  );

  const insertIntoSubject = useCallback(
    (text: string) => {
      const el = subjectRef.current;
      const start = el?.selectionStart ?? metadata.subject.length;
      const end = el?.selectionEnd ?? start;
      const { value, caret } = insertAtCursor(metadata.subject, start, end, text);
      patch({ subject: value });
      // Restore caret after React re-render when a DOM node is available.
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
          const input = subjectRef.current;
          if (input) {
            input.focus();
            input.setSelectionRange(caret, caret);
          }
        });
      }
    },
    [metadata.subject, patch],
  );

  const subjectFocus = useRegisterInsertionTarget('subject field', insertIntoSubject);

  const subjectPreview = previewSubject(metadata.subject, previewData);
  const p = EDITOR_CLASS_PREFIX;

  return (
    <section className={`${p}metadata`} data-testid={`${p}metadata`}>
      <h2 className={`${p}metadata-heading`}>Template metadata</h2>

      <div className={`${p}metadata-field`}>
        <label className={`${p}metadata-label`} htmlFor={`${p}meta-key`}>
          Key
        </label>
        <input
          id={`${p}meta-key`}
          className={`${p}metadata-input`}
          type="text"
          value={metadata.key}
          onChange={handleKeyChange}
          autoComplete="off"
          spellCheck={false}
          data-testid={`${p}meta-key`}
        />
        {keyError ? (
          <p className={`${p}metadata-error`} data-testid={`${p}meta-key-error`} role="status">
            {keyError}
          </p>
        ) : null}
      </div>

      <div className={`${p}metadata-field`}>
        <label className={`${p}metadata-label`} htmlFor={`${p}meta-name`}>
          Name
        </label>
        <input
          id={`${p}meta-name`}
          className={`${p}metadata-input`}
          type="text"
          value={metadata.name}
          onChange={(event) => patch({ name: event.target.value })}
          data-testid={`${p}meta-name`}
        />
      </div>

      <div className={`${p}metadata-field`}>
        <label className={`${p}metadata-label`} htmlFor={`${p}meta-description`}>
          Description
        </label>
        <textarea
          id={`${p}meta-description`}
          className={`${p}metadata-textarea`}
          value={metadata.description ?? ''}
          onChange={(event) => {
            const description = event.target.value;
            if (description === '') {
              const { description: _removed, ...rest } = metadata;
              onChange(rest);
              return;
            }
            patch({ description });
          }}
          rows={3}
          data-testid={`${p}meta-description`}
        />
      </div>

      <div className={`${p}metadata-field`}>
        <label className={`${p}metadata-label`} htmlFor={`${p}meta-subject`}>
          Subject
        </label>
        <input
          id={`${p}meta-subject`}
          ref={subjectRef}
          className={`${p}metadata-input`}
          type="text"
          value={metadata.subject}
          onChange={(event) => patch({ subject: event.target.value })}
          onFocus={subjectFocus.onFocus}
          onBlur={subjectFocus.onBlur}
          data-testid={`${p}meta-subject`}
        />
        <p className={`${p}metadata-subject-preview`} data-testid={`${p}meta-subject-preview`}>
          Preview: {subjectPreview}
        </p>
      </div>

      <div className={`${p}metadata-field`}>
        <span className={`${p}metadata-label`}>Schema version</span>
        <span className={`${p}metadata-readonly`} data-testid={`${p}meta-schema-version`}>
          {metadata.schemaVersion}
        </span>
      </div>
    </section>
  );
}
