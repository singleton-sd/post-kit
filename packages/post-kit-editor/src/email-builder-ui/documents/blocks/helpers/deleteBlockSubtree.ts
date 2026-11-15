import { TEditorBlock, TEditorConfiguration } from '../../editor/core';
import type { ColumnsContainerProps } from '../ColumnsContainer/ColumnsContainerPropsSchema';

/** Collect `blockId` and all descendant block ids (Container / ColumnsContainer). */
export function collectSubtreeBlockIds(document: TEditorConfiguration, blockId: string): string[] {
  const ids: string[] = [];
  const visit = (id: string) => {
    ids.push(id);
    const block = document[id] as TEditorBlock | undefined;
    if (!block) {
      return;
    }
    switch (block.type) {
      case 'Container':
        for (const childId of block.data.props?.childrenIds ?? []) {
          visit(childId);
        }
        break;
      case 'ColumnsContainer':
        for (const col of block.data.props?.columns ?? []) {
          for (const childId of col?.childrenIds ?? []) {
            visit(childId);
          }
        }
        break;
      default:
        break;
    }
  };
  visit(blockId);
  return ids;
}

/**
 * Remove `blockId` (and its subtree) from parent references and delete those
 * records from the document. Returns a shallow-copied document map.
 */
export function deleteBlockSubtree(
  document: TEditorConfiguration,
  blockId: string,
): TEditorConfiguration {
  const toDelete = new Set(collectSubtreeBlockIds(document, blockId));
  const filterChildrenIds = (childrenIds: string[] | null | undefined) => {
    if (!childrenIds) {
      return childrenIds;
    }
    return childrenIds.filter((f) => !toDelete.has(f));
  };

  const nDocument: TEditorConfiguration = { ...document };
  for (const [id, b] of Object.entries(nDocument)) {
    const block = b as TEditorBlock;
    if (toDelete.has(id)) {
      continue;
    }

    switch (block.type) {
      case 'EmailLayout':
        nDocument[id] = {
          ...block,
          data: {
            ...block.data,
            childrenIds: filterChildrenIds(block.data.childrenIds),
          },
        };
        break;
      case 'Container':
        nDocument[id] = {
          ...block,
          data: {
            ...block.data,
            props: {
              ...block.data.props,
              childrenIds: filterChildrenIds(block.data.props?.childrenIds),
            },
          },
        };
        break;
      case 'ColumnsContainer':
        nDocument[id] = {
          type: 'ColumnsContainer',
          data: {
            style: block.data.style,
            props: {
              ...block.data.props,
              columns: block.data.props?.columns?.map((c) => ({
                ...(c ?? { childrenIds: [] }),
                childrenIds: filterChildrenIds(c?.childrenIds) ?? [],
              })),
            },
          } as ColumnsContainerProps,
        };
        break;
      default:
        nDocument[id] = block;
    }
  }

  for (const id of toDelete) {
    delete nDocument[id];
  }
  return nDocument;
}
