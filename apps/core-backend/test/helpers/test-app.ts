import { INestApplication } from "@nestjs/common";
import { AppConfigName } from "@slate/server-db";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/prisma/prisma.service";

function ensureSafeTestDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required for tests and must point to a dedicated test database (for example: .../slate_test?schema=public)",
    );
  }

  let dbName = "";
  try {
    dbName = new URL(databaseUrl).pathname.replace(/^\//, "").split("/").filter(Boolean).pop() ?? "";
  } catch {
    throw new Error(
      "DATABASE_URL is invalid. Set it to a dedicated test database (for example: postgresql://.../slate_test?schema=public)",
    );
  }

  if (!dbName.toLowerCase().includes("test")) {
    throw new Error(
      `Refusing to run tests against non-test database '${dbName || "unknown"}'. Set DATABASE_URL to a dedicated test DB (for example: .../slate_test?schema=public).`,
    );
  }
}

export async function createTestApp() {
  ensureSafeTestDatabaseUrl();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule]
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();

  const prisma = app.get(PrismaService);
  return { app, prisma };
}

export async function resetDatabase(app: INestApplication) {
  const prisma = app.get(PrismaService);
  await prisma.appConfig.deleteMany();
  await prisma.oidcAuthRequest.deleteMany();
  await prisma.oidcProviderConfig.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.document.deleteMany();
  await prisma.clientBinding.deleteMany();
  await prisma.workspaceMember.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.totpEnrollment.deleteMany();
  await prisma.authIdentity.deleteMany();
  await prisma.user.deleteMany();
  await prisma.appConfig.create({
    data: {
      name: AppConfigName.ACCOUNT_CREATION_ENABLED,
      value: "true",
    },
  });
  await prisma.appConfig.create({
    data: {
      name: AppConfigName.PASSWORD_AUTH_ENABLED,
      value: "true",
    },
  });
}
