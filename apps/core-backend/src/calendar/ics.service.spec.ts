import { ConfigService } from "@nestjs/config";
import {
  decryptCalendarSecret,
  encryptCalendarSecret,
  hashCalendarSecret,
} from "./calendar-crypto.util";
import { IcsService } from "./ics.service";

jest.mock("node-ical", () => ({
  __esModule: true,
  default: {
    async: {
      fromURL: jest.fn().mockResolvedValue({}),
    },
  },
  async: {
    fromURL: jest.fn().mockResolvedValue({}),
  },
}));

describe("IcsService", () => {
  const encryptionKey = "test-calendar-encryption-key";

  function makeConfigService() {
    return {
      get: jest.fn((key: string, fallback?: string) =>
        key === "CALENDAR_ENCRYPTION_KEY" ? encryptionKey : fallback,
      ),
    } as unknown as ConfigService;
  }

  it("encrypts ICS URLs before storing them", async () => {
    const prisma = {
      icsSubscription: {
        upsert: jest.fn().mockImplementation(async ({ create }: any) => ({
          id: "ics-1",
          ...create,
        })),
      },
    };

    const service = new IcsService(prisma as any, makeConfigService());
    const url = "https://example.com/calendar.ics";

    const result = await service.addSubscription("user-1", url, "Feed", "#7c5cdc");

    expect(prisma.icsSubscription.upsert).toHaveBeenCalledTimes(1);
    const [{ where, create, update }] = (prisma.icsSubscription.upsert as jest.Mock).mock.calls[0];

    expect(where).toEqual({
      userId_urlHash: {
        userId: "user-1",
        urlHash: hashCalendarSecret(url),
      },
    });
    expect(create.urlEncrypted).not.toBe(url);
    expect(update.urlEncrypted).not.toBe(url);
    expect(create.urlHash).toBe(hashCalendarSecret(url));
    expect(update.urlHash).toBe(hashCalendarSecret(url));
    expect(decryptCalendarSecret(create.urlEncrypted, encryptionKey)).toBe(url);
    expect(result.url).toBe(url);
  });

  it("decrypts stored ICS URLs when returning subscription metadata", async () => {
    const plaintextUrl = "https://example.com/calendar.ics";
    const storedUrlEncrypted = encryptCalendarSecret(plaintextUrl, encryptionKey);
    const storedUrlHash = hashCalendarSecret(plaintextUrl);
    const prisma = {
      icsSubscription: {
        findFirst: jest.fn().mockResolvedValue({
          id: "ics-1",
          userId: "user-1",
          urlEncrypted: storedUrlEncrypted,
          urlHash: storedUrlHash,
          name: "Feed",
          color: "#7c5cdc",
          enabled: true,
        }),
        update: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: "ics-1",
          userId: "user-1",
          urlEncrypted: data.urlEncrypted ?? storedUrlEncrypted,
          urlHash: data.urlHash ?? storedUrlHash,
          ...data,
          name: "Feed",
          color: "#7c5cdc",
          enabled: true,
        })),
      },
    };

    const service = new IcsService(prisma as any, makeConfigService());
    const result = await service.updateSubscription("user-1", "ics-1");

    expect(result.url).toBe(plaintextUrl);
  });

  it("updates the ICS feed name without changing the stored URL", async () => {
    const plaintextUrl = "https://example.com/calendar.ics";
    const storedUrlEncrypted = encryptCalendarSecret(plaintextUrl, encryptionKey);
    const storedUrlHash = hashCalendarSecret(plaintextUrl);
    const prisma = {
      icsSubscription: {
        findFirst: jest.fn().mockResolvedValue({
          id: "ics-1",
          userId: "user-1",
          urlEncrypted: storedUrlEncrypted,
          urlHash: storedUrlHash,
          name: "Old feed name",
          color: "#7c5cdc",
          enabled: true,
        }),
        update: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: "ics-1",
          userId: "user-1",
          urlEncrypted: storedUrlEncrypted,
          urlHash: storedUrlHash,
          name: data.name ?? "Old feed name",
          color: data.color ?? "#7c5cdc",
          enabled: data.enabled ?? true,
        })),
      },
    };

    const service = new IcsService(prisma as any, makeConfigService());
    const result = await service.updateSubscription("user-1", "ics-1", "Renamed feed");

    expect(prisma.icsSubscription.update).toHaveBeenCalledWith({
      where: { id: "ics-1" },
      data: { name: "Renamed feed" },
    });
    expect(result.name).toBe("Renamed feed");
    expect(result.url).toBe(plaintextUrl);
  });
});
