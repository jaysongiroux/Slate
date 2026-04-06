import { Module } from "@nestjs/common";
import { CollaborationGateway } from "./collaboration.gateway";
import { CollaborationService } from "./collaboration.service";
import { AuthModule } from "../auth/auth.module";

@Module({
  imports: [AuthModule],
  providers: [CollaborationGateway, CollaborationService],
  exports: [CollaborationGateway],
})
export class CollaborationModule {}
