import { jsonSchemaToZod } from "../json-schema-to-zod";

describe("jsonSchemaToZod", () => {
  it("converts a simple object with required fields", () => {
    const z = jsonSchemaToZod({
      type: "object",
      properties: { q: { type: "string" }, limit: { type: "number" } },
      required: ["q"],
    });
    expect(() => z.parse({ q: "hi" })).not.toThrow();
    expect(() => z.parse({ q: "hi", limit: 5 })).not.toThrow();
    expect(() => z.parse({})).toThrow();
    expect(() => z.parse({ q: 123 })).toThrow();
  });

  it("supports enums and booleans", () => {
    const z = jsonSchemaToZod({
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "closed"] },
        active: { type: "boolean" },
      },
      required: ["status"],
    });
    expect(() => z.parse({ status: "open" })).not.toThrow();
    expect(() => z.parse({ status: "wat" })).toThrow();
  });

  it("supports arrays", () => {
    const z = jsonSchemaToZod({
      type: "object",
      properties: { ids: { type: "array", items: { type: "string" } } },
      required: ["ids"],
    });
    expect(() => z.parse({ ids: ["a", "b"] })).not.toThrow();
    expect(() => z.parse({ ids: [1, 2] })).toThrow();
  });

  it("falls back to passthrough for unknown shapes", () => {
    const z = jsonSchemaToZod({ type: "object" });
    expect(() => z.parse({ anything: "ok" })).not.toThrow();
  });

  it("returns a passthrough object when schema is missing", () => {
    const z = jsonSchemaToZod(undefined as any);
    expect(() => z.parse({})).not.toThrow();
  });
});
