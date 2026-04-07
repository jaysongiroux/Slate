import { createListCalendarsTool } from "./list-calendars.tool";

const userId = "user-1";
const enabledCalendarIds = ["sub-1", "sub-2"];
const enabledIcsIds = ["ics-1"];

function makeMockLogger() {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;
}

function makeMockCalendarService(statusResult: any = { connections: [], icsSubscriptions: [] }) {
  return {
    getStatus: jest.fn().mockResolvedValue(statusResult),
  } as any;
}

describe("createListCalendarsTool", () => {
  it("returns a tool with name 'list_calendars'", () => {
    const t = createListCalendarsTool(
      makeMockCalendarService(),
      userId,
      enabledCalendarIds,
      enabledIcsIds,
      makeMockLogger(),
    );
    expect(t.name).toBe("list_calendars");
  });

  it("returns calendars from connections filtered by enabled set", async () => {
    const status = {
      connections: [
        {
          provider: "google",
          email: "user@test.com",
          calendars: [
            { subscriptionId: "sub-1", name: "Work", color: "#000" },
            { subscriptionId: "sub-2", name: "Personal", color: "#111" },
            { subscriptionId: "sub-99", name: "Hidden", color: "#222" },
          ],
        },
      ],
      icsSubscriptions: [],
    };
    const t = createListCalendarsTool(
      makeMockCalendarService(status),
      userId,
      enabledCalendarIds,
      enabledIcsIds,
      makeMockLogger(),
    );

    const result = await t.invoke({});
    const parsed = JSON.parse(result as string);

    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe("Work");
    expect(parsed[0].subscriptionId).toBe("sub-1");
    expect(parsed[0].source).toBe("google");
    expect(parsed[0].email).toBe("user@test.com");
    expect(parsed[0].readOnly).toBe(false);
    expect(parsed[1].name).toBe("Personal");
  });

  it("returns ICS subscriptions filtered by enabled set", async () => {
    const status = {
      connections: [],
      icsSubscriptions: [
        { id: "ics-1", name: "Holidays", color: "#f00" },
        { id: "ics-99", name: "Hidden ICS", color: "#0f0" },
      ],
    };
    const t = createListCalendarsTool(
      makeMockCalendarService(status),
      userId,
      enabledCalendarIds,
      enabledIcsIds,
      makeMockLogger(),
    );

    const result = await t.invoke({});
    const parsed = JSON.parse(result as string);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("Holidays");
    expect(parsed[0].subscriptionId).toBe("ics-1");
    expect(parsed[0].source).toBe("ics");
    expect(parsed[0].readOnly).toBe(true);
  });

  it("returns both provider and ICS calendars combined", async () => {
    const status = {
      connections: [
        {
          provider: "google",
          email: "user@test.com",
          calendars: [{ subscriptionId: "sub-1", name: "Work", color: "#000" }],
        },
      ],
      icsSubscriptions: [{ id: "ics-1", name: "Holidays", color: "#f00" }],
    };
    const t = createListCalendarsTool(
      makeMockCalendarService(status),
      userId,
      enabledCalendarIds,
      enabledIcsIds,
      makeMockLogger(),
    );

    const result = await t.invoke({});
    const parsed = JSON.parse(result as string);

    expect(parsed).toHaveLength(2);
    expect(parsed.map((c: any) => c.name)).toEqual(["Work", "Holidays"]);
  });

  it("returns empty array when no calendars are enabled", async () => {
    const t = createListCalendarsTool(makeMockCalendarService(), userId, [], [], makeMockLogger());

    const result = await t.invoke({});
    const parsed = JSON.parse(result as string);

    expect(parsed).toEqual([]);
  });

  it("logs the result count", async () => {
    const logger = makeMockLogger();
    const status = {
      connections: [
        {
          provider: "google",
          email: "user@test.com",
          calendars: [{ subscriptionId: "sub-1", name: "Work", color: "#000" }],
        },
      ],
      icsSubscriptions: [{ id: "ics-1", name: "Holidays", color: "#f00" }],
    };
    const t = createListCalendarsTool(
      makeMockCalendarService(status),
      userId,
      enabledCalendarIds,
      enabledIcsIds,
      logger,
    );

    await t.invoke({});

    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining("list_calendars"));
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining("returned=2"));
  });
});
