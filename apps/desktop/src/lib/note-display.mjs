function basename(path) {
  return typeof path === "string" ? (path.split(/[\\/]/).pop() ?? "") : "";
}

function isGenericTitle(title) {
  const normalized = typeof title === "string" ? title.trim().toLowerCase() : "";
  return (
    normalized === "untitled" ||
    normalized === "untitled note" ||
    normalized === "untitled template"
  );
}

export function displayNoteTitle({ title, path }) {
  const fileLabel = basename(path);
  if (isGenericTitle(title) && fileLabel) return fileLabel;
  return title || fileLabel || "Untitled";
}
