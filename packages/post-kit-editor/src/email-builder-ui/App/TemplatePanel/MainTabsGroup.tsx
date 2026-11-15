import React from 'react';

import {
  CodeOutlined,
  DataObjectOutlined,
  EditOutlined,
  PreviewOutlined,
} from '@mui/icons-material';
import { Tab, Tabs, Tooltip } from '@mui/material';

import { setSelectedMainTab, useSelectedMainTab } from '../../documents/editor/EditorContext';

export default function MainTabsGroup() {
  const selectedMainTab = useSelectedMainTab();
  const handleChange = (_: unknown, v: unknown) => {
    switch (v) {
      case 'json':
      case 'preview':
      case 'editor':
      case 'html':
        setSelectedMainTab(v);
        return;
      default:
        setSelectedMainTab('editor');
    }
  };

  return (
    <Tabs value={selectedMainTab} onChange={handleChange}>
      <Tab
        value="editor"
        aria-label="Edit"
        label={
          <Tooltip title="Edit">
            <EditOutlined fontSize="small" />
          </Tooltip>
        }
      />
      <Tab
        value="preview"
        aria-label="Preview"
        label={
          <Tooltip title="Preview">
            <PreviewOutlined fontSize="small" />
          </Tooltip>
        }
      />
      <Tab
        value="html"
        aria-label="HTML output"
        label={
          <Tooltip title="HTML output">
            <CodeOutlined fontSize="small" />
          </Tooltip>
        }
      />
      <Tab
        value="json"
        aria-label="JSON output"
        label={
          <Tooltip title="JSON output">
            <DataObjectOutlined fontSize="small" />
          </Tooltip>
        }
      />
    </Tabs>
  );
}
