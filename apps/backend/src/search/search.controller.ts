import { Controller } from "@nestjs/common";
import { GrpcMethod } from "@nestjs/microservices";
import { SearchService } from "./search.service";

@Controller()
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @GrpcMethod("SearchService", "SearchDocuments")
  searchDocuments(payload: { workspaceId: string; query: string; limit?: number }) {
    return this.searchService.search(payload.workspaceId, payload.query, payload.limit ?? 20);
  }
}

