import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CalendarPlus, FilePlus2, FileStack, FolderPlus, Plus } from "lucide-react";
import type { LocalNoteSummary } from "@slate/shared";
import { TreeBranch, PinnedSection, TreeSidebarDndHoverLock } from "./NoteTree";
import type { NoteTreeNode } from "../lib/noteTree";
import { parseDndActiveKind, parseDndDropTargetId } from "../lib/noteTreeDnd";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { ScrollArea } from "./ui/scroll-area";
import { cn } from "../lib/utils";

export interface NotesSidebarProps {
  tree: NoteTreeNode[];
  pinnedNotes: LocalNoteSummary[];
  selectedNoteId: string;
  selectedItems: Set<string>;
  collapsedPaths: Set<string>;
  onCreateNote: (parentPath?: string) => Promise<void>;
  onCreateDailyNote: () => void;
  onCreateFolder: (parentPath?: string) => Promise<void>;
  onCreateTemplate: () => Promise<void>;
  onSelectNote: (noteId: string) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
  onRenameNote: (noteId: string, currentPath: string) => void;
  onRenameFolder: (folderPath: string, currentName: string) => void;
  onDeleteFolder: (folderPath: string) => void;
  onMoveNote: (noteId: string, targetFolderPath: string) => Promise<void>;
  onMoveFolder: (folderPath: string, targetParentPath: string) => Promise<void>;
  onTogglePath: (path: string) => void;
  onTogglePin: (noteId: string, pinned: boolean) => void;
  onTreeItemClick: (
    e: React.MouseEvent,
    itemKey: string,
    parentPath: string,
    siblingKeys: string[],
  ) => boolean;
  onBulkDelete: () => void;
  onClearSelection: () => void;
}

export function NotesSidebar({
  tree,
  pinnedNotes,
  selectedNoteId,
  selectedItems,
  collapsedPaths,
  onCreateNote,
  onCreateDailyNote,
  onCreateFolder,
  onCreateTemplate,
  onSelectNote,
  onDeleteNote,
  onRenameNote,
  onRenameFolder,
  onDeleteFolder,
  onMoveNote,
  onMoveFolder,
  onTogglePath,
  onTogglePin,
  onTreeItemClick,
  onBulkDelete,
  onClearSelection,
}: NotesSidebarProps) {
  const treeDndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function handleTreeDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const targetParent = parseDndDropTargetId(String(over.id));
    if (targetParent === null) return;
    const parsed = parseDndActiveKind(String(active.id));
    if (!parsed) return;
    if (parsed.kind === "note") {
      void onMoveNote(parsed.noteId, targetParent);
      return;
    }
    const fp = parsed.path.replace(/\\/g, "/");
    const t = targetParent.replace(/\\/g, "/");
    if (t === fp || t.startsWith(`${fp}/`)) return;
    void onMoveFolder(parsed.path, targetParent);
  }

  return (
    <>
      <div className="mb-1.5 flex w-full max-w-full min-w-0 shrink-0 items-center justify-between text-[0.88rem] text-muted tracking-wide">
        <span
          className="text-[0.9rem] font-normal tracking-wide text-foreground"
          style={{ userSelect: "none" }}
        >
          Notes
        </span>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex size-[22px] cursor-pointer items-center justify-center rounded-full bg-transparent text-faint hover:bg-white/[0.08] hover:text-foreground"
                    aria-label="Create new note or folder"
                  >
                    <Plus size={14} />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">New note, daily note, or folder</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void onCreateNote()}>
                <FilePlus2 size={14} /> New note
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void onCreateDailyNote()}>
                <CalendarPlus size={14} /> Daily note
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void onCreateFolder()}>
                <FolderPlus size={14} /> New folder
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void onCreateTemplate()}>
                <FileStack size={14} /> New template
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <ScrollArea
        className={cn(
          "note-scroll-area relative flex min-h-0 min-w-0 flex-1 flex-col",
          "[&_.ui-scroll-area__viewport]:overflow-x-hidden!",
          "[&_.ui-scroll-area__scrollbar--horizontal]:hidden",
          "[&_.ui-scroll-area__scrollbar--vertical]:hidden",
        )}
      >
        <div className="notes-tree grid min-h-full min-w-0 max-w-full gap-2 box-border pr-2">
          <PinnedSection
            notes={pinnedNotes}
            selectedNoteId={selectedNoteId}
            onSelectNote={onSelectNote}
            onDeleteNote={onDeleteNote}
            onTogglePin={onTogglePin}
          />
          {tree.length === 0 ? (
            <div className="flex w-full justify-center px-4 py-3 text-[0.82rem] text-faint">
              No notes yet
            </div>
          ) : (
            <DndContext
              sensors={treeDndSensors}
              collisionDetection={pointerWithin}
              onDragEnd={handleTreeDragEnd}
            >
              <TreeSidebarDndHoverLock />
              {tree.map((node) => (
                <TreeBranch
                  key={node.path || "root"}
                  node={node}
                  depth={0}
                  parentPath=""
                  parentSiblingKeys={[]}
                  selectedNoteId={selectedNoteId}
                  selectedItems={selectedItems}
                  onTreeItemClick={onTreeItemClick}
                  onBulkDelete={onBulkDelete}
                  onClearSelection={onClearSelection}
                  onSelectNote={onSelectNote}
                  onDeleteNote={onDeleteNote}
                  onRenameNote={onRenameNote}
                  onCreateNote={onCreateNote}
                  onCreateFolder={onCreateFolder}
                  onRenameFolder={onRenameFolder}
                  onDeleteFolder={onDeleteFolder}
                  onMoveNote={onMoveNote}
                  onMoveFolder={onMoveFolder}
                  collapsedPaths={collapsedPaths}
                  onTogglePath={onTogglePath}
                  onTogglePin={onTogglePin}
                  onCreateTemplate={onCreateTemplate}
                />
              ))}
            </DndContext>
          )}
        </div>
      </ScrollArea>
    </>
  );
}
