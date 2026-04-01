import { Controller, Get, Query, Res } from "@nestjs/common";
import { GrpcMethod, RpcException } from "@nestjs/microservices";
import type { Metadata } from "@grpc/grpc-js";
import { status as GrpcStatus } from "@grpc/grpc-js";
import type { Response } from "express";
import { AuthSessionService } from "../auth/auth-session.service";
import { CalendarService } from "./calendar.service";
import { IcsService } from "./ics.service";

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
    // The OAuth callback is a browser redirect landing page.
    // The Electron app intercepts the redirect URL, extracts code+state,
    // and completes the flow via gRPC (CompleteCalendarOAuth) with auth context.
    // This page just tells the user to return to the app.
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

  // ── gRPC: CalendarService ──

  @GrpcMethod("CalendarService", "GetCalendarStatus")
  async getCalendarStatus(_data: any, metadata: Metadata) {
    const session = await this.authSession.requireSession(metadata);
    return this.calendarService.getStatus(session.userId);
  }

  @GrpcMethod("CalendarService", "StartCalendarOAuth")
  async startCalendarOAuth(data: any, metadata: Metadata) {
    const session = await this.authSession.requireSession(metadata);
    return this.calendarService.startOAuth(session.userId, data.providerId);
  }

  @GrpcMethod("CalendarService", "CompleteCalendarOAuth")
  async completeCalendarOAuth(data: any, metadata: Metadata) {
    const session = await this.authSession.requireSession(metadata);
    const result = await this.calendarService.completeOAuth(data.code, data.state, data.providerId, session.userId);
    return { connection: result };
  }

  @GrpcMethod("CalendarService", "DisconnectCalendar")
  async disconnectCalendar(data: any, metadata: Metadata) {
    const session = await this.authSession.requireSession(metadata);
    await this.calendarService.disconnect(session.userId, data.connectionId);
    return {};
  }

  @GrpcMethod("CalendarService", "ListGoogleCalendars")
  async listCalendars(data: any, metadata: Metadata) {
    const session = await this.authSession.requireSession(metadata);
    const calendars = await this.calendarService.listCalendars(session.userId, data.connectionId);
    return { calendars };
  }

  @GrpcMethod("CalendarService", "SubscribeCalendar")
  async subscribeCalendar(data: any, metadata: Metadata) {
    const session = await this.authSession.requireSession(metadata);
    const subscription = await this.calendarService.subscribe(
      session.userId, data.connectionId, data.calendarId, data.name, data.color || "#7c5cdc",
    );
    return { subscription };
  }

  @GrpcMethod("CalendarService", "UnsubscribeCalendar")
  async unsubscribeCalendar(data: any, metadata: Metadata) {
    const session = await this.authSession.requireSession(metadata);
    await this.calendarService.unsubscribe(session.userId, data.subscriptionId);
    return {};
  }

  @GrpcMethod("CalendarService", "UpdateCalendarSubscription")
  async updateCalendarSubscription(data: any, metadata: Metadata) {
    const session = await this.authSession.requireSession(metadata);
    const subscription = await this.calendarService.updateSubscription(
      session.userId, data.subscriptionId, data.color, data.enabled,
    );
    return { subscription };
  }

  @GrpcMethod("CalendarService", "AddIcsSubscription")
  async addIcsSubscription(data: any, metadata: Metadata) {
    const session = await this.authSession.requireSession(metadata);
    const subscription = await this.icsService.addSubscription(
      session.userId, data.url, data.name, data.color || "#7c5cdc",
    );
    return { subscription };
  }

  @GrpcMethod("CalendarService", "RemoveIcsSubscription")
  async removeIcsSubscription(data: any, metadata: Metadata) {
    const session = await this.authSession.requireSession(metadata);
    await this.icsService.removeSubscription(session.userId, data.id);
    return {};
  }

  @GrpcMethod("CalendarService", "UpdateIcsSubscription")
  async updateIcsSubscription(data: any, metadata: Metadata) {
    const session = await this.authSession.requireSession(metadata);
    const subscription = await this.icsService.updateSubscription(
      session.userId, data.id, data.name, data.color, data.enabled,
    );
    return { subscription };
  }

  @GrpcMethod("CalendarService", "FetchCalendarEvents")
  async fetchCalendarEvents(data: any, metadata: Metadata) {
    const session = await this.authSession.requireSession(metadata);

    if (!data.timeMin || !data.timeMax || isNaN(Date.parse(data.timeMin)) || isNaN(Date.parse(data.timeMax))) {
      throw new RpcException({ code: GrpcStatus.INVALID_ARGUMENT, message: "timeMin and timeMax must be valid ISO 8601 strings." });
    }

    const [providerEvents, icsEvents] = await Promise.all([
      this.calendarService.fetchEvents(session.userId, data.timeMin, data.timeMax),
      this.icsService.fetchEvents(session.userId, data.timeMin, data.timeMax),
    ]);
    return { events: [...providerEvents, ...icsEvents] };
  }

  @GrpcMethod("CalendarService", "CreateCalendarEvent")
  async createCalendarEvent(data: any, metadata: Metadata) {
    const session = await this.authSession.requireSession(metadata);
    const event = await this.calendarService.createEvent(session.userId, data.subscriptionId, {
      title: data.title,
      description: data.description,
      location: data.location,
      startTime: data.startTime,
      endTime: data.endTime,
      allDay: data.allDay ?? false,
    });
    return { event };
  }

  @GrpcMethod("CalendarService", "UpdateCalendarEvent")
  async updateCalendarEvent(data: any, metadata: Metadata) {
    const session = await this.authSession.requireSession(metadata);
    const event = await this.calendarService.updateEvent(session.userId, data.subscriptionId, data.eventId, {
      title: data.title,
      description: data.description,
      location: data.location,
      startTime: data.startTime,
      endTime: data.endTime,
      allDay: data.allDay,
    });
    return { event };
  }

  @GrpcMethod("CalendarService", "DeleteCalendarEvent")
  async deleteCalendarEvent(data: any, metadata: Metadata) {
    const session = await this.authSession.requireSession(metadata);
    await this.calendarService.deleteEvent(session.userId, data.subscriptionId, data.eventId);
    return {};
  }
}
