import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Observable, tap } from "rxjs";

@Injectable()
export class GrpcLoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const handler = context.getHandler().name;
    const service = context.getClass().name;
    const data = context.switchToRpc().getData();

    const start = Date.now();
    const summary = this.summarize(data);

    console.log(`[gRPC] → ${service}.${handler}${summary}`);

    return next.handle().pipe(
      tap({
        next: () => {
          const ms = Date.now() - start;
          console.log(`[gRPC] ✓ ${service}.${handler} ${ms}ms`);
        },
        error: (err: unknown) => {
          const ms = Date.now() - start;
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[gRPC] ✗ ${service}.${handler} ${ms}ms — ${message}`);
        },
      }),
    );
  }

  private summarize(data: unknown): string {
    if (!data || typeof data !== "object") return "";

    const entries = Object.entries(data as Record<string, unknown>).filter(
      ([, v]) =>
        v !== undefined &&
        v !== null &&
        v !== "" &&
        !(v instanceof Uint8Array),
    );

    if (entries.length === 0) return "";

    const parts = entries.map(([k, v]) => {
      if (typeof v === "string" && v.length > 60) {
        return `${k}="${v.slice(0, 60)}…"`;
      }
      return `${k}=${JSON.stringify(v)}`;
    });

    return ` (${parts.join(", ")})`;
  }
}
