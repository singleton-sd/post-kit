export * from './documents';
export * from './template-sources';
export * from './mocks';

/** Re-export nested-blocks fixture for any leftover consumers / visual parity. */
import { loadTemplateSource, type TemplateSourceFiles } from '../../src';
import templateJson from '../../src/__fixtures__/nested-blocks/template.json';
import metadata from '../../src/__fixtures__/nested-blocks/metadata.json';
import previewData from '../../src/__fixtures__/nested-blocks/preview.json';

export const nestedBlocksTemplate: TemplateSourceFiles = loadTemplateSource({
  templateJson,
  metadata,
  previewData,
});
