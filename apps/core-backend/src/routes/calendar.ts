import type { FastifyInstance } from "fastify";

export default async function calendarRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };

  // ── OAuth callback (browser redirect landing — no guard) ──

  fastify.get("/api/calendar/oauth/callback", async (request, reply) => {
    const { code, state } = request.query as { code: string; state: string };

    if (!code || !state) {
      reply.code(400).type("text/html").send(`
        <html><body style="background:#111;color:#fafaf9;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
          <div style="text-align:center">
            <h2>Connection failed</h2>
            <p style="opacity:0.6">Missing authorization parameters.</p>
          </div>
        </body></html>
      `);
      return;
    }

    reply.type("text/html").send(`
      <html><body style="background:#111;color:#fafaf9;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
        <div style="text-align:center">
          <h2>Calendar authorization received!</h2>
          <p style="opacity:0.6">You can close this window and return to Slate.</p>
        </div>
      </body></html>
    `);
  });

  // ── Status ──

  fastify.get("/api/calendar/status", auth, async (request) => {
    return fastify.calendarService.getStatus(request.user!.userId);
  });

  // ── OAuth start ──

  fastify.post("/api/calendar/oauth/start", auth, async (request) => {
    const body = request.body as { providerId: string; redirectUri: string };
    return fastify.calendarService.startOAuth(
      request.user!.userId,
      body.providerId,
      body.redirectUri,
    );
  });

  // ── OAuth complete ──

  fastify.post("/api/calendar/oauth/complete", auth, async (request) => {
    const body = request.body as {
      code: string;
      state: string;
      providerId: string;
      redirectUri: string;
    };
    const result = await fastify.calendarService.completeOAuth(
      body.code,
      body.state,
      body.providerId,
      request.user!.userId,
      body.redirectUri,
    );
    return { connection: result };
  });

  // ── Disconnect ──

  fastify.post("/api/calendar/disconnect", auth, async (request) => {
    const body = request.body as { connectionId: string };
    await fastify.calendarService.disconnect(request.user!.userId, body.connectionId);
    return {};
  });

  // ── List calendars ──

  fastify.get("/api/calendar/calendars", auth, async (request) => {
    const { connectionId } = request.query as { connectionId: string };
    const calendars = await fastify.calendarService.listCalendars(
      request.user!.userId,
      connectionId,
    );
    return { calendars };
  });

  // ── Subscribe ──

  fastify.post("/api/calendar/subscribe", auth, async (request) => {
    const body = request.body as {
      connectionId: string;
      calendarId: string;
      name: string;
      color?: string;
    };
    const subscription = await fastify.calendarService.subscribe(
      request.user!.userId,
      body.connectionId,
      body.calendarId,
      body.name,
      body.color ?? "#7c5cdc",
    );
    return { subscription };
  });

  // ── Unsubscribe ──

  fastify.delete("/api/calendar/subscribe/:subscriptionId", auth, async (request) => {
    const { subscriptionId } = request.params as { subscriptionId: string };
    await fastify.calendarService.unsubscribe(request.user!.userId, subscriptionId);
    return {};
  });

  // ── Update subscription ──

  fastify.patch("/api/calendar/subscribe/:subscriptionId", auth, async (request) => {
    const { subscriptionId } = request.params as { subscriptionId: string };
    const body = request.body as { color?: string; enabled?: boolean };
    const subscription = await fastify.calendarService.updateSubscription(
      request.user!.userId,
      subscriptionId,
      body.color,
      body.enabled,
    );
    return { subscription };
  });

  // ── ICS: add subscription ──

  fastify.post("/api/calendar/ics", auth, async (request) => {
    const body = request.body as { url: string; name: string; color?: string };
    const subscription = await fastify.icsService.addSubscription(
      request.user!.userId,
      body.url,
      body.name,
      body.color ?? "#7c5cdc",
    );
    return { subscription };
  });

  // ── ICS: remove subscription ──

  fastify.delete("/api/calendar/ics/:id", auth, async (request) => {
    const { id } = request.params as { id: string };
    await fastify.icsService.removeSubscription(request.user!.userId, id);
    return {};
  });

  // ── ICS: update subscription ──

  fastify.patch("/api/calendar/ics/:id", auth, async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as { name?: string; color?: string; enabled?: boolean };
    const subscription = await fastify.icsService.updateSubscription(
      request.user!.userId,
      id,
      body.name,
      body.color,
      body.enabled,
    );
    return { subscription };
  });

  // ── Fetch events ──

  fastify.get("/api/calendar/events", auth, async (request) => {
    const { timeMin, timeMax } = request.query as { timeMin: string; timeMax: string };
    const [providerEvents, icsEvents] = await Promise.all([
      fastify.calendarService.fetchEvents(request.user!.userId, timeMin, timeMax),
      fastify.icsService.fetchEvents(request.user!.userId, timeMin, timeMax),
    ]);
    return { events: [...providerEvents, ...icsEvents] };
  });

  fastify.get("/api/calendar/google/attendees/search", auth, async (request) => {
    const { q, subscriptionId } = request.query as { q: string; subscriptionId: string };
    const attendees = await fastify.calendarService.searchAttendees(
      request.user!.userId,
      subscriptionId,
      q,
    );
    return { attendees };
  });

  // ── Create event ──

  fastify.post("/api/calendar/events", auth, async (request) => {
    const body = request.body as {
      subscriptionId: string;
      title: string;
      description?: string;
      location?: string;
      startTime: string;
      endTime: string;
      allDay?: boolean;
      attendees?: { email: string; displayName?: string }[];
    };
    const event = await fastify.calendarService.createEvent(
      request.user!.userId,
      body.subscriptionId,
      {
        title: body.title,
        description: body.description,
        location: body.location,
        startTime: body.startTime,
        endTime: body.endTime,
        allDay: body.allDay ?? false,
        attendees: body.attendees,
      },
    );
    return { event };
  });

  // ── Update event ──

  fastify.patch("/api/calendar/events/:eventId", auth, async (request) => {
    const { eventId } = request.params as { eventId: string };
    const body = request.body as {
      subscriptionId: string;
      title?: string;
      description?: string;
      location?: string;
      startTime?: string;
      endTime?: string;
      allDay?: boolean;
      attendees?: { email: string; displayName?: string }[];
    };
    const event = await fastify.calendarService.updateEvent(
      request.user!.userId,
      body.subscriptionId,
      eventId,
      {
        title: body.title,
        description: body.description,
        location: body.location,
        startTime: body.startTime,
        endTime: body.endTime,
        allDay: body.allDay,
        attendees: body.attendees,
      },
    );
    return { event };
  });

  // ── Delete event ──

  fastify.delete("/api/calendar/events/:eventId", auth, async (request) => {
    const { eventId } = request.params as { eventId: string };
    const { subscriptionId } = request.query as { subscriptionId: string };
    await fastify.calendarService.deleteEvent(request.user!.userId, subscriptionId, eventId);
    return {};
  });

  // ── RSVP ──

  fastify.post("/api/calendar/events/:eventId/rsvp", auth, async (request) => {
    const { eventId } = request.params as { eventId: string };
    const body = request.body as { subscriptionId: string; response: string };
    await fastify.calendarService.rsvpEvent(
      request.user!.userId,
      body.subscriptionId,
      eventId,
      body.response,
    );
    return {};
  });
}
