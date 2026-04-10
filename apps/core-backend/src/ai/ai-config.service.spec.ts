import type { AppConfig } from "../lib/types";
import type { PrismaClient } from "@slate/server-db";
import { JobsService } from "../jobs/jobs.service";
import { AiConfigService } from "./ai-config.service";
import { decryptSecret } from "./encryption.util";

const TEST_ENCRYPTION_KEY = "local-dev-ai-key";

function makePrisma() {
  return {
    aiConfig: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    documentChunk: {
      deleteMany: jest.fn(),
    },
    document: {
      updateMany: jest.fn(),
    },
  } as unknown as PrismaClient;
}

function makeConfig(key = TEST_ENCRYPTION_KEY): AppConfig {
  return {
    get: jest.fn().mockReturnValue(key),
  };
}

function makeJobs() {
  return {
    enqueue: jest.fn().mockResolvedValue("job-1"),
  } as unknown as JobsService;
}

describe("AiConfigService", () => {
  let service: AiConfigService;
  let prisma: ReturnType<typeof makePrisma>;
  let config: ReturnType<typeof makeConfig>;
  let jobs: ReturnType<typeof makeJobs>;

  beforeEach(() => {
    prisma = makePrisma();
    config = makeConfig();
    jobs = makeJobs();
    service = new AiConfigService(
      prisma as unknown as PrismaClient,
      config as AppConfig,
      jobs as unknown as JobsService,
    );
  });

  describe("getConfig", () => {
    it("returns the AiConfig for the given user", async () => {
      const mockConfig = {
        id: "cfg-1",
        userId: "user-1",
        embeddingModel: "text-embedding-ada-002",
      };
      (prisma.aiConfig.findUnique as jest.Mock).mockResolvedValue(mockConfig);

      const result = await service.getConfig("user-1");

      expect(prisma.aiConfig.findUnique).toHaveBeenCalledWith({ where: { userId: "user-1" } });
      expect(result).toEqual(mockConfig);
    });

    it("returns null when no config exists for the user", async () => {
      (prisma.aiConfig.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.getConfig("user-99");

      expect(result).toBeNull();
    });
  });

  describe("upsertConfig", () => {
    it("encrypts embeddingApiKey before storing", async () => {
      (prisma.aiConfig.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.aiConfig.upsert as jest.Mock).mockResolvedValue({});

      await service.upsertConfig("user-1", {
        embeddingProvider: "OPENAI",
        embeddingModel: "text-embedding-ada-002",
        embeddingApiKey: "sk-rawkey123",
      });

      const upsertCall = (prisma.aiConfig.upsert as jest.Mock).mock.calls[0][0];
      const storedKey = upsertCall.create.embeddingApiKey;

      // Stored value must not be the raw key
      expect(storedKey).not.toBe("sk-rawkey123");

      // Must be in hex.hex.hex format
      expect(storedKey).toMatch(/^[0-9a-f]+\.[0-9a-f]+\.[0-9a-f]+$/);

      // Must be decryptable back to the original
      const decrypted = decryptSecret(storedKey, TEST_ENCRYPTION_KEY);
      expect(decrypted).toBe("sk-rawkey123");
    });

    it("encrypts chatApiKey before storing", async () => {
      (prisma.aiConfig.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.aiConfig.upsert as jest.Mock).mockResolvedValue({});

      await service.upsertConfig("user-1", {
        chatProvider: "OPENAI",
        chatModel: "gpt-4o",
        chatApiKey: "sk-chatkey456",
      });

      const upsertCall = (prisma.aiConfig.upsert as jest.Mock).mock.calls[0][0];
      const storedKey = upsertCall.create.chatApiKey;

      expect(storedKey).not.toBe("sk-chatkey456");
      expect(storedKey).toMatch(/^[0-9a-f]+\.[0-9a-f]+\.[0-9a-f]+$/);

      const decrypted = decryptSecret(storedKey, TEST_ENCRYPTION_KEY);
      expect(decrypted).toBe("sk-chatkey456");
    });

    it("stores null when embeddingApiKey is explicitly null", async () => {
      (prisma.aiConfig.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.aiConfig.upsert as jest.Mock).mockResolvedValue({});

      await service.upsertConfig("user-1", { embeddingApiKey: null });

      const upsertCall = (prisma.aiConfig.upsert as jest.Mock).mock.calls[0][0];
      expect(upsertCall.create.embeddingApiKey).toBeNull();
    });

    it("deletes DocumentChunks and resets embedded when embeddingModel changes", async () => {
      const existingConfig = {
        userId: "user-1",
        embeddingProvider: "OPENAI",
        embeddingModel: "text-embedding-ada-002",
      };
      (prisma.aiConfig.findUnique as jest.Mock).mockResolvedValue(existingConfig);
      (prisma.aiConfig.upsert as jest.Mock).mockResolvedValue({});
      (prisma.documentChunk.deleteMany as jest.Mock).mockResolvedValue({ count: 5 });
      (prisma.document.updateMany as jest.Mock).mockResolvedValue({ count: 3 });

      await service.upsertConfig("user-1", {
        embeddingModel: "text-embedding-3-small",
      });

      expect(prisma.documentChunk.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
      expect(prisma.document.updateMany).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        data: { embedded: false },
      });
      expect(jobs.enqueue).toHaveBeenCalledWith("embedding-batch", { userId: "user-1" });
    });

    it("deletes DocumentChunks and resets embedded when embeddingProvider changes", async () => {
      const existingConfig = {
        userId: "user-1",
        embeddingProvider: "OPENAI",
        embeddingModel: "text-embedding-ada-002",
      };
      (prisma.aiConfig.findUnique as jest.Mock).mockResolvedValue(existingConfig);
      (prisma.aiConfig.upsert as jest.Mock).mockResolvedValue({});
      (prisma.documentChunk.deleteMany as jest.Mock).mockResolvedValue({ count: 2 });
      (prisma.document.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      await service.upsertConfig("user-1", {
        embeddingProvider: "OLLAMA",
      });

      expect(prisma.documentChunk.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-1" } });
      expect(prisma.document.updateMany).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        data: { embedded: false },
      });
      expect(jobs.enqueue).toHaveBeenCalledWith("embedding-batch", { userId: "user-1" });
    });

    it("does not delete chunks when embedding config is unchanged", async () => {
      const existingConfig = {
        userId: "user-1",
        embeddingProvider: "OPENAI",
        embeddingModel: "text-embedding-ada-002",
      };
      (prisma.aiConfig.findUnique as jest.Mock).mockResolvedValue(existingConfig);
      (prisma.aiConfig.upsert as jest.Mock).mockResolvedValue({});

      const result = await service.upsertConfig("user-1", {
        chatModel: "gpt-4o",
      });

      expect(result.chatStreamingConfigChanged).toBe(true);

      expect(prisma.documentChunk.deleteMany).not.toHaveBeenCalled();
      expect(prisma.document.updateMany).not.toHaveBeenCalled();
      expect(jobs.enqueue).not.toHaveBeenCalled();
    });

    it("does not delete chunks on first-time config creation (no existing config)", async () => {
      (prisma.aiConfig.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.aiConfig.upsert as jest.Mock).mockResolvedValue({});

      const result = await service.upsertConfig("user-1", {
        embeddingProvider: "OPENAI",
        embeddingModel: "text-embedding-ada-002",
      });

      expect(result.chatStreamingConfigChanged).toBe(false);

      expect(prisma.documentChunk.deleteMany).not.toHaveBeenCalled();
      expect(prisma.document.updateMany).not.toHaveBeenCalled();
      expect(jobs.enqueue).not.toHaveBeenCalled();
    });

    it("chatStreamingConfigChanged is false when chat fields match existing", async () => {
      const existingConfig = {
        userId: "user-1",
        chatProvider: "OPENAI",
        chatModel: "gpt-4o",
        chatEndpoint: null,
      };
      (prisma.aiConfig.findUnique as jest.Mock).mockResolvedValue(existingConfig);
      (prisma.aiConfig.upsert as jest.Mock).mockResolvedValue({});

      const result = await service.upsertConfig("user-1", {
        chatModel: "gpt-4o",
      });

      expect(result.chatStreamingConfigChanged).toBe(false);
    });
  });

  describe("decryptIfPresent", () => {
    it("decrypts a stored key", () => {
      const encrypted = service.encryptKey("sk-original");
      const result = service.decryptIfPresent(encrypted);
      expect(result).toBe("sk-original");
    });

    it("returns null for null input", () => {
      expect(service.decryptIfPresent(null)).toBeNull();
    });

    it("returns null for undefined input", () => {
      expect(service.decryptIfPresent(undefined)).toBeNull();
    });
  });

  describe("encryptKey", () => {
    it("returns a hex.hex.hex formatted string", () => {
      const result = service.encryptKey("my-secret");
      expect(result).toMatch(/^[0-9a-f]+\.[0-9a-f]+\.[0-9a-f]+$/);
    });

    it("produces different ciphertext on each call (random IV)", () => {
      const first = service.encryptKey("my-secret");
      const second = service.encryptKey("my-secret");
      expect(first).not.toBe(second);
    });

    it("round-trips through decryptIfPresent", () => {
      const encrypted = service.encryptKey("round-trip-value");
      expect(service.decryptIfPresent(encrypted)).toBe("round-trip-value");
    });
  });
});
