import { Controller } from "@nestjs/common";
import { GrpcMethod } from "@nestjs/microservices";
import { Metadata } from "@grpc/grpc-js";
import { AuthSessionService } from "../auth/auth-session.service";
import { SearchService } from "./search.service";

@Controller()
export class SearchController {
  constructor(
    private readonly searchService: SearchService,
    private readonly authSessionService: AuthSessionService,
  ) {}

  @GrpcMethod("SearchService", "SearchDocuments")
  async searchDocuments(payload: { query: string; limit?: number }, metadata: Metadata) {
    const principal = await this.authSessionService.requireSession(metadata);
    return this.searchService.search(principal.userId, payload.query, payload.limit ?? 20);
  }
}
