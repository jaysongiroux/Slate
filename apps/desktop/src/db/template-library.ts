/**
 * RxDB selector for “template library” notes: `isTemplate` or path under `templates/`
 * (or `templates\` on Windows). Keeps listTemplates / live queries off full-table scans.
 *
 * Longer-term: normalize `path` to `/` on write, then you can narrow further with a
 * string-prefix range or a small computed field + compound index if this set grows huge.
 */
export const TEMPLATE_LIBRARY_NOTE_SELECTOR = {
  isDeleted: false,
  $or: [{ isTemplate: true }, { path: { $regex: "^templates(/|\\\\)" } }],
};
