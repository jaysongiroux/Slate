export function validatePathSegmentName(raw) {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return "Name is required.";
  if (/[\\/]/.test(trimmed)) return "Use a single file name without slashes.";
  return null;
}

export function displayNameFromPath(relativePath) {
  const lastSegment = typeof relativePath === "string" ? (relativePath.split("/").pop() ?? "") : "";
  return lastSegment.replace(/-/g, " ");
}
