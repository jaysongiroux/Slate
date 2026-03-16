import { Injectable, Logger } from "@nestjs/common";

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  async enqueue(queue: string, payload: Record<string, unknown>) {
    this.logger.debug(`queued ${queue}: ${JSON.stringify(payload)}`);
  }
}

