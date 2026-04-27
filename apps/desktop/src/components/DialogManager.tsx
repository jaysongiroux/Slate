import type { DesktopSnapshot, LocalNoteSummary, CalendarInfo } from "@slate/shared";
import type { LucideIcon } from "lucide-react";
import { Toaster } from "sonner";
import { CommandBar } from "./CommandBar";
import { SettingsDialog } from "./SettingsDialog";
import { ExportNotesDialog } from "./ExportNotesDialog";
import { AddIcsDialog } from "./AddIcsDialog";
import { RenameIcsDialog } from "./RenameIcsDialog";
import { CreateEventDialog } from "./CreateEventDialog";
import { EditEventDialog } from "./EditEventDialog";
import { RenameFolderDialog } from "./RenameFolderDialog";
import { DeleteFolderDialog } from "./DeleteFolderDialog";
import { DeleteNoteDialog } from "./DeleteNoteDialog";
import { DeleteBulkDialog } from "./DeleteBulkDialog";
import { useUiStore } from "../stores/ui-store";
import { useSyncStore } from "../stores/sync-store";
import { validatePathSegmentName } from "../lib/note-naming.mjs";

const codeChip =
  "inline rounded bg-white/[0.06] px-1 py-px font-mono text-[0.74rem] text-foreground";

const DATE_NOTE_TIP = (
  <>
    <p className="m-0 mb-1 text-[0.8rem] font-medium text-foreground">Daily note dates</p>
    <p className="m-0 mb-1.5 text-[0.78rem] text-muted">
      Spans more than a single day? Try one of these:
    </p>
    <ul className="m-0 grid list-none gap-1 p-0">
      <li className="flex items-baseline gap-2">
        <span className="text-faint">Range</span>
        <code className={codeChip}>2026-04-24 -&gt; 2026-04-27</code>
      </li>
      <li className="flex items-baseline gap-2">
        <span className="text-faint">List</span>
        <code className={codeChip}>2026-04-24, 2026-04-26</code>
      </li>
    </ul>
  </>
);
import type { CalendarReminderSettings } from "../lib/api";
import type { MarkdownImportResult } from "../lib/api/ipc-core";
import type { SidebarMode } from "./IconRail";

export interface DialogManagerProps {
  snapshot: DesktopSnapshot;
  notes: LocalNoteSummary[];
  folders: string[];
  writableCalendars: CalendarInfo[];
  calendarReminderSettings: CalendarReminderSettings;
  calendarReminderSources: { id: string; name: string; color: string }[];

  // CommandBar
  onCommandBarSelect: (noteId: string) => void;
  enabledTabs: { id: SidebarMode; label: string; icon: LucideIcon }[];
  onTabSelect: (mode: SidebarMode) => void;
  linkwardenEnabled: boolean;
  jiraEnabled: boolean;
  diagramsEnabled: boolean;

  // Settings
  onSettingsOpenChange: (open: boolean) => void;
  onBackendEndpointChange: (value: string) => void;
  onCalendarReminderSettingsChange: (
    update:
      | CalendarReminderSettings
      | ((current: CalendarReminderSettings) => CalendarReminderSettings),
  ) => void;
  onTestConnection: () => Promise<void>;
  onSaveEndpoint: () => Promise<void>;
  onLogin: () => Promise<void>;
  onLoginWithOidc: (providerId: string) => Promise<void>;
  onCancelOidc: () => void;
  onSignOut: () => Promise<void>;
  onFullSync: () => Promise<void>;
  onResetFromServer: () => Promise<void>;
  onImportFolder: () => Promise<MarkdownImportResult | null>;
  onImportFiles: () => Promise<MarkdownImportResult | null>;
  onExportNotes?: () => void;

  // AddIcs
  onAddIcsConfirm: (url: string, name: string) => Promise<void>;

  // RenameIcs
  onRenameIcsConfirm: () => Promise<void>;

