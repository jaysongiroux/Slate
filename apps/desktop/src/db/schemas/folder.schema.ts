import type { RxJsonSchema } from "rxdb";

export interface FolderDocType {
  id: string;
  path: string;
  updatedAt: string;
  createdAt: string;
}

export const folderSchema: RxJsonSchema<FolderDocType> = {
  version: 0,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    path: { type: "string", maxLength: 500 },
    updatedAt: { type: "string", format: "date-time", maxLength: 50 },
    createdAt: { type: "string", format: "date-time", maxLength: 50 },
  },
  required: ["id", "path", "updatedAt", "createdAt"],
  indexes: ["updatedAt", "path"],
};
