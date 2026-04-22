import { desktopApi } from "./ipc-core";

export interface DiagramSummary {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
}

export interface DiagramScene {
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

export interface DiagramRecord extends DiagramSummary {
  scene: DiagramScene;
}

export function listDiagrams(): Promise<DiagramSummary[]> {
  return desktopApi().listDiagrams();
}

export function getDiagram(id: string): Promise<DiagramRecord> {
  return desktopApi().getDiagram(id);
}

export function createDiagram(title?: string): Promise<DiagramRecord> {
  return desktopApi().createDiagram(title);
}

export function updateDiagram(payload: {
  id: string;
  title?: string;
  scene?: DiagramScene;
}): Promise<DiagramRecord> {
  return desktopApi().updateDiagram(payload);
}

export function deleteDiagram(id: string): Promise<void> {
  return desktopApi().deleteDiagram(id);
}