  // CreateEvent
  createEventClosedAtRef: React.MutableRefObject<number>;
  onCreateEventConfirm: (data: any) => Promise<void>;

  // EditEvent
  onEditEventConfirm: (data: any) => Promise<void>;

  // PendingCreation (Create note/folder/template dialog)
  onConfirmPendingCreation: () => Promise<void>;

  // Rename folder
  onConfirmRenameFolder: () => Promise<void>;

  // Rename note
  onConfirmRenameNote: () => Promise<void>;

  // Delete folder
  onConfirmDeleteFolder: () => Promise<void>;

  // Delete note
  onConfirmDeleteNote: () => Promise<void>;

  // Delete bulk
  onConfirmBulkDelete: () => Promise<void>;
}

export function DialogManager({
  snapshot,
  notes,
  folders: foldersList,
  writableCalendars,
  calendarReminderSettings,
  calendarReminderSources,
  onCommandBarSelect,
  enabledTabs,
  onTabSelect,
  linkwardenEnabled,
  jiraEnabled,
  diagramsEnabled,
  onSettingsOpenChange,
  onBackendEndpointChange,
  onCalendarReminderSettingsChange,
  onTestConnection,
  onSaveEndpoint,
  onLogin,
  onLoginWithOidc,
  onCancelOidc,
  onSignOut,
  onFullSync,
  onResetFromServer,
  onImportFolder,
  onImportFiles,
  onExportNotes,
  onAddIcsConfirm,
  onRenameIcsConfirm,
  createEventClosedAtRef,
  onCreateEventConfirm,
  onEditEventConfirm,
  onConfirmPendingCreation,
  onConfirmRenameFolder,
  onConfirmRenameNote,
  onConfirmDeleteFolder,
  onConfirmDeleteNote,
  onConfirmBulkDelete,
}: DialogManagerProps) {
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const settingsFocus = useUiStore((s) => s.settingsFocus);
  const setSettingsFocus = useUiStore((s) => s.setSettingsFocus);
  const commandBarOpen = useUiStore((s) => s.commandBarOpen);
  const setCommandBarOpen = useUiStore((s) => s.setCommandBarOpen);
  const pendingCreation = useUiStore((s) => s.pendingCreation);
  const setPendingCreation = useUiStore((s) => s.setPendingCreation);
  const pendingCreationValue = useUiStore((s) => s.pendingCreationValue);
  const setPendingCreationValue = useUiStore((s) => s.setPendingCreationValue);
  const renamingNote = useUiStore((s) => s.renamingNote);
  const setRenamingNote = useUiStore((s) => s.setRenamingNote);
  const renamingNoteValue = useUiStore((s) => s.renamingNoteValue);
  const setRenamingNoteValue = useUiStore((s) => s.setRenamingNoteValue);
  const renamingFolder = useUiStore((s) => s.renamingFolder);
  const setRenamingFolder = useUiStore((s) => s.setRenamingFolder);
  const renamingValue = useUiStore((s) => s.renamingValue);
  const setRenamingValue = useUiStore((s) => s.setRenamingValue);
  const deletingFolder = useUiStore((s) => s.deletingFolder);
  const setDeletingFolder = useUiStore((s) => s.setDeletingFolder);
  const deletingNote = useUiStore((s) => s.deletingNote);
  const setDeletingNote = useUiStore((s) => s.setDeletingNote);
  const deletingBulk = useUiStore((s) => s.deletingBulk);
  const setDeletingBulk = useUiStore((s) => s.setDeletingBulk);
  const addIcsOpen = useUiStore((s) => s.addIcsOpen);
  const setAddIcsOpen = useUiStore((s) => s.setAddIcsOpen);
  const renamingIcs = useUiStore((s) => s.renamingIcs);
  const setRenamingIcs = useUiStore((s) => s.setRenamingIcs);
  const renamingIcsValue = useUiStore((s) => s.renamingIcsValue);
  const setRenamingIcsValue = useUiStore((s) => s.setRenamingIcsValue);
  const createEventOpen = useUiStore((s) => s.createEventOpen);
  const setCreateEventOpen = useUiStore((s) => s.setCreateEventOpen);
  const createEventSlot = useUiStore((s) => s.createEventSlot);
  const editEventOpen = useUiStore((s) => s.editEventOpen);
  const setEditEventOpen = useUiStore((s) => s.setEditEventOpen);
  const editingEvent = useUiStore((s) => s.editingEvent);
  const exportNotesOpen = useUiStore((s) => s.exportNotesOpen);
  const setExportNotesOpen = useUiStore((s) => s.setExportNotesOpen);

  const backendEndpoint = useSyncStore((s) => s.backendEndpoint);
  const setBackendEndpointValue = useSyncStore((s) => s.setBackendEndpointValue);
  const connectionStatus = useSyncStore((s) => s.connectionStatus);
  const setConnectionStatus = useSyncStore((s) => s.setConnectionStatus);
  const connectionError = useSyncStore((s) => s.connectionError);
  const setConnectionError = useSyncStore((s) => s.setConnectionError);
  const authEmail = useSyncStore((s) => s.authEmail);
  const setAuthEmail = useSyncStore((s) => s.setAuthEmail);
  const authPassword = useSyncStore((s) => s.authPassword);
  const setAuthPassword = useSyncStore((s) => s.setAuthPassword);
  const authSubmitting = useSyncStore((s) => s.authSubmitting);
  const authError = useSyncStore((s) => s.authError);
  const backendSyncing = useSyncStore((s) => s.backendSyncing);

  return (
    <>
      <CommandBar
        jiraEnabled={jiraEnabled}
        diagramsEnabled={diagramsEnabled}
        open={commandBarOpen}
        notes={notes}
        enabledTabs={enabledTabs}
        linkwardenEnabled={linkwardenEnabled}
        onSelect={(noteId) => {
          setCommandBarOpen(false);
          onCommandBarSelect(noteId);
        }}
        onTabSelect={(mode) => {
          setCommandBarOpen(false);
          onTabSelect(mode);
        }}
        onClose={() => setCommandBarOpen(false)}
      />

      <SettingsDialog
        open={settingsOpen}
        focus={settingsFocus}
        onOpenChange={(open) => {
          if (open) {
            setBackendEndpointValue(snapshot.backend.endpoint);
            setConnectionStatus("idle");
            setConnectionError("");
            setAuthEmail(snapshot.backend.authenticatedEmail ?? "");
            setAuthPassword("");
          } else {
            setSettingsFocus(undefined);
          }
          onSettingsOpenChange(open);
        }}
        snapshot={snapshot}
        notes={notes}
        folders={foldersList}
        backendEndpoint={backendEndpoint}
        onBackendEndpointChange={(value) => {
          onBackendEndpointChange(value);
        }}
        connectionStatus={connectionStatus}
        connectionError={connectionError}
        authEmail={authEmail}
        authPassword={authPassword}
        onAuthEmailChange={setAuthEmail}
        onAuthPasswordChange={setAuthPassword}
        authSubmitting={authSubmitting}
        authError={authError}
        calendarReminderSettings={calendarReminderSettings}
        calendarReminderSources={calendarReminderSources}
        onCalendarReminderSettingsChange={onCalendarReminderSettingsChange}
        onTestConnection={onTestConnection}
        onSaveEndpoint={onSaveEndpoint}
        onLogin={onLogin}
        onLoginWithOidc={onLoginWithOidc}
        onCancelOidc={onCancelOidc}
        onSignOut={onSignOut}
        onFullSync={onFullSync}
        onResetFromServer={onResetFromServer}
        fullSyncing={backendSyncing}
        onImportFolder={onImportFolder}
        onImportFiles={onImportFiles}
        onExportNotes={onExportNotes}
      />

      <ExportNotesDialog
        open={exportNotesOpen}
        onOpenChange={setExportNotesOpen}
        notes={notes}
        folders={foldersList}
      />

      <AddIcsDialog open={addIcsOpen} onOpenChange={setAddIcsOpen} onConfirm={onAddIcsConfirm} />

      <RenameIcsDialog
        open={renamingIcs !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRenamingIcs(null);
            setRenamingIcsValue("");
          }
        }}
        subscription={renamingIcs}
        value={renamingIcsValue}
        onValueChange={setRenamingIcsValue}
        onConfirm={onRenameIcsConfirm}
      />

      <CreateEventDialog
        open={createEventOpen}
        onOpenChange={(open) => {
          if (!open) createEventClosedAtRef.current = Date.now();
          setCreateEventOpen(open);
        }}
        calendars={writableCalendars}
        initialStart={createEventSlot?.start}
        initialEnd={createEventSlot?.end}
        initialAllDay={createEventSlot?.allDay}
        onConfirm={onCreateEventConfirm}
      />

      <EditEventDialog
        open={editEventOpen}
        onOpenChange={setEditEventOpen}
        event={editingEvent}
        onConfirm={onEditEventConfirm}
      />

      <RenameFolderDialog
        open={pendingCreation !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingCreation(null);
            setPendingCreationValue("");
          }
        }}
        title={
          pendingCreation?.kind === "folder"
            ? "Create folder"
            : pendingCreation?.kind === "template"
              ? "Create template"
              : "Create note"
        }
        description={
          pendingCreation?.kind === "folder"
            ? "Enter a name for this folder."
            : pendingCreation?.kind === "template"
              ? "Enter a name for this template."
              : "Enter a name for this note."
        }
        confirmLabel={
          pendingCreation?.kind === "folder"
            ? "Create folder"
            : pendingCreation?.kind === "template"
              ? "Create template"
              : "Create note"
        }
        value={pendingCreationValue}
        onValueChange={setPendingCreationValue}
        onConfirm={onConfirmPendingCreation}
        tip={pendingCreation?.kind === "note" ? DATE_NOTE_TIP : null}
        selectAllOnOpen
      />

      <RenameFolderDialog
        open={renamingFolder !== null}
        onOpenChange={(open) => {
          if (!open) setRenamingFolder(null);
        }}
        title="Rename"
        description="Enter a new name."
        confirmLabel="Rename"
        value={renamingValue}
        onValueChange={setRenamingValue}
        onConfirm={onConfirmRenameFolder}
      />

      <RenameFolderDialog
        open={renamingNote !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRenamingNote(null);
            setRenamingNoteValue("");
          }
        }}
        title="Rename"
        description="Enter a file name. Spaces are allowed."
        confirmLabel="Rename"
        value={renamingNoteValue}
        onValueChange={setRenamingNoteValue}
        validationMessage={renamingNote ? validatePathSegmentName(renamingNoteValue) : null}
        disableConfirm={Boolean(renamingNote && validatePathSegmentName(renamingNoteValue))}
        tip={DATE_NOTE_TIP}
        onConfirm={onConfirmRenameNote}
      />

      <DeleteFolderDialog
        open={deletingFolder !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingFolder(null);
        }}
        folderPath={deletingFolder}
        onConfirm={onConfirmDeleteFolder}
      />

      <DeleteNoteDialog
        open={deletingNote !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingNote(null);
        }}
        noteDisplayName={deletingNote?.displayName ?? null}
        onConfirm={onConfirmDeleteNote}
      />

      <DeleteBulkDialog
        open={deletingBulk !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingBulk(null);
        }}
        count={deletingBulk?.size ?? 0}
        onConfirm={onConfirmBulkDelete}
      />

      <Toaster
        theme="dark"
        position="bottom-center"
        toastOptions={{
          style: {
            background: "var(--panel-elevated)",
            border: "1px solid var(--line)",
            color: "var(--text)",
          },
        }}
      />
    </>
  );
}
