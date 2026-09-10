/**
 * Synthetic Storybook fixtures only — mirrors `src/__fixtures__/nested-blocks/`
 * and `examples/minimal/sample/`. No secrets or customer-identifying values.
 */
import { loadTemplateSource, type TemplateSourceFiles, type TemplateVariable } from '../src';

import templateJson from '../src/__fixtures__/nested-blocks/template.json';
import metadata from '../src/__fixtures__/nested-blocks/metadata.json';
import previewData from '../src/__fixtures__/nested-blocks/preview.json';

export const nestedBlocksTemplate: TemplateSourceFiles = loadTemplateSource({
  templateJson,
  metadata,
  previewData,
});

export const sampleAvailableVariables: TemplateVariable[] = [
  { name: 'name', label: 'Recipient name', description: 'Synthetic display name' },
];
