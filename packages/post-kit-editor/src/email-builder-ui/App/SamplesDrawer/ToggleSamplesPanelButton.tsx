import React from 'react';

import { FirstPageOutlined, MenuOutlined } from '@mui/icons-material';
import { IconButton } from '@mui/material';

import {
  toggleSamplesDrawerOpen,
  useSamplesDrawerOpen,
} from '../../documents/editor/EditorContext';

export default function ToggleSamplesPanelButton() {
  const samplesDrawerOpen = useSamplesDrawerOpen();
  return (
    <IconButton
      onClick={toggleSamplesDrawerOpen}
      aria-label={samplesDrawerOpen ? 'Close samples' : 'Open samples'}
    >
      {samplesDrawerOpen ? (
        <FirstPageOutlined fontSize="small" />
      ) : (
        <MenuOutlined fontSize="small" />
      )}
    </IconButton>
  );
}
