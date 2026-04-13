import { Buffer } from "node:buffer";

/**
 * Deep-clone plain JSON-ish structures while converting BigInt values to decimal
 * strings so `JSON.stringify` and Fastify's default serializer never throw.
 * Preserves Date instances; defers to `toJSON` when present (after excluding Buffer/Date/typed arrays).
 */
export function jsonBigIntSafe(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (value instanceof Date) {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => jsonBigIntSafe(item));
  }
  const maybeJson = value as { toJSON?: () => unknown };
  if (typeof maybeJson.toJSON === "function") {
    return jsonBigIntSafe(maybeJson.toJSON());
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    out[key] = jsonBigIntSafe((value as Record<string, unknown>)[key]);
  }
  return out;
}
