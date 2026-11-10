/**
 * Choose a document on this phone and turn it into base64 for the verification upload
 * (services/api/app/services/verification.py: a JPG, a PNG or a PDF, up to 3 MB).
 *
 * The picker and the image tools are native modules, which a build made before they were added does
 * not have; they are loaded defensively so the same JavaScript runs on both. Without them the screen
 * says the app needs updating instead of failing.
 */
export const MAX_DOCUMENT_BYTES = 3 * 1024 * 1024;

type Picked = { base64: string; name: string; bytes: number };
export type PickResult = { ok: true; file: Picked } | { ok: false; reason: 'unavailable' | 'cancelled' | 'too_big' | 'unreadable' };

type Picker = {
  getDocumentAsync: (o: { type: string[]; copyToCacheDirectory: boolean }) => Promise<{
    canceled: boolean;
    assets?: { uri: string; name: string; mimeType?: string; size?: number }[];
  }>;
};
type Fs = { readAsStringAsync: (uri: string, o: { encoding: string }) => Promise<string> };
type Manip = {
  manipulateAsync: (
    uri: string,
    actions: { resize: { width: number } }[],
    o: { compress: number; format: string; base64: boolean },
  ) => Promise<{ base64?: string }>;
  SaveFormat: { JPEG: string };
};

// Metro needs each module name written out, so each loader names its own.
/* eslint-disable @typescript-eslint/no-require-imports */
function loadPicker(): Picker | null {
  try {
    return require('expo-document-picker') as Picker;
  } catch {
    return null;
  }
}
function loadFs(): Fs | null {
  try {
    return require('expo-file-system/legacy') as Fs;
  } catch {
    return null;
  }
}
function loadManip(): Manip | null {
  try {
    return require('expo-image-manipulator') as Manip;
  } catch {
    return null;
  }
}
/* eslint-enable @typescript-eslint/no-require-imports */

/** The size in bytes of a base64 string once decoded. */
export function decodedBytes(base64: string): number {
  const pad = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - pad;
}

export async function pickDocument(): Promise<PickResult> {
  const picker = loadPicker();
  const fs = loadFs();
  if (!picker || !fs) return { ok: false, reason: 'unavailable' };
  try {
    const res = await picker.getDocumentAsync({ type: ['image/*', 'application/pdf'], copyToCacheDirectory: true });
    const asset = res.canceled ? null : res.assets?.[0];
    if (!asset) return { ok: false, reason: 'cancelled' };
    let base64: string | undefined;
    if ((asset.mimeType ?? '').startsWith('image/')) {
      // A phone photo is often several MB: shrink it to a readable 1600 px and re-save as JPEG.
      const manip = loadManip();
      if (!manip) return { ok: false, reason: 'unavailable' };
      const out = await manip.manipulateAsync(asset.uri, [{ resize: { width: 1600 } }], { compress: 0.7, format: manip.SaveFormat.JPEG, base64: true });
      base64 = out.base64;
    } else {
      base64 = await fs.readAsStringAsync(asset.uri, { encoding: 'base64' });
    }
    if (!base64) return { ok: false, reason: 'unreadable' };
    const bytes = decodedBytes(base64);
    if (bytes > MAX_DOCUMENT_BYTES) return { ok: false, reason: 'too_big' };
    return { ok: true, file: { base64, name: asset.name, bytes } };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}
