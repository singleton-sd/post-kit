import React, { createContext, useContext } from 'react';

import { EditorBlock as CoreEditorBlock } from './editor-core';
import { useDocument } from './editor-context';

const EditorBlockContext = createContext<string | null>(null);

export function useCurrentBlockId(): string {
  const blockId = useContext(EditorBlockContext);
  if (!blockId) {
    throw new Error('useCurrentBlockId must be used within EditorBlock');
  }
  return blockId;
}

type EditorBlockProps = {
  id: string;
};

export function EditorBlock({ id }: EditorBlockProps): JSX.Element {
  const document = useDocument();
  const block = document[id];
  if (!block) {
    throw new Error(`Could not find block "${id}"`);
  }

  return (
    <EditorBlockContext.Provider value={id}>
      <CoreEditorBlock {...block} />
    </EditorBlockContext.Provider>
  );
}
