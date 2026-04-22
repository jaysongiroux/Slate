import { z, ZodTypeAny } from "zod";

interface JsonSchemaProp {
  type?: string | string[];
  enum?: unknown[];
  items?: JsonSchemaProp;
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
  description?: string;
}

export function jsonSchemaToZod(schema?: JsonSchemaProp): ZodTypeAny {
  if (!schema || typeof schema !== "object") {
    return z.object({}).passthrough();
  }
  const t = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (schema.enum && Array.isArray(schema.enum)) {
    return z.enum(schema.enum as [string, ...string[]]);
  }
  switch (t) {
    case "string":
      return z.string();
    case "number":
    case "integer":
      return z.number();
    case "boolean":
      return z.boolean();
    case "array":
      return z.array(jsonSchemaToZod(schema.items));
    case "object": {
      if (!schema.properties) return z.object({}).passthrough();
      const required = new Set(schema.required ?? []);
      const shape: Record<string, ZodTypeAny> = {};
      for (const [k, v] of Object.entries(schema.properties)) {
        const inner = jsonSchemaToZod(v);
        shape[k] = required.has(k) ? inner : inner.optional();
      }
      return z.object(shape).passthrough();
    }
    default:
      return z.any();
  }
}
