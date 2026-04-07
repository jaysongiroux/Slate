import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import type { Response } from "express";
import { AuthSessionService } from "../auth/auth-session.service";
import { CalendarService } from "./calendar.service";
import { IcsService } from "./ics.service";
import { HttpAuthGuard } from "../auth/http-auth.guard";
import { CurrentUser } from "../auth/current-user.decorator";

@Controller()
export class CalendarController {
  constructor(
    private readonly calendarService: CalendarService,
    private readonly icsService: IcsService,
    private readonly authSession: AuthSessionService,
  ) {}

  // ── HTTP: OAuth callback (browser redirect landing) ──

  @Get("api/calendar/oauth/callback")
  async oauthCallback(
    @Query("code") code: string,
    @Query("state") state: string,
    @Res() res: Response,
  ) {
    if (!code || !state) {
      res.status(400).send(`
        <html><body style="background:#111;color:#fafaf9;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
          <div style="text-align:center">
            <h2>Connection failed</h2>
            <p style="opacity:0.6">Missing authorization parameters.</p>
          </div>
        </body></html>
      `);
      return;
    }

    res.send(`
      <html><body style="background:#111;color:#fafaf9;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
        <div style="text-align:center">
          <h2>Calendar authorization received!</h2>
          <p style="opacity:0.6">You can close this window and return to Slate.</p>
        </div>
      </body></html>
    `);
  }

  // ── REST: Calendar ──

  @Get("api/calendar/status")
  @UseGuards(HttpAuthGuard)
  async getCalendarStatusHttp(@CurrentUser() user: { userId: string }) {
    return this.calendarService.getStatus(user.userId);
  }

  @Post("api/calendar/oauth/start")
  @UseGuards(HttpAuthGuard)
  @HttpCode(HttpStatus.OK)
  async startCalendarOAuthHttp(
    @Body() body: { providerId: string; redirectUri: string },
    @CurrentUser() user: { userId: string },
  ) {
    return this.calendarService.startOAuth(user.userId, body.providerId, body.redirectUri);
  }

  @Post("api/calendar/oauth/complete")
  @UseGuards(HttpAuthGuard)
  @HttpCode(HttpStatus.OK)
  async completeCalendarOAuthHttp(
    @Body() body: { code: string; state: string; providerId: string; redirectUri: string },
    @CurrentUser() user: { userId: string },
  ) {
    const result = await this.calendarService.completeOAuth(
      body.code,
      body.state,
      body.providerId,
      user.userId,
      body.redirectUri,
    );
    return { connection: result };
  }

  @Post("api/calendar/disconnect")
  @UseGuards(HttpAuthGuard)
  @HttpCode(HttpStatus.OK)
  async disconnectCalendarHttp(
    @Body() body: { connectionId: string },
    @CurrentUser() user: { userId: string },
  ) {
    await this.calendarService.disconnect(user.userId, body.connectionId);
    return {};
  }

  @Get("api/calendar/calendars")
  @UseGuards(HttpAuthGuard)
  async listCalendarsHttp(
    @Query("connectionId") connectionId: string,
    @CurrentUser() user: { userId: string },
  ) {
    const calendars = await this.calendarService.listCalendars(user.userId, connectionId);
    return { calendars };
  }

  @Post("api/calendar/subscribe")
  @UseGuards(HttpAuthGuard)
  @HttpCode(HttpStatus.OK)
  async subscribeCalendarHttp(
    @Body() body: { connectionId: string; calendarId: string; name: string; color?: string },
    @CurrentUser() user: { userId: string },
  ) {
    const subscription = await this.calendarService.subscribe(
      user.userId,
      body.connectionId,
      body.calendarId,
      body.name,
      body.color ?? "#7c5cdc",
    );
    return { subscription };
  }

  @Delete("api/calendar/subscribe/:subscriptionId")
  @UseGuards(HttpAuthGuard)
  async unsubscribeCalendarHttp(
    @Param("subscriptionId") subscriptionId: string,
    @CurrentUser() user: { userId: string },
  ) {
    await this.calendarService.unsubscribe(user.userId, subscriptionId);
    return {};
  }

