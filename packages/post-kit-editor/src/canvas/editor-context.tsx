import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

import type { EmailBuilderDocument } from '../types';
import type { TEditorBlock } from './editor-core';

type CanvasEditorContextValue = {
  document: EmailBuilderDocument;
  selectedBlockId: string | null;
  setSelectedBlockId: (blockId: string | null) => void;
  patchDocument: (partial: Record<string, TEditorBlock>) => void;
  replaceDocument: (document: EmailBuilderDocument) => void;
};

const CanvasEditorContext = createContext<CanvasEditorContextValue | null>(null);

export function CanvasEditorProvider({
  document,
  onChange,
  children,
}: {
  document: EmailBuilderDocument;
  onChange: (document: EmailBuilderDocument) => void;
  children: React.ReactNode;
}): JSX.Element {
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);

  const patchDocument = useCallback(
    (partial: Record<string, TEditorBlock>) => {
      onChange({
        ...document,
        ...partial,
      });
    },
    [document, onChange],
  );

  const replaceDocument = useCallback(
    (nextDocument: EmailBuilderDocument) => {
      onChange(nextDocument);
    },
    [onChange],
  );

  const value = useMemo(
    () => ({
      document,
      selectedBlockId,
      setSelectedBlockId,
      patchDocument,
      replaceDocument,
    }),
    [document, selectedBlockId, patchDocument, replaceDocument],
  );

  return <CanvasEditorContext.Provider value={value}>{children}</CanvasEditorContext.Provider>;
}

export function useCanvasEditor(): CanvasEditorContextValue {
  const context = useContext(CanvasEditorContext);
  if (!context) {
    throw new Error('useCanvasEditor must be used within CanvasEditorProvider');
  }
  return context;
}

export function useDocument(): EmailBuilderDocument {
  return useCanvasEditor().document;
}

export function useSelectedBlockId(): string | null {
  return useCanvasEditor().selectedBlockId;
}

export function useSetSelectedBlockId(): (blockId: string | null) => void {
  return useCanvasEditor().setSelectedBlockId;
}

export function usePatchDocument(): (partial: Record<string, TEditorBlock>) => void {
  return useCanvasEditor().patchDocument;
}

export function useReplaceDocument(): (document: EmailBuilderDocument) => void {
  return useCanvasEditor().replaceDocument;
}
