import { serverEnv } from '@scimem/core';
import { publicEnv } from '@scimem/core';

const BUCKET = 'snapshots';

/**
 * Upload a snapshot (raw HTML) or screenshot (PNG) to the `snapshots` bucket
 * via the service role (server-side only; the bucket is private). Returns the
 * object path (e.g. `<projectId>/<pageId>/<hash>.html`) or null on failure so
 * callers degrade gracefully — capture must never fail because storage hiccuped.
 */
export async function uploadSnapshot(
  projectId: string,
  pageId: string,
  fileName: string,
  body: string | Buffer,
  contentType: string,
): Promise<string | null> {
  const srv = serverEnv();
  const pub = publicEnv();
  const objectPath = `${projectId}/${pageId}/${fileName}`;

  const form = new FormData();
  form.append(
    'file',
    new Blob([body as BlobPart], { type: contentType }),
    fileName,
  );

  try {
    const res = await fetch(
      `${pub.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${BUCKET}/${objectPath}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${srv.SUPABASE_SERVICE_ROLE_KEY}` },
        body: form,
      },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`uploadSnapshot: ${res.status} ${text.slice(0, 200)}`);
      return null;
    }
    return objectPath;
  } catch (e) {
    console.warn(`uploadSnapshot: network error: ${(e as Error).message}`);
    return null;
  }
}

/** Decode a `data:image/png;base64,...` URL into a Buffer, or null if malformed. */
export function decodeImageDataUrl(dataUrl: string): Buffer | null {
  const m = /^data:image\/[a-zA-Z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!m) return null;
  try {
    return Buffer.from(m[1]!, 'base64');
  } catch {
    return null;
  }
}