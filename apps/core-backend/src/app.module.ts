import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";
import { resolve } from "node:path";
import { AiModule } from "./ai/ai.module";
import { CalendarModule } from "./calendar/calendar.module";
import { CollaborationModule } from "./collaboration/collaboration.module";
import { AttachmentsModule } from "./attachments/attachments.module";
import { AuthModule } from "./auth/auth.module";
import { DocumentsModule } from "./documents/documents.module";
import { InternalAdminModule } from "./internal-admin/internal-admin.module";
import { JobsModule } from "./jobs/jobs.module";
import { NotesModule } from "./notes/notes.module";
import { PrismaModule } from "./prisma/prisma.module";
import { SearchModule } from "./search/search.module";
import { SettingsModule } from "./settings/settings.module";
import { StorageModule } from "./storage/storage.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        resolve(process.cwd(), ".env"),
        resolve(process.cwd(), "apps/core-backend/.env"),
        resolve(__dirname, "../.env"),
      ],
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV !== "production"
            ? { target: "pino-pretty", options: { colorize: true } }
            : undefined,
        level: process.env.LOG_LEVEL ?? "info",
        autoLogging: false,
      },
    }),
    PrismaModule,
    SettingsModule,
    JobsModule,
    AuthModule,
    InternalAdminModule,
    DocumentsModule,
    StorageModule,
    AttachmentsModule,
    SearchModule,
    AiModule,
    CalendarModule,
    CollaborationModule,
    NotesModule,
  ],
})
export class AppModule {}
