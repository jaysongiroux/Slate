import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { Hocuspocus } from "@hocuspocus/server";
import { CollaborationService } from "./collaboration.service";
import { AuthSessionService } from "../auth/auth-session.service";
import { IncomingMessage } from "http";

@Injectable()
export class CollaborationGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CollaborationGateway.name);
  private hocuspocus!: Hocuspocus;

  constructor(
    private readonly collaborationService: CollaborationService,
    private readonly authSessionService: AuthSessionService,
  ) {}

  onModuleInit() {
    const gateway = this;

    this.hocuspocus = new Hocuspocus({
      name: "slate-collaboration",
      timeout: 30000,
      debounce: 2000,
      maxDebounce: 10000,

      async onAuthenticate(data) {
        const token = data.token;
        gateway.logger.log(
          `[auth] token present: ${!!token}, length: ${token?.length ?? 0}`,
        );
        if (!token) {
          throw new Error("No authentication token provided");
        }
        try {
          const session =
            await gateway.authSessionService.validateAccessToken(token);
          gateway.logger.log(
            `[auth] authenticated userId=${session.userId}`,
          );
          return { userId: session.userId };
        } catch (err) {
          gateway.logger.error(`[auth] failed: ${err}`);
          throw err;
        }
      },

      async onLoadDocument(data) {
        const context = data.context as { userId: string };
        gateway.logger.log(
          `[load] doc=${data.documentName} userId=${context.userId}`,
        );
        await gateway.collaborationService.handleLoadDocument(
          data.document,
          data.documentName,
          context.userId,
        );
        gateway.logger.log(
          `[load] complete doc=${data.documentName} size=${data.document.share.size}`,
        );
      },

      async onStoreDocument(data) {
        const context = data.context as { userId: string };
        const path =
          (data.document.getMap("meta").get("path") as string) ||
          data.documentName;
        gateway.logger.log(
          `[store] doc=${data.documentName} userId=${context.userId} path=${path}`,
        );
        try {
          await gateway.collaborationService.handleStoreDocument(
            data.document,
            data.documentName,
            context.userId,
            path,
          );
          gateway.logger.log(`[store] complete doc=${data.documentName}`);
        } catch (err) {
          gateway.logger.error(
            `[store] failed doc=${data.documentName}: ${err}`,
          );
          throw err;
        }
      },

      async onConnect(data) {
        gateway.logger.log(
          `[connect] doc=${data.documentName} clients=${data.instance.getConnectionsCount()}`,
        );
      },

      async onDisconnect(data) {
        gateway.logger.log(
          `[disconnect] doc=${data.documentName} clients=${data.instance.getConnectionsCount()}`,
        );
      },
    });

    this.logger.log("Hocuspocus collaboration server configured");
  }

  async onModuleDestroy() {
    if (this.hocuspocus) {
      await this.hocuspocus.closeConnections();
    }
  }

  handleConnection(connection: any, request: IncomingMessage) {
    this.hocuspocus.handleConnection(connection, request);
  }
}
