import type { RxJsonSchema } from "rxdb";

export interface SettingDocType {
  id: string;
  key: string;
  value: unknown;
  updatedAt: string;
}

export const settingSchema: RxJsonSchema<SettingDocType> = {
  version: 0,
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    key: { type: "string", maxLength: 200 },
    value: {},
    updatedAt: { type: "string", format: "date-time", maxLength: 50 },
  },
  required: ["id", "key", "updatedAt"],
  indexes: ["updatedAt", "key"],
};
