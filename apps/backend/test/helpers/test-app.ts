import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/prisma/prisma.service";

export async function createTestApp() {
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
  await prisma.attachment.deleteMany();
  await prisma.document.deleteMany();
  await prisma.clientBinding.deleteMany();
  await prisma.workspaceMember.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.totpEnrollment.deleteMany();
  await prisma.authIdentity.deleteMany();
  await prisma.user.deleteMany();
}

