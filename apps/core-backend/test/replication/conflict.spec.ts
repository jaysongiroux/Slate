import { detectConflict } from "../../src/replication/conflict";

describe("detectConflict", () => {
  const master = {
    id: "note1",
    title: "Server Title",
    createdAt: "2026-04-10T10:00:00.000Z",
    updatedAt: "2026-04-10T12:00:00.000Z",
  };

  it("returns null when assumedMasterState matches current master", () => {
    const assumed = { ...master };
    expect(detectConflict(master, assumed)).toBeNull();
  });

  it("returns the master document when assumedMasterState differs", () => {
    const assumed = { ...master, title: "Stale Title" };
    expect(detectConflict(master, assumed)).toEqual(master);
  });

  it("ignores server-managed timestamp drift when comparing assumed master state", () => {
    const assumed = {
      ...master,
      createdAt: "2026-04-10T09:59:59.000Z",
      updatedAt: "2026-04-10T11:59:59.000Z",
    };

    expect(detectConflict(master, assumed)).toBeNull();
  });

  it("returns null when both are null (new document)", () => {
    expect(detectConflict(null, null)).toBeNull();
  });

  it("returns master when assumed is null but master exists (created on another device)", () => {
    expect(detectConflict(master, null)).toEqual(master);
  });
});
