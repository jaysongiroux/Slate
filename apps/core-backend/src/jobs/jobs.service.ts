import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import PgBoss from "pg-boss";

@Injectable()
export class JobsService implements OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private boss: PgBoss;
  private started: Promise<void> | null = null;

  constructor(private readonly config: ConfigService) {
    const databaseUrl = this.config.get<string>(
      "DATABASE_URL",
      "postgresql://slate:slate@localhost:5432/slate",
    );
    this.boss = new PgBoss(databaseUrl);
    this.boss.on("error", (error) => {
      this.logger.error(`pg-boss error: ${error.message}`);
    });
  }

  private ensureStarted(): Promise<void> {
    if (!this.started) {
      this.started = this.boss.start().then(() => {
        this.logger.log("pg-boss started");
      });
    }
    return this.started;
  }

  async onModuleDestroy() {
    if (this.started) {
      await this.started;
      await this.boss.stop({ graceful: true, timeout: 10_000 });
      this.logger.log("pg-boss stopped");
    }
  }

  async enqueue(
    queue: string,
    payload: Record<string, unknown>,
    options?: PgBoss.SendOptions,
  ): Promise<string | null> {
    await this.ensureStarted();
    await this.boss.createQueue(queue);
    const id = await this.boss.send(queue, payload, options as PgBoss.SendOptions);
    this.logger.debug(`Enqueued ${queue}: ${JSON.stringify(payload)}`);
    return id;
  }

  async registerWorker(
    queue: string,
    handler: (job: PgBoss.Job<any>) => Promise<void>,
    options?: PgBoss.WorkOptions,
  ) {
    await this.ensureStarted();
    const batchHandler: PgBoss.WorkHandler<any> = async (jobs) => {
      for (const job of jobs) {
        await handler(job);
      }
    };
    if (options) {
      await this.boss.work(queue, options, batchHandler);
    } else {
      await this.boss.work(queue, batchHandler);
    }
    this.logger.log(`Registered worker for queue: ${queue}`);
  }

  async schedule(queue: string, cron: string, payload?: object) {
    await this.ensureStarted();
    await this.boss.createQueue(queue);
    await this.boss.schedule(queue, cron, payload ?? {});
    this.logger.log(`Scheduled ${queue} with cron: ${cron}`);
  }
}
