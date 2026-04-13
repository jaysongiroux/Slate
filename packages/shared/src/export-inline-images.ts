const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

function trimSrc(src: string): string {
  return src.trim();
}

/**
 * True when the URL/path should be treated as a Slate attachment endpoint
 * (relative API path, slate-attachment scheme, or http(s) URL whose pathname
 * is under `/api/attachments/`).
 */
export function looksLikeAttachmentSrc(src: string): boolean {
  const t = trimSrc(src);
  if (t.startsWith("/api/attachments/")) return true;
  if (/^slate-attachment:/i.test(t)) return true;
  if (/^https?:\/\//i.test(t)) {
    try {
      const { pathname } = new URL(t);
      return pathname === "/api/attachments" || pathname.startsWith("/api/attachments/");
    } catch {
      return false;
    }
  }
  return false;
}

function isPlainHttpUrl(src: string): boolean {
  return /^https?:\/\//i.test(trimSrc(src));
}

/** External http(s) image URL that is clearly not the attachments API — leave as-is. */
function isExternalNonAttachmentHttp(src: string): boolean {
  return isPlainHttpUrl(src) && !looksLikeAttachmentSrc(src);
}

function uint8ToBase64(bytes: Uint8Array): string {
  const g = globalThis as typeof globalThis & {
    Buffer?: { from(data: Uint8Array): { toString(encoding: "base64"): string } };
  };
  if (g.Buffer) {
    return g.Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

/**
 * Finds markdown images, resolves Slate attachment `src` values to bytes, and
 * replaces them with `data:` URLs. Plain external `https?://` URLs that are
 * not attachment paths are left unchanged. Errors from `fetchBinary` propagate.
 */
export async function inlineAttachmentImagesInMarkdown(
  markdown: string,
  resolveUrl: (src: string) => Promise<string>,
  fetchBinary: (absoluteUrl: string) => Promise<{ bytes: Uint8Array; mime: string }>,
): Promise<string> {
  const matches = [...markdown.matchAll(MARKDOWN_IMAGE_RE)];
  if (matches.length === 0) return markdown;

  const dataUrlBySrc = new Map<string, Promise<string | undefined>>();

  function getDataUrlForSrc(trimmedSrc: string): Promise<string | undefined> {
    let pending = dataUrlBySrc.get(trimmedSrc);
    if (!pending) {
      pending = (async () => {
        const absolute = await resolveUrl(trimmedSrc);
        if (!looksLikeAttachmentSrc(absolute)) {
          return undefined;
        }
        const { bytes, mime } = await fetchBinary(absolute);
        return `data:${mime};base64,${uint8ToBase64(bytes)}`;
      })();
      dataUrlBySrc.set(trimmedSrc, pending);
    }
    return pending;
  }

  const pieces = await Promise.all(
    matches.map(async (m) => {
      const full = m[0]!;
      const alt = m[1]!;
      const rawSrc = m[2]!;
      const trimmedSrc = trimSrc(rawSrc);
      const start = m.index!;

      if (isExternalNonAttachmentHttp(trimmedSrc)) {
        return null;
      }
      if (!looksLikeAttachmentSrc(trimmedSrc)) {
        return null;
      }

      const dataUrl = await getDataUrlForSrc(trimmedSrc);
      if (!dataUrl) {
        return null;
      }

      return {
        start,
        end: start + full.length,
        text: `![${alt}](${dataUrl})`,
      };
    }),
  );

  const replacements = pieces.filter((p): p is NonNullable<typeof p> => p !== null);
  replacements.sort((a, b) => b.start - a.start);

  let out = markdown;
  for (const { start, end, text } of replacements) {
    out = `${out.slice(0, start)}${text}${out.slice(end)}`;
  }
  return out;
}
