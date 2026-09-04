import type { TemplateVariable } from '../types';

/**
 * Catalogue entries for the variable panel: prefer the consumer-supplied
 * `availableVariables` list; otherwise derive from `metadata.variables`.
 */
export function resolveCatalogueVariables(
  availableVariables: TemplateVariable[] | undefined,
  metadataVariables: string[],
): TemplateVariable[] {
  if (availableVariables !== undefined) {
    return availableVariables;
  }
  return metadataVariables.map((name) => ({ name }));
}
