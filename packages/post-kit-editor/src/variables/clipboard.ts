/**
 * Copy `text` to the clipboard when available; otherwise resolve `{ ok: false }`
 * so callers can fall back to selecting the text. Never throws.
 */
export async function copyTextToClipboard(text: string): Promise<{ ok: boolean }> {
  try {
    const clipboard = globalThis.navigator?.clipboard;
    if (clipboard && typeof clipboard.writeText === 'function') {
      await clipboard.writeText(text);
      return { ok: true };
    }
  } catch {
    // Clipboard permission / environment failure — degrade gracefully.
  }
  return { ok: false };
}
