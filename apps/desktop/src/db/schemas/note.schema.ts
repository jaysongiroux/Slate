import type { RxJsonSchema } from "rxdb";

export interface NoteDocType {
  id: string;
  title: string;
  path: string;
  content: Record<string, unknown>;
  markdown: string;
  pinned: boolean;
  isDeleted: boolean;
  isTemplate: boolean;
  updatedAt: string;
  createdAt: string;
}

export const noteSchema: RxJsonSchema<NoteDocType> = {
  version: 0,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    title: { type: "string" },
    path: { type: "string", maxLength: 500 },
    content: { type: "object" },
    markdown: { type: "string" },
    pinned: { type: "boolean" },
    isDeleted: { type: "boolean" },
    isTemplate: { type: "boolean" },
    updatedAt: { type: "string", format: "date-time", maxLength: 50 },
    createdAt: { type: "string", format: "date-time", maxLength: 50 },
  },
  required: [
    "id",
    "title",
    "path",
    "content",
    "markdown",
    "pinned",
    "isDeleted",
    "isTemplate",
    "updatedAt",
    "createdAt",
  ],
  indexes: ["updatedAt", "path", ["isDeleted", "updatedAt"]],
};