  @Patch("api/calendar/subscribe/:subscriptionId")
  @UseGuards(HttpAuthGuard)
  async updateCalendarSubscriptionHttp(
    @Param("subscriptionId") subscriptionId: string,
    @Body() body: { color?: string; enabled?: boolean },
    @CurrentUser() user: { userId: string },
  ) {
    const subscription = await this.calendarService.updateSubscription(
      user.userId,
      subscriptionId,
      body.color,
      body.enabled,
    );
    return { subscription };
  }

  @Post("api/calendar/ics")
  @UseGuards(HttpAuthGuard)
  @HttpCode(HttpStatus.OK)
  async addIcsSubscriptionHttp(
    @Body() body: { url: string; name: string; color?: string },
    @CurrentUser() user: { userId: string },
  ) {
    const subscription = await this.icsService.addSubscription(
      user.userId,
      body.url,
      body.name,
      body.color ?? "#7c5cdc",
    );
    return { subscription };
  }

  @Delete("api/calendar/ics/:id")
  @UseGuards(HttpAuthGuard)
  async removeIcsSubscriptionHttp(
    @Param("id") id: string,
    @CurrentUser() user: { userId: string },
  ) {
    await this.icsService.removeSubscription(user.userId, id);
    return {};
  }

  @Patch("api/calendar/ics/:id")
  @UseGuards(HttpAuthGuard)
  async updateIcsSubscriptionHttp(
    @Param("id") id: string,
    @Body() body: { name?: string; color?: string; enabled?: boolean },
    @CurrentUser() user: { userId: string },
  ) {
    const subscription = await this.icsService.updateSubscription(
      user.userId,
      id,
      body.name,
      body.color,
      body.enabled,
    );
    return { subscription };
  }

  @Get("api/calendar/events")
  @UseGuards(HttpAuthGuard)
  async fetchCalendarEventsHttp(
    @Query("timeMin") timeMin: string,
    @Query("timeMax") timeMax: string,
    @CurrentUser() user: { userId: string },
  ) {
    const [providerEvents, icsEvents] = await Promise.all([
      this.calendarService.fetchEvents(user.userId, timeMin, timeMax),
      this.icsService.fetchEvents(user.userId, timeMin, timeMax),
    ]);
    return { events: [...providerEvents, ...icsEvents] };
  }

  @Post("api/calendar/events")
  @UseGuards(HttpAuthGuard)
  @HttpCode(HttpStatus.OK)
  async createCalendarEventHttp(
    @Body()
    body: {
      subscriptionId: string;
      title: string;
      description?: string;
      location?: string;
      startTime: string;
      endTime: string;
      allDay?: boolean;
    },
    @CurrentUser() user: { userId: string },
  ) {
    const event = await this.calendarService.createEvent(user.userId, body.subscriptionId, {
      title: body.title,
      description: body.description,
      location: body.location,
      startTime: body.startTime,
      endTime: body.endTime,
      allDay: body.allDay ?? false,
    });
    return { event };
  }

  @Patch("api/calendar/events/:eventId")
  @UseGuards(HttpAuthGuard)
  async updateCalendarEventHttp(
    @Param("eventId") eventId: string,
    @Body()
    body: {
      subscriptionId: string;
      title?: string;
      description?: string;
      location?: string;
      startTime?: string;
      endTime?: string;
      allDay?: boolean;
    },
    @CurrentUser() user: { userId: string },
  ) {
    const event = await this.calendarService.updateEvent(
      user.userId,
      body.subscriptionId,
      eventId,
      {
        title: body.title,
        description: body.description,
        location: body.location,
        startTime: body.startTime,
        endTime: body.endTime,
        allDay: body.allDay,
      },
    );
    return { event };
  }

  @Delete("api/calendar/events/:eventId")
  @UseGuards(HttpAuthGuard)
  async deleteCalendarEventHttp(
    @Param("eventId") eventId: string,
    @Query("subscriptionId") subscriptionId: string,
    @CurrentUser() user: { userId: string },
  ) {
    await this.calendarService.deleteEvent(user.userId, subscriptionId, eventId);
    return {};
  }

  @Post("api/calendar/events/:eventId/rsvp")
  @UseGuards(HttpAuthGuard)
  @HttpCode(HttpStatus.OK)
  async rsvpCalendarEventHttp(
    @Param("eventId") eventId: string,
    @Body() body: { subscriptionId: string; response: string },
    @CurrentUser() user: { userId: string },
  ) {
    await this.calendarService.rsvpEvent(user.userId, body.subscriptionId, eventId, body.response);
    return {};
  }
}
