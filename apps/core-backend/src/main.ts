import "./config/env";
import { NestFactory } from "@nestjs/core";
import { Transport } from "@nestjs/microservices";
import { Logger } from "nestjs-pino";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { AppModule } from "./app.module";
import { GrpcLoggingInterceptor } from "./common/grpc-logging.interceptor";
import { CollaborationGateway } from "./collaboration/collaboration.gateway";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const grpc = app.connectMicroservice({
    transport: Transport.GRPC,
    options: {
      package: "slate.v1",
      protoPath: join(process.cwd(), "../../packages/proto/slate.proto"),
      url: "0.0.0.0:50051",
    },
  });
  grpc.useGlobalInterceptors(new GrpcLoggingInterceptor());

  await app.startAllMicroservices();

  // Wire WebSocket upgrades on /collaboration to Hocuspocus BEFORE listen
  const logger = app.get(Logger);
  const gateway = app.get(CollaborationGateway);
  const wss = new WebSocketServer({ noServer: true });
  const httpServer = app.getHttpServer();
  httpServer.on("upgrade", (request: any, socket: any, head: any) => {
    logger.log(`[ws-upgrade] url=${request.url}`, "Bootstrap");
    if (request.url?.startsWith("/collaboration")) {
      wss.handleUpgrade(request, socket, head, (ws: any) => {
        logger.log(`[ws-upgrade] handshake complete, passing to Hocuspocus`, "Bootstrap");
        gateway.handleConnection(ws, request);
      });
    } else {
      logger.log(`[ws-upgrade] ignoring non-collaboration path: ${request.url}`, "Bootstrap");
      socket.destroy();
    }
  });

  await app.listen(process.env.PORT ? Number(process.env.PORT) : 4000);
}

void bootstrap();
