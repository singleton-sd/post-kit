import React, { type CSSProperties, useState } from 'react';

import { useCurrentBlockId } from '../EditorBlock';
import { useSelectedBlockId, useSetSelectedBlockId } from '../editor-context';

type EditorBlockWrapperProps = {
  children: JSX.Element;
};

export default function EditorBlockWrapper({ children }: EditorBlockWrapperProps): JSX.Element {
  const selectedBlockId = useSelectedBlockId();
  const setSelectedBlockId = useSetSelectedBlockId();
  const [mouseInside, setMouseInside] = useState(false);
  const blockId = useCurrentBlockId();

  let outline: CSSProperties['outline'];
  if (selectedBlockId === blockId) {
    outline = '2px solid rgba(0,121,204, 1)';
  } else if (mouseInside) {
    outline = '2px solid rgba(0,121,204, 0.3)';
  }

  return (
    <div
      style={{
        position: 'relative',
        maxWidth: '100%',
        outlineOffset: '-1px',
        outline,
      }}
      onMouseEnter={(event) => {
        setMouseInside(true);
        event.stopPropagation();
      }}
      onMouseLeave={() => {
        setMouseInside(false);
      }}
      onClick={(event) => {
        setSelectedBlockId(blockId);
        event.stopPropagation();
        event.preventDefault();
      }}
    >
      {children}
    </div>
  );
}
