import React, { Fragment } from 'react';

import { EditorBlock } from '../EditorBlock';
import type { TEditorBlock } from '../editor-core';

import AddBlockButton from './AddBlockMenu';

export type EditorChildrenChange = {
  blockId: string;
  block: TEditorBlock;
  childrenIds: string[];
};

function generateId(): string {
  return `block-${Date.now()}`;
}

export type EditorChildrenIdsProps = {
  childrenIds: string[] | null | undefined;
  onChange: (val: EditorChildrenChange) => void;
};

export default function EditorChildrenIds({
  childrenIds,
  onChange,
}: EditorChildrenIdsProps): JSX.Element {
  const appendBlock = (block: TEditorBlock) => {
    const blockId = generateId();
    onChange({
      blockId,
      block,
      childrenIds: [...(childrenIds || []), blockId],
    });
  };

  const insertBlock = (block: TEditorBlock, index: number) => {
    const blockId = generateId();
    const nextChildrenIds = [...(childrenIds || [])];
    nextChildrenIds.splice(index, 0, blockId);
    onChange({
      blockId,
      block,
      childrenIds: nextChildrenIds,
    });
  };

  if (!childrenIds || childrenIds.length === 0) {
    return <AddBlockButton placeholder onSelect={appendBlock} />;
  }

  return (
    <>
      {childrenIds.map((childId, index) => (
        <Fragment key={childId}>
          <AddBlockButton onSelect={(block) => insertBlock(block, index)} />
          <EditorBlock id={childId} />
        </Fragment>
      ))}
      <AddBlockButton onSelect={appendBlock} />
    </>
  );
}
