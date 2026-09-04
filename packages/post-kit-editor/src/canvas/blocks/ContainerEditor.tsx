import React from 'react';

import { Container as BaseContainer } from '@usewaypoint/block-container';

import { useCurrentBlockId } from '../EditorBlock';
import { useDocument, usePatchDocument, useSetSelectedBlockId } from '../editor-context';
import EditorChildrenIds from '../helpers/EditorChildrenIds';

import type { ContainerProps } from './ContainerPropsSchema';

export default function ContainerEditor({ style, props }: ContainerProps): JSX.Element {
  const childrenIds = props?.childrenIds ?? [];
  const document = useDocument();
  const currentBlockId = useCurrentBlockId();
  const patchDocument = usePatchDocument();
  const setSelectedBlockId = useSetSelectedBlockId();

  return (
    <BaseContainer style={style}>
      <EditorChildrenIds
        childrenIds={childrenIds}
        onChange={({ block, blockId, childrenIds: nextChildrenIds }) => {
          const currentBlock = document[currentBlockId];
          if (!currentBlock || currentBlock.type !== 'Container') {
            return;
          }
          patchDocument({
            [blockId]: block,
            [currentBlockId]: {
              type: 'Container',
              data: {
                ...currentBlock.data,
                props: {
                  ...currentBlock.data.props,
                  childrenIds: nextChildrenIds,
                },
              },
            },
          });
          setSelectedBlockId(blockId);
        }}
      />
    </BaseContainer>
  );
}
