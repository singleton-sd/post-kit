import React from 'react';

import { ColumnsContainer as BaseColumnsContainer } from '@usewaypoint/block-columns-container';

import { useCurrentBlockId } from '../EditorBlock';
import { usePatchDocument, useSetSelectedBlockId } from '../editor-context';
import EditorChildrenIds, { type EditorChildrenChange } from '../helpers/EditorChildrenIds';

import ColumnsContainerPropsSchema, {
  type ColumnsContainerProps,
} from './ColumnsContainerPropsSchema';

const EMPTY_COLUMNS = [{ childrenIds: [] }, { childrenIds: [] }, { childrenIds: [] }];

export default function ColumnsContainerEditor({
  style,
  props,
}: ColumnsContainerProps): JSX.Element {
  const currentBlockId = useCurrentBlockId();
  const patchDocument = usePatchDocument();
  const setSelectedBlockId = useSetSelectedBlockId();

  const { columns, ...restProps } = props ?? {};
  const columnsValue = columns ?? EMPTY_COLUMNS;

  const updateColumn = (
    columnIndex: 0 | 1 | 2,
    { block, blockId, childrenIds }: EditorChildrenChange,
  ) => {
    const nextColumns = [...columnsValue];
    nextColumns[columnIndex] = {
      ...columnsValue[columnIndex],
      childrenIds,
    };
    patchDocument({
      [blockId]: block,
      [currentBlockId]: {
        type: 'ColumnsContainer',
        data: ColumnsContainerPropsSchema.parse({
          style,
          props: {
            ...restProps,
            columns: nextColumns,
          },
        }),
      },
    });
    setSelectedBlockId(blockId);
  };

  return (
    <BaseColumnsContainer
      props={restProps}
      style={style}
      columns={[
        <EditorChildrenIds
          key="col-0"
          childrenIds={columns?.[0]?.childrenIds}
          onChange={(change) => updateColumn(0, change)}
        />,
        <EditorChildrenIds
          key="col-1"
          childrenIds={columns?.[1]?.childrenIds}
          onChange={(change) => updateColumn(1, change)}
        />,
        <EditorChildrenIds
          key="col-2"
          childrenIds={columns?.[2]?.childrenIds}
          onChange={(change) => updateColumn(2, change)}
        />,
      ]}
    />
  );
}
