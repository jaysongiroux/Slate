import type { BaseResource } from "adminjs";
import type { Filter } from "adminjs";
import { BaseRecord } from "adminjs";
import prismaPkg = require("@adminjs/prisma");

/** `convertFilter` / `convertParam` exist at runtime; package typings omit them. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prismaPkg as any;
const PrismaResource = p.Resource;
const convertFilter = p.convertFilter as (
  modelFields: unknown,
  filter?: Filter,
) => Record<string, unknown>;
const convertParam = p.convertParam as (
  property: unknown,
  fields: unknown,
  value: string | number | boolean | Record<string, unknown> | null | undefined,
) => unknown;

const SETTING_USER_INCLUDE = { user: { select: { email: true, displayName: true } } };

/**
 * Extends the Prisma adapter to:
 * - Drop Bytes columns (e.g. Document.crdtState).
 * - For `Setting`: include `user` for display, add `userLabel`, stringify JSON `value` for list/show.
 *
 * Imports must use the public `@adminjs/prisma` entry only (not `.../lib/utils/...`), or Node/tsx
 * rejects deep paths under "exports".
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class SlatePrismaResource extends (PrismaResource as any) {
  prepareProperties() {
    const props = super.prepareProperties() as Record<string, { column?: { type?: string } }>;
    return Object.fromEntries(
      Object.entries(props).filter(([, property]) => property.column?.type !== "Bytes"),
    );
  }

  prepareReturnValues(params: Record<string, unknown>) {
    const prepared = super.prepareReturnValues(params) as Record<string, unknown>;
    if (this.model.name === "Setting") {
      if (params?.user && typeof params.user === "object") {
        const u = params.user as { email?: string; displayName?: string };
        prepared.userLabel =
          u.email || u.displayName
            ? `${u.email ?? ""}${u.email && u.displayName ? " · " : ""}${u.displayName ?? ""}`.trim()
            : String(prepared.userId ?? "");
      }
      if (Object.prototype.hasOwnProperty.call(params, "value")) {
        const v = params.value;
        if (v !== undefined && v !== null) {
          try {
            prepared.value = typeof v === "string" ? v : JSON.stringify(v, null, 2);
          } catch {
            prepared.value = String(v);
          }
        }
      }
    }
    return prepared;
  }

  async find(filter: Filter | undefined, params: Record<string, unknown> = {}) {
    if (this.model.name !== "Setting") {
      return super.find(filter, params);
    }
    const { limit = 10, offset = 0, sort = {} } = params;
    const orderBy = this.buildSortBy(sort);
    const results = await this.manager.findMany({
      where: convertFilter(this.model.fields, filter),
      skip: offset,
      take: limit,
      orderBy,
      include: SETTING_USER_INCLUDE,
    });
    return results.map(
      (result: Record<string, unknown>) =>
        new BaseRecord(this.prepareReturnValues(result), this as unknown as BaseResource),
    );
  }

  async findOne(id: string | number) {
    if (this.model.name !== "Setting") {
      return super.findOne(id);
    }
    const idProperty = this.properties().find((property: { isId: () => boolean }) =>
      property.isId(),
    );
    if (!idProperty) return null;
    const result = await this.manager.findUnique({
      where: {
        [idProperty.path()]: convertParam(idProperty, this.model.fields, id),
      },
      include: SETTING_USER_INCLUDE,
    });
    if (!result) return null;
    return new BaseRecord(this.prepareReturnValues(result), this as unknown as BaseResource);
  }

  async findMany(ids: (string | number)[]) {
    if (this.model.name !== "Setting") {
      return super.findMany(ids);
    }
    const idProperty = this.properties().find((property: { isId: () => boolean }) =>
      property.isId(),
    );
    if (!idProperty) return [];
    const results = await this.manager.findMany({
      where: {
        [idProperty.path()]: {
          in: ids.map((id) => convertParam(idProperty, this.model.fields, id)),
        },
      },
      include: SETTING_USER_INCLUDE,
    });
    return results.map(
      (result: Record<string, unknown>) =>
        new BaseRecord(this.prepareReturnValues(result), this as unknown as BaseResource),
    );
  }
}
