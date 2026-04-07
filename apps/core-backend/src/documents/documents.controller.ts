import { Controller } from "@nestjs/common";

// Document sync is handled by Hocuspocus WebSocket (collaboration module).
// gRPC endpoints removed as part of the REST migration.
@Controller()
export class DocumentsController {}
