import type { LocalNoteSummary } from "@slate/shared/index";

export type NoteTreeNode = {
  name: string;
  path: string;
  folders: NoteTreeNode[];
  notes: LocalNoteSummary[];
};

type MutableTreeNode = {
  name: string;
  path: string;
  folders: MutableTreeNode[];
  notes: LocalNoteSummary[];
  folderMap: Map<string, MutableTreeNode>;
};

export function basename(notePath: string) {
  const name = notePath.split("/").pop() ?? notePath;
  return name.endsWith(".md") ? name.slice(0, -3) : name;
}

export function buildNoteTree(notes: LocalNoteSummary[], folderPaths: string[] = []): NoteTreeNode[] {
  const root: MutableTreeNode = {
    name: "",
    path: "",
    folders: [],
    notes: [],
    folderMap: new Map(),
  };

  function ensureFolder(folderPath: string): MutableTreeNode {
    const segments = folderPath.split("/").filter(Boolean);
    let current = root;
    let currentPath = "";

    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      let node = current.folderMap.get(segment);
      if (!node) {
        node = { name: segment, path: currentPath, folders: [], notes: [], folderMap: new Map() };
        current.folderMap.set(segment, node);
        current.folders.push(node);
      }
      current = node;
    }

    return current;
  }

  for (const folderPath of folderPaths) {
    ensureFolder(folderPath);
  }

  for (const note of notes) {
    const segments = note.path.split("/").filter(Boolean);
    const folders = segments.slice(0, -1);
    const parent = folders.length > 0 ? ensureFolder(folders.join("/")) : root;
    parent.notes.push(note);
  }

  function finalize(node: MutableTreeNode): NoteTreeNode {
    return {
      name: node.name,
      path: node.path,
      folders: node.folders
        .map(finalize)
        .sort((a, b) => a.name.localeCompare(b.name)),
      notes: node.notes
        .slice()
        .sort((a, b) => basename(a.path).localeCompare(basename(b.path))),
    };
  }

  const finalizedRoot = finalize(root);
  return finalizedRoot.folders.length || finalizedRoot.notes.length ? [finalizedRoot] : [];
}
