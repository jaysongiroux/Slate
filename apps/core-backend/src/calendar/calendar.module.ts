import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SettingsModule } from "../settings/settings.module";
import { CalendarController } from "./calendar.controller";
import { CalendarService } from "./calendar.service";
import { GoogleCalendarProvider } from "./google-calendar.provider";
import { IcsService } from "./ics.service";

@Module({
  imports: [AuthModule, SettingsModule],
  controllers: [CalendarController],
  providers: [CalendarService, GoogleCalendarProvider, IcsService],
  exports: [CalendarService, IcsService],
})
export class CalendarModule {}
