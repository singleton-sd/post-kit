import React, { useEffect, useMemo, useState } from 'react';

import {
  Box,
  CssBaseline,
  FormControl,
  InputLabel,
  ListSubheader,
  MenuItem,
  Select,
  Stack,
  ThemeProvider,
  Typography,
} from '@mui/material';

import {
  EDITOR_CLASS_PREFIX,
  EmailTemplateEditor,
  type EmailTemplateEditorProps,
} from '../email-template-editor';
import theme from '../email-builder-ui/theme';
import type { TemplateSourceFiles, TemplateVariable } from '../types';
import { reconcileSelectedKey } from './reconcile-selected-key';

export const ADMIN_CLASS_PREFIX = 'pk-admin-';

export interface EmailTemplateAdminProps extends Omit<
  EmailTemplateEditorProps,
  'template' | 'availableVariables' | 'className'
> {
  /**
   * Catalog of templates the admin may open (from Git / consumer list API).
   * Must contain at least one entry.
   */
  templates: TemplateSourceFiles[];
  /**
   * Optional variable catalogue labels. When omitted, declared metadata
   * variable names are shown as both name and label.
   */
  availableVariables?: TemplateVariable[];
  className?: string;
}

/**
 * Full-page embeddable admin for PostKit email templates.
 *
 * Owns template list selection, MUI theming, the EmailBuilder.js canvas
 * (inspector + samples), and PostKit metadata / preview / save / send chrome.
 * Consumers supply the catalog and persistence callbacks only.
 */
export function EmailTemplateAdmin(props: EmailTemplateAdminProps): JSX.Element {
  const { templates, availableVariables, className, ...editorProps } = props;

  if (templates.length === 0) {
    throw new Error('EmailTemplateAdmin requires at least one template.');
  }

  const catalogKeys = templates.map((t) => t.metadata.key);
  const catalogKeysSignature = catalogKeys.join('\0');
  const templatesByKey = useMemo(() => {
    const map = new Map<string, TemplateSourceFiles>();
    for (const t of templates) {
      map.set(t.metadata.key, t);
    }
    return map;
  }, [templates]);

  const [selectedKey, setSelectedKey] = useState(() => catalogKeys[0]!);

  useEffect(() => {
    const keys = catalogKeysSignature.length > 0 ? catalogKeysSignature.split('\0') : catalogKeys;
    setSelectedKey((current) => reconcileSelectedKey(current, keys));
  }, [catalogKeysSignature, catalogKeys]);

  const effectiveKey = reconcileSelectedKey(selectedKey, catalogKeys);
  const template = templatesByKey.get(effectiveKey);
  if (!template) {
    throw new Error(`EmailTemplateAdmin: missing template for key ${effectiveKey}`);
  }

  const resolvedVariables: TemplateVariable[] =
    availableVariables ??
    template.metadata.variables.map((name) => ({
      name,
      label: name,
    }));

  const rootClass = [`${ADMIN_CLASS_PREFIX}root`, className].filter(Boolean).join(' ');

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        className={rootClass}
        data-testid={`${ADMIN_CLASS_PREFIX}root`}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          minHeight: '100%',
          bgcolor: 'background.default',
        }}
      >
        <Stack
          component="header"
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          alignItems={{ xs: 'stretch', sm: 'center' }}
          justifyContent="space-between"
          sx={{
            px: 2,
            py: 1.5,
            borderBottom: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
          }}
          className={`${ADMIN_CLASS_PREFIX}header`}
        >
          <Typography variant="h6" component="h1" className={`${ADMIN_CLASS_PREFIX}title`}>
            Email templates
          </Typography>
          <FormControl
            size="small"
            sx={{ minWidth: 280 }}
            className={`${ADMIN_CLASS_PREFIX}template-select`}
          >
            <InputLabel id={`${ADMIN_CLASS_PREFIX}template-label`}>Template</InputLabel>
            <Select
              labelId={`${ADMIN_CLASS_PREFIX}template-label`}
              label="Template"
              value={effectiveKey}
              onChange={(event) => setSelectedKey(String(event.target.value))}
              inputProps={{ 'aria-label': 'Select template' }}
              data-testid={`${ADMIN_CLASS_PREFIX}template-select`}
            >
              <ListSubheader disableSticky>Catalog</ListSubheader>
              {templates.map((t) => (
                <MenuItem key={t.metadata.key} value={t.metadata.key}>
                  {t.metadata.name} ({t.metadata.key})
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>

        <Box
          className={`${ADMIN_CLASS_PREFIX}editor`}
          data-testid={`${ADMIN_CLASS_PREFIX}editor`}
          sx={{ flex: 1, minHeight: 0 }}
        >
          <EmailTemplateEditor
            key={effectiveKey}
            template={template}
            availableVariables={resolvedVariables}
            className={`${EDITOR_CLASS_PREFIX}in-admin`}
            {...editorProps}
          />
        </Box>
      </Box>
    </ThemeProvider>
  );
}
