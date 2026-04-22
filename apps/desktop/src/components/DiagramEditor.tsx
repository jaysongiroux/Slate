import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getDiagram,
  updateDiagram,
  type DiagramRecord,
  type DiagramScene,
} from "../lib/api/diagrams-api";
import { useDebouncedSave } from "../hooks/useDebouncedSave";
import { uploadAttachment, resolveAttachmentUrl } from "../lib/api/attachments-api";
import { useAppStore } from "../stores/app-store";

const ATTACHMENT_PREFIX = "attachment:";

type ExcalidrawFile = {
  id: string;
  dataURL: string;
  mimeType: string;
  created?: number;
};

async function persistFiles(
  diagramId: string,
  files: Record<string, ExcalidrawFile>,
): Promise<Record<string, ExcalidrawFile>> {
  const result: Record<string, ExcalidrawFile> = {};
  for (const [key, file] of Object.entries(files ?? {})) {
    if (!file) continue;
    if (file.dataURL?.startsWith(ATTACHMENT_PREFIX)) {
      result[key] = file;
      continue;
    }
    if (file.dataURL?.startsWith("data:")) {
      const buffer = dataUrlToArrayBuffer(file.dataURL);
      const attachment = await uploadAttachment({
        buffer,
        fileName: file.id || key,
        mimeType: file.mimeType ?? "image/png",
        containerType: "diagram",
        containerId: diagramId,
      });
      result[key] = { ...file, dataURL: `${ATTACHMENT_PREFIX}${attachment.id}` };
    } else {
      result[key] = file;
    }
  }
  return result;
}

async function hydrateFiles(
  files: Record<string, ExcalidrawFile>,
): Promise<Record<string, ExcalidrawFile>> {
  const hydrated: Record<string, ExcalidrawFile> = {};
  for (const [key, file] of Object.entries(files ?? {})) {
    if (!file) continue;
    if (file.dataURL?.startsWith(ATTACHMENT_PREFIX)) {
      const attachmentId = file.dataURL.slice(ATTACHMENT_PREFIX.length);
      const url = await resolveAttachmentUrl(`/api/attachments/${attachmentId}/content`);
      const response = await fetch(url);
      const blob = await response.blob();
      hydrated[key] = { ...file, dataURL: await blobToDataUrl(blob) };
    } else {
      hydrated[key] = file;
    }
  }
  return hydrated;
}

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

interface Props {
  diagramId: string;
}

export function DiagramEditor({ diagramId }: Props) {
  const [record, setRecord] = useState<DiagramRecord | null>(null);
  const [pendingScene, setPendingScene] = useState<DiagramScene | null>(null);
  const [title, setTitle] = useState("");
  const refreshSignal = useAppStore((s) => s.diagramRefreshSignal);

  useEffect(() => {
    setRecord(null);
    setPendingScene(null);
    if (!diagramId) return;
    let cancelled = false;
    getDiagram(diagramId).then(async (d) => {
      if (cancelled) return;
      const hydratedFiles = await hydrateFiles(
        (d.scene.files ?? {}) as Record<string, ExcalidrawFile>,
      );
      if (cancelled) return;
      setRecord({ ...d, scene: { ...d.scene, files: hydratedFiles } });
      setTitle(d.title);
    });
    return () => {
      cancelled = true;
    };
  }, [diagramId, refreshSignal]);

  useDebouncedSave(pendingScene, 800, async (scene) => {
    if (!scene || !record) return;
    const persistedFiles = await persistFiles(
      record.id,
      scene.files as Record<string, ExcalidrawFile>,
    );
    await updateDiagram({
      id: record.id,
      scene: { ...scene, files: persistedFiles },
    });
  });

  useDebouncedSave(title, 600, async (t) => {
    if (!record || t === record.title) return;
    await updateDiagram({ id: record.id, title: t });
  });

  // Excalidraw uses initialData's identity as a scene-reset trigger.
  // Keying on record.id keeps it stable within a diagram, preventing an onChange/setState loop.
  const initialData = useMemo(() => {
    if (!record) return null;
    return {
      elements: (record.scene.elements ?? []) as any,
      appState: { ...(record.scene.appState ?? {}), collaborators: [] } as any,
      files: (record.scene.files ?? {}) as any,
    };
  }, [record]);

  const handleExcalidrawChange = useCallback((elements: any, appState: any, files: any) => {
    setPendingScene({
      elements: elements as unknown[],
      appState: stripTransientAppState(appState),
      files: files as Record<string, unknown>,
    });
  }, []);

  if (!diagramId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted">
        Select or create a diagram from the sidebar.
      </div>
    );
  }
  if (!record || !initialData) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted">Loading…</div>
    );
  }

  return (
    <div className="flex h-full flex-1 flex-col">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="border-b border-white/10 bg-transparent px-3 py-2 text-sm font-medium outline-none"
        placeholder="Untitled Diagram"
      />
      <div className="min-h-0 flex-1">
        <Excalidraw
          key={record.id}
          theme="dark"
          initialData={initialData}
          onChange={handleExcalidrawChange}
        />
      </div>
    </div>
  );
}

function stripTransientAppState(appState: any) {
  // Drop transient/non-serializable fields from Excalidraw's appState before persisting.
  // collaborators is serialized as a Map that doesn't round-trip through JSON.
  const { collaborators, ...rest } = appState ?? {};
  return rest as Record<string, unknown>;
}
