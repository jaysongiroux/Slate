import { useCallback, useMemo, useState } from "react";
import {
  NOTE_GRAPH_ENABLED_SETTING_KEY,
  CHECKLISTS_ENABLED_SETTING_KEY,
  HOME_ASSISTANT_ENABLED_SETTING_KEY,
  LINKWARDEN_ENABLED_SETTING_KEY,
  JIRA_ENABLED_SETTING_KEY,
  FORGE_ENABLED_SETTING_KEY,
  DIAGRAMS_ENABLED_SETTING_KEY,
} from "@slate/shared";
import { toast } from "sonner";
import { useDatabase } from "../../db/DatabaseProvider";
import { useSetting } from "../../hooks/use-settings";
import { deleteNoteGraphEdges, enqueueNoteGraphRebuild, getEmbedStatus } from "../../lib/api";
import { nativeFieldBorderedClassName } from "../ui/input";

export function ExtensionsSection({
  backendReachable,
  isAuthenticated,
}: {
  backendReachable: boolean;
  isAuthenticated: boolean;
}) {
  const db = useDatabase();
  const [noteGraphEnabled, setNoteGraphEnabled] = useSetting<boolean>(
    db,
    NOTE_GRAPH_ENABLED_SETTING_KEY,
    false,
  );
  const [checklistsEnabled, setChecklistsEnabled] = useSetting<boolean>(
    db,
    CHECKLISTS_ENABLED_SETTING_KEY,
    false,
  );
  const [linkwardenEnabled, setLinkwardenEnabled] = useSetting<boolean>(
    db,
    LINKWARDEN_ENABLED_SETTING_KEY,
    false,
  );
  const [homeAssistantEnabled, setHomeAssistantEnabled] = useSetting<boolean>(
    db,
    HOME_ASSISTANT_ENABLED_SETTING_KEY,
    false,
  );
  const [jiraEnabled, setJiraEnabled] = useSetting<boolean>(db, JIRA_ENABLED_SETTING_KEY, false);
  const [forgeEnabled, setForgeEnabled] = useSetting<boolean>(
    db,
    FORGE_ENABLED_SETTING_KEY,
    false,
  );
  const [diagramsEnabled, setDiagramsEnabled] = useSetting<boolean>(
    db,
    DIAGRAMS_ENABLED_SETTING_KEY,
    false,
  );
  const [busy, setBusy] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [query, setQuery] = useState("");

  const canUseCloudExtensions = backendReachable && isAuthenticated;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (title: string, description: string) =>
      q === "" || title.toLowerCase().includes(q) || description.toLowerCase().includes(q);
  }, [query]);

  const extensions: Array<{ title: string; description: string }> = [
    {
      title: "Note similarity graph",
      description:
        "Explore related notes from embeddings (no manual links). Requires AI embeddings to be configured. Turning this off removes stored similarity edges on the server.",
    },
    {
      title: "Checklists",
      description:
        "Create running task lists that aggregate checkboxes from notes matching regex patterns. Works offline — no server connection required.",
    },
    {
      title: "Home Assistant",
      description:
        "Browse dashboards and safely control Home Assistant entities through your Slate server. Requires a backend connection.",
    },
    {
      title: "LinkWarden",
      description:
        "Browse and save bookmarks from your LinkWarden instances. Requires a backend connection.",
    },
    {
      title: "Jira",
      description: "View and manage Jira issues. Requires a backend connection.",
    },
    {
      title: "GitHub / GitLab",
      description:
        "Keep an eye on PRs, MRs, review requests, notifications, and repos. All detail views open in your browser.",
    },
    {
      title: "Diagrams",
      description:
        "Create Excalidraw diagrams alongside your notes. Requires a backend connection.",
    },
  ];
  const anyMatch = extensions.some((e) => matches(e.title, e.description));

  const onToggleNoteGraph = useCallback(
    async (next: boolean) => {
      if (!canUseCloudExtensions) return;
      setBusy(true);
      try {
        if (!next) {
          try {
            await deleteNoteGraphEdges();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not clear graph edges.");
          }
          await setNoteGraphEnabled(false);
          return;
        }

        await setNoteGraphEnabled(true);
        try {
          const status = await getEmbedStatus();
          if (status.remaining === 0) {
            await enqueueNoteGraphRebuild();
          }
        } catch {
          // Replication may still be catching up; rebuild will enqueue after embeddings anyway.
        }
      } finally {
        setBusy(false);
      }
    },
    [canUseCloudExtensions, setNoteGraphEnabled],
  );

  const onRegenerateGraph = useCallback(async () => {
    if (!canUseCloudExtensions || !noteGraphEnabled) return;
    setRegenerating(true);
    try {
      await deleteNoteGraphEdges();
      await enqueueNoteGraphRebuild();
      toast.success("Graph regeneration started.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not regenerate graph.");
    } finally {
      setRegenerating(false);
    }
  }, [canUseCloudExtensions, noteGraphEnabled]);

  return (
    <div className="grid gap-3">
      {!canUseCloudExtensions ? (
        <p className="m-0 text-[0.84rem] leading-snug text-muted">
          Connect to your server and sign in to use cloud extensions.
        </p>
      ) : null}

      <input
        type="search"
        className={nativeFieldBorderedClassName}
        placeholder="Search extensions..."
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {!anyMatch ? (
        <p className="m-0 text-[0.84rem] leading-snug text-muted">
          No extensions match &ldquo;{query}&rdquo;.
        </p>
      ) : null}

      {matches(extensions[0].title, extensions[0].description) ? (
        <label className="flex items-start gap-3 rounded-[12px] border border-white/[0.06] bg-white/[0.03] px-3 py-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-white"
            checked={noteGraphEnabled}
            disabled={!canUseCloudExtensions || busy}
            onChange={(event) => void onToggleNoteGraph(event.target.checked)}
          />
          <span className="grid gap-1">
            <span className="text-[0.9rem] font-medium text-foreground">Note similarity graph</span>
            <span className="text-[0.8rem] leading-snug text-faint">
              Explore related notes from embeddings (no manual links). Requires AI embeddings to be
              configured. Turning this off removes stored similarity edges on the server.
            </span>
            {noteGraphEnabled ? (
              <button
                className="mt-1 w-fit cursor-pointer rounded-md border border-white/[0.09] bg-white/[0.04] px-2.5 py-1 text-[0.78rem] text-muted transition-colors hover:bg-white/[0.08] hover:text-foreground disabled:cursor-default disabled:opacity-40"
                onClick={(e) => {
                  e.preventDefault();
                  void onRegenerateGraph();
                }}
                disabled={regenerating || busy}
              >
                {regenerating ? "Regenerating..." : "Regenerate graph"}
              </button>
            ) : null}
          </span>
        </label>
      ) : null}

      {matches(extensions[1].title, extensions[1].description) ? (
        <label className="flex items-start gap-3 rounded-[12px] border border-white/[0.06] bg-white/[0.03] px-3 py-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-white"
            checked={checklistsEnabled}
            onChange={(event) => void setChecklistsEnabled(event.target.checked)}
          />
          <span className="grid gap-1">
            <span className="text-[0.9rem] font-medium text-foreground">Checklists</span>
            <span className="text-[0.8rem] leading-snug text-faint">
              Create running task lists that aggregate checkboxes from notes matching regex
              patterns. Works offline — no server connection required.
            </span>
          </span>
        </label>
      ) : null}

      {matches(extensions[2].title, extensions[2].description) ? (
        <label className="flex items-start gap-3 rounded-[12px] border border-white/[0.06] bg-white/[0.03] px-3 py-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-white"
            checked={homeAssistantEnabled}
            disabled={!canUseCloudExtensions}
            onChange={(event) => void setHomeAssistantEnabled(event.target.checked)}
          />
          <span className="grid gap-1">
            <span className="text-[0.9rem] font-medium text-foreground">Home Assistant</span>
            <span className="text-[0.8rem] leading-snug text-faint">
              Browse dashboards and safely control Home Assistant entities through your Slate
              server. Requires a backend connection.
            </span>
          </span>
        </label>
      ) : null}

      {matches(extensions[3].title, extensions[3].description) ? (
        <label className="flex items-start gap-3 rounded-[12px] border border-white/[0.06] bg-white/[0.03] px-3 py-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-white"
            checked={linkwardenEnabled}
            disabled={!canUseCloudExtensions}
            onChange={(event) => void setLinkwardenEnabled(event.target.checked)}
          />
          <span className="grid gap-1">
            <span className="text-[0.9rem] font-medium text-foreground">LinkWarden</span>
            <span className="text-[0.8rem] leading-snug text-faint">
              Browse and save bookmarks from your LinkWarden instances. Requires a backend
              connection.
            </span>
          </span>
        </label>
      ) : null}

      {matches(extensions[4].title, extensions[4].description) ? (
        <label className="flex items-start gap-3 rounded-[12px] border border-white/[0.06] bg-white/[0.03] px-3 py-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-white"
            checked={jiraEnabled}
            disabled={!canUseCloudExtensions}
            onChange={(event) => void setJiraEnabled(event.target.checked)}
          />
          <span className="grid gap-1">
            <span className="text-[0.9rem] font-medium text-foreground">Jira</span>
            <span className="text-[0.8rem] leading-snug text-faint">
              View and manage Jira issues. Requires a backend connection.
            </span>
          </span>
        </label>
      ) : null}

      {matches(extensions[5].title, extensions[5].description) ? (
        <label className="flex items-start gap-3 rounded-[12px] border border-white/[0.06] bg-white/[0.03] px-3 py-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-white"
            checked={forgeEnabled}
            disabled={!canUseCloudExtensions}
            onChange={(event) => void setForgeEnabled(event.target.checked)}
          />
          <span className="grid gap-1">
            <span className="text-[0.9rem] font-medium text-foreground">GitHub / GitLab</span>
            <span className="text-[0.8rem] leading-snug text-faint">
              Keep an eye on PRs, MRs, review requests, notifications, and repos. All detail
              views open in your browser.
            </span>
          </span>
        </label>
      ) : null}

      {matches(extensions[6].title, extensions[6].description) ? (
        <label className="flex items-start gap-3 rounded-[12px] border border-white/[0.06] bg-white/[0.03] px-3 py-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-white"
            checked={diagramsEnabled}
            disabled={!canUseCloudExtensions}
            onChange={(event) => void setDiagramsEnabled(event.target.checked)}
          />
          <span className="grid gap-1">
            <span className="text-[0.9rem] font-medium text-foreground">Diagrams</span>
            <span className="text-[0.8rem] leading-snug text-faint">
              Create Excalidraw diagrams alongside your notes. Requires a backend connection.
            </span>
          </span>
        </label>
      ) : null}
    </div>
  );
}
