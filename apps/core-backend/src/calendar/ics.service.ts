import pino from "pino";
import type { AppConfig } from "../lib/types";
import type { PrismaClient } from "@slate/server-db";
import { badRequest, notFound } from "../lib/errors";
import * as ical from "node-ical";
import {
  decryptCalendarSecret,
  encryptCalendarSecret,
  hashCalendarSecret,
} from "./calendar-crypto.util";

export interface IcsCalendarEvent {
  id: string;
  subscriptionId?: string;
  calendarId: string;
  calendarName?: string;
  source: string;
  title: string;
  description?: string;
  location?: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  color: string;
  htmlLink?: string;
  readOnly: boolean;
}

export class IcsService {
  private readonly logger = pino({ name: "IcsService" });

  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
  ) {}

  private get encryptionKey(): string {
    return this.config.get("CALENDAR_ENCRYPTION_KEY", "local-dev-calendar-secret");
  }

  private encryptUrl(url: string): string {
    return encryptCalendarSecret(url, this.encryptionKey);
  }

  private decryptUrl(urlEncrypted: string): string {
    return decryptCalendarSecret(urlEncrypted, this.encryptionKey);
  }

  private hashUrl(url: string): string {
    return hashCalendarSecret(url);
  }

  private async resolveStoredUrl(subscription: {
    id: string;
    urlEncrypted: string;
    urlHash: string | null;
  }): Promise<string> {
    try {
      const decrypted = this.decryptUrl(subscription.urlEncrypted);
      const nextHash = this.hashUrl(decrypted);
      if (subscription.urlHash !== nextHash) {
        await this.prisma.icsSubscription.update({
          where: { id: subscription.id },
          data: { urlHash: nextHash },
        });
      }
      return decrypted;
    } catch {
      const legacyPlaintextUrl = subscription.urlEncrypted;
      await this.prisma.icsSubscription.update({
        where: { id: subscription.id },
        data: {
          urlEncrypted: this.encryptUrl(legacyPlaintextUrl),
          urlHash: this.hashUrl(legacyPlaintextUrl),
        },
      });
      return legacyPlaintextUrl;
    }
  }

  async addSubscription(userId: string, url: string, name: string, color: string) {
    this.validateIcsUrl(url);

    // Validate the URL is reachable and parseable
    try {
      await this.fetchAndParseIcs(url);
    } catch (error) {
      const cause = error instanceof Error ? ((error as any).cause ?? error.message) : error;
      this.logger.error(`Failed to fetch/parse ICS feed: ${error} | cause: ${cause}`);
      throw badRequest("Could not fetch or parse the ICS feed. Check the URL.");
    }

    const urlHash = this.hashUrl(url);
    const sub = await this.prisma.icsSubscription.upsert({
      where: { userId_urlHash: { userId, urlHash } },
      update: {
        urlEncrypted: this.encryptUrl(url),
        urlHash,
        name,
        color,
        enabled: true,
      },
      create: {
        userId,
        urlEncrypted: this.encryptUrl(url),
        urlHash,
        name,
        color,
        enabled: true,
      },
    });

    return { id: sub.id, url, name: sub.name, color: sub.color, enabled: sub.enabled };
  }

  async removeSubscription(userId: string, id: string) {
    const sub = await this.prisma.icsSubscription.findFirst({ where: { id, userId } });
    if (!sub) throw notFound("ICS subscription not found.");
    await this.prisma.icsSubscription.delete({ where: { id } });
  }

  async updateSubscription(
    userId: string,
    id: string,
    name?: string,
    color?: string,
    enabled?: boolean,
  ) {
    const sub = await this.prisma.icsSubscription.findFirst({ where: { id, userId } });
    if (!sub) throw notFound("ICS subscription not found.");

    const updated = await this.prisma.icsSubscription.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(color !== undefined ? { color } : {}),
        ...(enabled !== undefined ? { enabled } : {}),
      },
    });

    return {
      id: updated.id,
      url: await this.resolveStoredUrl(updated),
      name: updated.name,
      color: updated.color,
      enabled: updated.enabled,
    };
  }

  async fetchEvents(userId: string, timeMin: string, timeMax: string) {
    const subscriptions = await this.prisma.icsSubscription.findMany({
      where: { userId, enabled: true },
    });

    const events: IcsCalendarEvent[] = [];
    const minDate = new Date(timeMin);
    const maxDate = new Date(timeMax);

    for (const sub of subscriptions) {
      try {
        const url = await this.resolveStoredUrl(sub);
        const parsed = await this.fetchAndParseIcs(url);
        for (const [, component] of Object.entries(parsed)) {
          if (!component || component.type !== "VEVENT") continue;
          const vevent = component as ical.VEvent;

          const start: Date | null =
            vevent.start instanceof Date
              ? vevent.start
              : vevent.start
                ? new Date(String(vevent.start))
                : null;
          const end: Date | null =
            vevent.end instanceof Date
              ? vevent.end
              : vevent.end
                ? new Date(String(vevent.end))
                : null;
          if (!start) continue;

          // Filter by date range
          const eventEnd = end ?? start;
          if (eventEnd < minDate || start > maxDate) continue;

          const allDay = vevent.datetype === "date";

          events.push({
            id: vevent.uid ?? `ics-${sub.id}-${start.toISOString()}`,
            subscriptionId: sub.id,
            calendarId: sub.id,
            calendarName: sub.name,
            source: "ics",
            title:
              (typeof vevent.summary === "string" ? vevent.summary : vevent.summary?.val) ??
              "Untitled",
            description:
              (typeof vevent.description === "string"
                ? vevent.description
                : vevent.description?.val) ?? undefined,
            location:
              (typeof vevent.location === "string" ? vevent.location : vevent.location?.val) ??
              undefined,
            startTime: start.toISOString(),
            endTime: eventEnd.toISOString(),
            allDay,
            color: sub.color,
            htmlLink: undefined,
            readOnly: true,
          });
        }
      } catch (error) {
        this.logger.warn(`Failed to fetch ICS feed ${sub.id}: ${error}`);
      }
    }

    return events;
  }

  private validateIcsUrl(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw badRequest("Invalid URL format.");
    }

    // Only allow http/https schemes
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw badRequest("Only HTTP and HTTPS URLs are supported.");
    }

    // Block private/loopback IPs to prevent SSRF
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname.startsWith("10.") ||
      hostname.startsWith("172.") ||
      hostname.startsWith("192.168.") ||
      hostname === "169.254.169.254" ||
      hostname.endsWith(".local")
    ) {
      throw badRequest("Private or loopback URLs are not allowed.");
    }
  }

  private async fetchAndParseIcs(url: string): Promise<ical.CalendarResponse> {
    return ical.async.fromURL(url);
  }
}
