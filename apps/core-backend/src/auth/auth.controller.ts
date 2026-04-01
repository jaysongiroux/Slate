import { Controller, HttpException, Logger } from "@nestjs/common";
import { GrpcMethod, RpcException } from "@nestjs/microservices";
import { Metadata, status } from "@grpc/grpc-js";
import { AuthService } from "./auth.service";
import { AuthSessionService } from "./auth-session.service";

@Controller()
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly authSessionService: AuthSessionService,
  ) {}

  @GrpcMethod("AuthService", "ListAuthProviders")
  async listAuthProviders() {
    this.logger.log("ListAuthProviders");
    try {
      return await this.authService.listProviders();
    } catch (error) {
      throw this.toRpcException(error, "ListAuthProviders");
    }
  }

  @GrpcMethod("AuthService", "LoginWithPassword")
  async loginWithPassword(payload: {
    email: string;
    password: string;
    totpCode?: string;
    clientId: string;
  }) {
    const email = payload.email?.trim().toLowerCase() ?? "";
    this.logger.log(
      `LoginWithPassword: clientId=${payload.clientId ?? ""} email=${email || "(empty)"} totp=${Boolean(payload.totpCode)}`,
    );
    try {
      const result = await this.authService.loginWithPassword(payload);
      this.logger.log(
        `LoginWithPassword: ok userId=${result.userId} clientId=${payload.clientId ?? ""}`,
      );
      return result;
    } catch (error) {
      throw this.toRpcException(error, "LoginWithPassword");
    }
  }

  @GrpcMethod("AuthService", "RegisterWithPassword")
  async registerWithPassword(payload: {
    email: string;
    password: string;
    displayName: string;
    clientId: string;
  }) {
    const email = payload.email?.trim().toLowerCase() ?? "";
    this.logger.log(
      `RegisterWithPassword: clientId=${payload.clientId ?? ""} email=${email || "(empty)"}`,
    );
    try {
      const result = await this.authService.registerWithPassword(payload);
      this.logger.log(
        `RegisterWithPassword: ok userId=${result.userId} clientId=${payload.clientId ?? ""}`,
      );
      return result;
    } catch (error) {
      throw this.toRpcException(error, "RegisterWithPassword");
    }
  }

  @GrpcMethod("AuthService", "GetCurrentSession")
  async getCurrentSession(_payload: object, metadata: Metadata) {
    const session = await this.authSessionService.requireSession(metadata);
    return this.authService.getCurrentSession(session);
  }

  @GrpcMethod("AuthService", "RefreshTokens")
  async refreshTokens(payload: { refreshToken: string }) {
    const len = payload.refreshToken?.length ?? 0;
    this.logger.log(`RefreshTokens: refreshTokenLength=${len}`);
    try {
      return await this.authService.refreshTokens(payload.refreshToken);
    } catch (error) {
      throw this.toRpcException(error, "RefreshTokens");
    }
  }

  @GrpcMethod("AuthService", "StartOidc")
  async startOidc(payload: {
    providerId: string;
    redirectUri: string;
    clientId?: string;
    isAdmin?: boolean;
  }) {
    const clientId = payload.clientId ?? "";
    this.logger.log(
      `StartOidc: providerId=${payload.providerId} clientId=${clientId} isAdmin=${Boolean(payload.isAdmin)}`,
    );
    try {
      return await this.authService.startOidc(
        payload.providerId,
        payload.redirectUri,
        clientId,
        Boolean(payload.isAdmin),
      );
    } catch (error) {
      throw this.toRpcException(error, "StartOidc");
    }
  }

  @GrpcMethod("AuthService", "CompleteOidc")
  async completeOidc(payload: {
    providerId?: string;
    redirectUri: string;
    state: string;
    code: string;
    clientId?: string;
  }) {
    const stateHint = payload.state?.slice(0, 8) ?? "";
    this.logger.log(
      `CompleteOidc: statePrefix=${stateHint} clientId=${payload.clientId ?? ""} providerId=${payload.providerId ?? ""}`,
    );
    try {
      const result = await this.authService.completeOidc(payload);
      this.logger.log(`CompleteOidc: ok userId=${result.userId}`);
      return result;
    } catch (error) {
      throw this.toRpcException(error, "CompleteOidc");
    }
  }

  private toRpcException(error: unknown, operation: string) {
    if (error instanceof RpcException) {
      return error;
    }

    if (error instanceof HttpException) {
      const grpcCode = this.mapHttpStatusToGrpc(error.getStatus());
      const response = error.getResponse();
      let message = error.message;
      if (typeof response === "string") {
        message = response;
      } else if (response && typeof response === "object" && "message" in response) {
        const extracted = (response as { message?: unknown }).message;
        if (typeof extracted === "string") {
          message = extracted;
        } else if (Array.isArray(extracted) && typeof extracted[0] === "string") {
          message = extracted[0];
        }
      }

      this.logger.warn(`gRPC ${operation} failed (${error.getStatus()}): ${message}`);
      return new RpcException({ code: grpcCode, message });
    }

    const details = error instanceof Error ? (error.stack ?? error.message) : JSON.stringify(error);
    this.logger.error(`gRPC ${operation} failed with unexpected error`, details);
    return new RpcException({ code: status.INTERNAL, message: "Internal server error" });
  }

  private mapHttpStatusToGrpc(httpStatus: number) {
    switch (httpStatus) {
      case 400:
      case 422:
        return status.INVALID_ARGUMENT;
      case 401:
        return status.UNAUTHENTICATED;
      case 403:
        return status.PERMISSION_DENIED;
      case 404:
        return status.NOT_FOUND;
      case 409:
        return status.FAILED_PRECONDITION;
      case 429:
        return status.RESOURCE_EXHAUSTED;
      case 501:
        return status.UNIMPLEMENTED;
      case 503:
        return status.UNAVAILABLE;
      case 504:
        return status.DEADLINE_EXCEEDED;
      default:
        return status.INTERNAL;
    }
  }
}
