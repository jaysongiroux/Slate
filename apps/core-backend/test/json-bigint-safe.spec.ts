import { jsonBigIntSafe } from "../src/lib/json-bigint-safe";

describe("jsonBigIntSafe", () => {
  it("converts nested bigint to string and leaves other types intact", () => {
    const d = new Date("2020-01-01T00:00:00.000Z");
    const input = {
      id: 1n,
      nested: { seq: 42n, n: 7 },
      list: [3n, "x"],
      d,
    };
    const out = jsonBigIntSafe(input) as typeof input;
    expect(out.id).toBe("1");
    expect(out.nested.seq).toBe("42");
    expect(out.nested.n).toBe(7);
    expect(out.list[0]).toBe("3");
    expect(out.list[1]).toBe("x");
    expect(out.d).toBe(d);
  });

  it("handles bigint at root", () => {
    expect(jsonBigIntSafe(99n)).toBe("99");
  });
});
