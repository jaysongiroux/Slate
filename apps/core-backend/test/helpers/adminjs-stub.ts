/**
 * Stub for adminjs and @adminjs/* in Jest.
 *
 * adminjs ships as native ESM which ts-jest (CommonJS) cannot load.
 * Tests in this workspace don't exercise the admin UI, so we substitute
 * a minimal stub that satisfies imports in src/admin/* without actually
 * registering the admin plugin at runtime.
 */

class BaseRecord {
  constructor(params: unknown, _resource?: unknown) {
    Object.assign(this, params ?? {});
  }
}

class AdminJS {
  static readonly VERSION = "stub";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(..._args: any[]) {}
  watch() {}
}

const convertFilter = () => ({});
const convertParam = (v: unknown) => v;

class PrismaResource {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any = { name: "" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  manager: any = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(..._args: any[]) {}
  prepareProperties() {
    return {};
  }
  prepareReturnValues(params: Record<string, unknown>) {
    return params;
  }
  properties() {
    return [];
  }
  buildSortBy() {
    return {};
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async find(..._args: any[]) {
    return [];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async findOne(..._args: any[]) {
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async findMany(..._args: any[]) {
    return [];
  }
}

module.exports = {
  __esModule: true,
  default: AdminJS,
  AdminJS,
  BaseRecord,
  BaseResource: class BaseResource {},
  Filter: class Filter {},
  Resource: PrismaResource,
  PrismaResource,
  convertFilter,
  convertParam,
};
