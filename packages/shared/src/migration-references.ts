/**
 * Reference-rewriting helpers for the desktop's "switch server" migration.
 *
 * When the migration regenerates attachment IDs to dodge cross-user
 * collisions on the destination server, every place that references an
 * attachment by id must be rewritten in lock-step: TipTap content JSON,
 * note markdown, and diagram (Excalidraw) scenes.
 *
 * These helpers are pure — they take old structures + an id map and return
 * new structures. Anything not present in the map is left alone, so it is
 * safe to call even when only a subset of attachments are being remapped.
 */

export type AttachmentIdMap = Readonly<Record<string, string>>;

/** Anchor used by the diagram editor to reference a Slate attachment. */
export const DIAGRAM_ATTACHMENT_PREFIX = "attachment:";

/** Captures the attachment id inside any `/api/attachments/<id>/content` URL. */
const ATTACHMENT_URL_RE = /\/api\/attachments\/([^/?#\s)"'<>]+)\/content/g;

/**
 * Returns the input string with every attachment-content URL rewritten so
 * that the attachment id is taken from `idMap` when present. Both relative
 * (`/api/attachments/...`) and absolute (`https://host/api/attachments/...`)
 * forms are handled, including URLs that carry query strings or fragments.
 */
export function remapAttachmentIdsInString(
  input: string,
  idMap: AttachmentIdMap,
): string {
  if (!input) return input;
  return input.replace(ATTACHMENT_URL_RE, (match, oldId: string) => {
    const newId = idMap[oldId];
    if (!newId || newId === oldId) return match;
    return match.replace(`/api/attachments/${oldId}/content`, `/api/attachments/${newId}/content`);
  });
}

/**
 * Recursively walks a JSON-shaped value rewriting any string that looks like
 * an attachment URL (via `remapAttachmentIdsInString`) or a diagram-scene
 * `attachment:<id>` token. Non-attachment strings are returned unchanged.
 *
 * The function is structure-preserving: arrays remain arrays, objects keep
 * their own keys, primitive values pass through. The result is a new tree —
 * the input is never mutated.
 */
export function remapAttachmentIdsInJsonTree(
  value: unknown,
  idMap: AttachmentIdMap,
): unknown {
  if (typeof value === "string") {
    if (value.startsWith(DIAGRAM_ATTACHMENT_PREFIX)) {
      const oldId = value.slice(DIAGRAM_ATTACHMENT_PREFIX.length);
      const newId = idMap[oldId];
      return newId && newId !== oldId
        ? `${DIAGRAM_ATTACHMENT_PREFIX}${newId}`
        : value;
    }
    return remapAttachmentIdsInString(value, idMap);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => remapAttachmentIdsInJsonTree(entry, idMap));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = remapAttachmentIdsInJsonTree(child, idMap);
    }
    return out;
  }
  return value;
}

/** Convenience for note `content` (TipTap JSON). */
export function remapAttachmentIdsInNoteContent(
  content: unknown,
  idMap: AttachmentIdMap,
): unknown {
  return remapAttachmentIdsInJsonTree(content, idMap);
}

/** Convenience for note `markdown`. */
export function remapAttachmentIdsInMarkdown(
  markdown: string,
  idMap: AttachmentIdMap,
): string {
  return remapAttachmentIdsInString(markdown, idMap);
}

/** Convenience for diagram `scene`. */
export function remapAttachmentIdsInDiagramScene(
  scene: unknown,
  idMap: AttachmentIdMap,
): unknown {
  return remapAttachmentIdsInJsonTree(scene, idMap);
}

/**
 * Walks a JSON-shaped value collecting every attachment id referenced via
 * either an `/api/attachments/<id>/content` URL or a diagram-scene
 * `attachment:<id>` token. Used by tests as a regression net: if a future
 * feature introduces a new way to reference attachments, the corresponding
 * test should fail because this collector won't see the new shape.
 */
export function collectAttachmentIdReferences(value: unknown): Set<string> {
  const seen = new Set<string>();
  function visit(v: unknown): void {
    if (typeof v === "string") {
      if (v.startsWith(DIAGRAM_ATTACHMENT_PREFIX)) {
        seen.add(v.slice(DIAGRAM_ATTACHMENT_PREFIX.length));
        return;
      }
      let match: RegExpExecArray | null;
      const re = new RegExp(ATTACHMENT_URL_RE.source, "g");
      while ((match = re.exec(v)) !== null) {
        seen.add(match[1]!);
      }
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(visit);
      return;
    }
    if (v && typeof v === "object") {
      for (const child of Object.values(v as Record<string, unknown>)) {
        visit(child);
      }
    }
  }
  visit(value);
  return seen;
}
