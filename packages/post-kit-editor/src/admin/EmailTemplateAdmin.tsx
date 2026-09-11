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
import { loadTemplateSource } from '../serialization';
import type { TemplateSourceFiles, TemplateVariable } from '../types';
import { reconcileSelectedKey } from './reconcile-selected-key';

export const ADMIN_CLASS_PREFIX = 'pk-admin-';

/** Synthetic placeholder used only while catalog is empty under loading/loadError. */
const EMPTY_CATALOG_PLACEHOLDER: TemplateSourceFiles = loadTemplateSource({
  templateJson: {
    root: {
      type: 'EmailLayout',
      data: {
        backdropColor: '#F5F5F5',
        canvasColor: '#FFFFFF',
        textColor: '#262626',
        fontFamily: 'MODERN_SANS',
        childrenIds: [],
      },
    },
  },
  metadata: {
    key: 'admin.placeholder',
    name: 'Loading',
    subject: 'Loading',
    variables: [],
    schemaVersion: '1',
  },
  previewData: {},
});

export interface EmailTemplateAdminProps extends Omit<
  EmailTemplateEditorProps,
  'template' | 'availableVariables' | 'className'
> {
  /**
   * Catalog of templates the admin may open (from Git / consumer list API).
   * Must contain at least one entry unless `loading` or `loadError` is set.
   */
  templates: TemplateSourceFiles[];
  /**
   * Optional variable catalogue labels. When omitted, declared metadata
   * variable names are shown as both name and label.
   */
  availableVariables?: TemplateVariable[];
  className?: string;
}

function assertUniqueCatalogKeys(templates: TemplateSourceFiles[]): void {
  const seen = new Set<string>();
  for (const t of templates) {
    const key = t.metadata.key;
    if (seen.has(key)) {
      throw new Error(`EmailTemplateAdmin: duplicate metadata.key "${key}".`);
    }
    seen.add(key);
  }
}

/**
 * Full-page embeddable admin for PostKit email templates.
 *
 * Owns template list selection, MUI theming, the EmailBuilder.js canvas
 * (inspector + samples), and PostKit metadata / preview / save / send chrome.
 * Consumers supply the catalog and persistence callbacks only.
 */
export function EmailTemplateAdmin(props: EmailTemplateAdminProps): JSX.Element {
  const { templates, loading, loadError } = props;

  if (!loading) {
    assertUniqueCatalogKeys(templates);
  }

  if (templates.length === 0) {
    if (loading || loadError) {
      return <EmailTemplateAdminShell {...props} />;
    }
    throw new Error('EmailTemplateAdmin requires at least one template.');
  }

  return <EmailTemplateAdminCatalog {...props} />;
}

/** Loading / error shell when the catalog has not arrived yet. */
function EmailTemplateAdminShell({
  templates: _templates,
  availableVariables,
  className,
  loading,
  loadError,
  ...editorProps
}: EmailTemplateAdminProps): JSX.Element {
  void _templates;
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
        </Stack>

        <Box
          className={`${ADMIN_CLASS_PREFIX}editor`}
          data-testid={`${ADMIN_CLASS_PREFIX}editor`}
          sx={{ flex: 1, minHeight: 0 }}
        >
          <EmailTemplateEditor
            template={EMPTY_CATALOG_PLACEHOLDER}
            availableVariables={availableVariables}
            className={`${EDITOR_CLASS_PREFIX}in-admin`}
            loading={loading}
            loadError={loadError}
            {...editorProps}
          />
        </Box>
      </Box>
    </ThemeProvider>
  );
}

function EmailTemplateAdminCatalog(props: EmailTemplateAdminProps): JSX.Element {
  const { templates, availableVariables, className, ...editorProps } = props;

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
