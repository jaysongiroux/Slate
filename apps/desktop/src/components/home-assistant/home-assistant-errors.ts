import type { HomeAssistantError } from "@slate/shared";

function isHomeAssistantError(value: unknown): value is HomeAssistantError {
  return (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof (value as { message?: unknown }).message === "string"
  );
}

export function formatHomeAssistantUiError(
  error: unknown,
  fallback = "Home Assistant action failed.",
) {
  if (isHomeAssistantError(error)) return error.message;
  if (error instanceof Error) {
    const body = (error as Error & { body?: unknown }).body;
    if (isHomeAssistantError(body)) return body.message;
    if (body && typeof body === "object" && "error" in body) {
      const coreError = (body as { error?: unknown }).error;
      if (typeof coreError === "string" && coreError.trim()) return coreError;
      if (isHomeAssistantError(coreError)) return coreError.message;
    }
    return error.message || fallback;
  }
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}
