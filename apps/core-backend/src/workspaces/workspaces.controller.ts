import { Controller } from "@nestjs/common";
import { GrpcMethod } from "@nestjs/microservices";
import { WorkspacesService } from "./workspaces.service";

@Controller()
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @GrpcMethod("WorkspaceService", "BootstrapWorkspace")
  bootstrapWorkspace(payload: { userId: string; displayName: string }) {
    return this.workspacesService.bootstrapWorkspace(payload.userId, payload.displayName);
  }

  @GrpcMethod("WorkspaceService", "ResolveDevSession")
  resolveDevSession(payload: { clientId: string; deviceName: string }) {
    return this.workspacesService.resolveDevSession(payload.clientId, payload.deviceName);
  }
}
