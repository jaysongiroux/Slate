declare module "@adminjs/prisma" {
  export const Database: unknown;
  export const Resource: unknown;
  export function getModelByName(modelName: string): unknown;
}

declare module "@adminjs/design-system" {
  import type { FC, ReactNode } from "react";

  export const Box: FC<Record<string, unknown> & { children?: ReactNode }>;
  export const H2: FC<Record<string, unknown> & { children?: ReactNode }>;
  export const H5: FC<Record<string, unknown> & { children?: ReactNode }>;
  export const Text: FC<Record<string, unknown> & { children?: ReactNode }>;
}
