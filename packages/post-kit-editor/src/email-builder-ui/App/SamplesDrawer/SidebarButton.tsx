import React from 'react';

import { Button } from '@mui/material';

import { resetDocument } from '../../documents/editor/EditorContext';
import getConfiguration from '../../getConfiguration';

export default function SidebarButton({
  sampleHash,
  children,
}: {
  /** Sample key as used by `getConfiguration`, e.g. `#sample/welcome` or `#`. */
  sampleHash: string;
  children: React.ReactNode;
}) {
  const handleClick = () => {
    resetDocument(getConfiguration(sampleHash));
  };
  return (
    <Button size="small" onClick={handleClick}>
      {children}
    </Button>
  );
}
