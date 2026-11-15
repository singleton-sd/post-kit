import { TEditorBlock, TEditorConfiguration } from '../../editor/core';

type TResult = {
  document: TEditorConfiguration;
  blockId: string;
};

/** Collision-safe block id; prefers `crypto.randomUUID` when available. */
export function createBlockId(document: TEditorConfiguration): string {
  const taken = (id: string) => Object.prototype.hasOwnProperty.call(document, id);

  if (typeof globalThis.crypto?.randomUUID === 'function') {
    let id: string;
    do {
      id = `block-${globalThis.crypto.randomUUID()}`;
    } while (taken(id));
    return id;
  }

  let n = 0;
  let id: string;
  do {
    id = `block-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}-${n++}`;
  } while (taken(id));
  return id;
}

function cloneChildrenIds(document: TEditorConfiguration, blockIds: string[]): string[] {
  return blockIds.map((blockId) => {
    const newBlock = cloneBlock(document, blockId);
    const newBlockId = createBlockId(document);
    document[newBlockId] = newBlock;
    return newBlockId;
  });
}

function cloneBlock(document: TEditorConfiguration, blockId: string): TEditorBlock {
  const clone = structuredClone(document[blockId]);
  switch (clone.type) {
    case 'EmailLayout':
      throw new Error('Cloning EmailLayout blocks is not supported.');
    case 'Avatar':
    case 'Button':
    case 'Divider':
    case 'Heading':
    case 'Html':
    case 'Image':
    case 'Spacer':
    case 'Text':
      return clone;
    case 'Container':
      if (clone.data?.props?.childrenIds) {
        clone.data.props.childrenIds = cloneChildrenIds(document, clone.data.props.childrenIds);
      }
      return clone;
    case 'ColumnsContainer': {
      const props = clone.data?.props;
      const columns = props?.columns;
      if (props && columns) {
        props.columns = columns.map((col) => ({
          ...(col ?? { childrenIds: [] }),
          childrenIds: cloneChildrenIds(document, col?.childrenIds ?? []),
        })) as typeof columns;
      }
      return clone;
    }
  }
}

export default function cloneDocumentBlock(
  originalDocument: TEditorConfiguration,
  originalBlockId: string,
): TResult {
  const document = { ...originalDocument };
  const cloned = cloneBlock(document, originalBlockId);
  const blockId = createBlockId(document);
  document[blockId] = cloned;
  return {
    document,
    blockId,
  };
}
