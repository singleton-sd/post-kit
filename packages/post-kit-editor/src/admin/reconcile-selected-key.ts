/**
 * Keep selection on a key that still exists in the catalog.
 * Returns `catalogKeys[0]` when the current selection was removed.
 */
export function reconcileSelectedKey(selectedKey: string, catalogKeys: string[]): string {
  if (catalogKeys.length === 0) {
    throw new Error('Catalog must contain at least one template key.');
  }
  return catalogKeys.includes(selectedKey) ? selectedKey : catalogKeys[0]!;
}
