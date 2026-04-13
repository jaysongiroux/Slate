import PgBoss from "pg-boss";
import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "../lib/types";

export class JobsService {
  private boss: PgBoss;
  private started: Promise<void> | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly log: FastifyBaseLogger,
  ) {
    const databaseUrl = this.config.get(
      "DATABASE_URL",
      "postgresql://slate:slate@localhost:5435/slate",
    );
    this.boss = new PgBoss(databaseUrl);
    this.boss.on("error", (error) => {
      this.log.error({ err: error }, "pg-boss error");
    });
  }

  private ensureStarted(): Promise<void> {
    if (!this.started) {
      this.started = this.boss.start().then(() => {
        this.log.info("pg-boss started");
      });
    }
    return this.started;
  }

  async destroy() {
    if (this.started) {
      await this.started;
      await this.boss.stop({ graceful: true, timeout: 10_000 });
      this.log.info("pg-boss stopped");
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
    this.log.debug({ queue, payload }, "pg-boss: enqueued job");
    return id;
  }

  async registerWorker(
    queue: string,
    handler: (job: PgBoss.Job<any>) => Promise<void>,
    options?: PgBoss.WorkOptions,
  ) {
    await this.ensureStarted();
    const batchHandler: PgBoss.WorkHandler<any> = async (jobs) => {
      if (jobs.length > 0) {
        this.log.info(
          {
            queue,
            jobCount: jobs.length,
            jobIds: jobs.map((j) => (j.id != null ? String(j.id) : "?")),
          },
          "pg-boss: worker received batch (handler will run)",
        );
      }
      for (const job of jobs) {
        await handler(job);
      }
    };
    if (options) {
      await this.boss.work(queue, options, batchHandler);
    } else {
      await this.boss.work(queue, batchHandler);
    }
    this.log.info({ queue }, "pg-boss: registered worker");
  }

  async schedule(queue: string, cron: string, payload?: object) {
    await this.ensureStarted();
    await this.boss.createQueue(queue);
    await this.boss.schedule(queue, cron, payload ?? {});
    this.log.info({ queue, cron }, "pg-boss: scheduled queue");
  }
}
