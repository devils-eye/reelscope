// Extension plumbing shared by the Instagram and YouTube deps: messages to the
// background worker, and the panel font.

export type Reply<T> = ({ ok: true } & T) | { ok: false; error?: string } | undefined;

export async function send<T>(message: unknown): Promise<Reply<T>> {
  try {
    return (await browser.runtime.sendMessage(message)) as Reply<T>;
  } catch {
    return undefined;
  }
}

let fontLoad: Promise<void> | null = null;

/**
 * @font-face rules inside a shadow root are ignored by Chrome, so register
 * Archivo on the document instead. Loaded from bytes (not a URL) so the page
 * CSP's font-src can't block it. Falls back to system fonts on any failure.
 */
export function loadPanelFont(): Promise<void> {
  fontLoad ??= (async () => {
    try {
      const res = await fetch(browser.runtime.getURL('/fonts/archivo-wdth.woff2'));
      if (!res.ok) return;
      const face = new FontFace('Archivo RS', await res.arrayBuffer(), {
        stretch: '62% 125%',
        weight: '100 900',
      });
      await face.load();
      document.fonts.add(face);
    } catch {
      // System font stack takes over.
    }
  })();
  return fontLoad;
}

export async function serverUp(): Promise<boolean> {
  try {
    const r = (await browser.runtime.sendMessage({ type: 'status' })) as { serverUp?: boolean } | undefined;
    return r?.serverUp === true;
  } catch {
    return false;
  }
}
