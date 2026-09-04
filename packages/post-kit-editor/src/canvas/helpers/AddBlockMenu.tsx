import React, { useState } from 'react';

import { EDITOR_CLASS_PREFIX } from '../../email-template-editor';
import type { TEditorBlock } from '../editor-core';

import { BLOCK_TEMPLATES } from './block-templates';

type AddBlockButtonProps = {
  placeholder?: boolean;
  onSelect: (block: TEditorBlock) => void;
};

export default function AddBlockButton({
  onSelect,
  placeholder,
}: AddBlockButtonProps): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={`${EDITOR_CLASS_PREFIX}add-block`}
      style={{ position: 'relative', padding: '4px 0' }}
    >
      <button
        type="button"
        className={`${EDITOR_CLASS_PREFIX}add-block-trigger`}
        onClick={() => setOpen((value) => !value)}
      >
        {placeholder ? '+ Add block' : '+'}
      </button>
      {open ? (
        <div
          className={`${EDITOR_CLASS_PREFIX}add-block-menu`}
          style={{
            position: 'absolute',
            zIndex: 10,
            background: '#fff',
            border: '1px solid #ccc',
            borderRadius: '4px',
            padding: '4px',
            minWidth: '140px',
          }}
        >
          {BLOCK_TEMPLATES.map((template) => (
            <button
              key={template.label}
              type="button"
              className={`${EDITOR_CLASS_PREFIX}add-block-option`}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '4px 8px' }}
              onClick={() => {
                onSelect(template.block());
                setOpen(false);
              }}
            >
              {template.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
