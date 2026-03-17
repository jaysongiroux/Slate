import "./config/env";
import { NestFactory } from "@nestjs/core";
import { Transport } from "@nestjs/microservices";
import { join } from "node:path";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.connectMicroservice({
    transport: Transport.GRPC,
    options: {
      package: "slate.v1",
      protoPath: join(process.cwd(), "../../packages/proto/slate.proto"),
      url: "0.0.0.0:50051"
    }
  });

  await app.startAllMicroservices();
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 4000);
}

void bootstrap();
