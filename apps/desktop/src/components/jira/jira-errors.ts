/**
 * Extract a human-readable error message from a Jira API error.
 *
 * The HTTP client wraps errors with technical details like
 * `PUT /api/jira/instances/... failed (400): {"error":"..."}`.
 * This helper digs out the actual message.
 */
export function formatJiraError(err: unknown, fallback = "Something went wrong."): string {
  if (!err) return fallback;

  // The http-client attaches `.body` (parsed JSON) to errors
  const anyErr = err as any;
  const body = anyErr?.body;

  if (body && typeof body === "object") {
    // Backend returns { error: "human message" }
    if (typeof body.error === "string" && body.error) {
      return humanize(body.error);
    }
    // Or { message: "..." }
    if (typeof body.message === "string" && body.message) {
      return humanize(body.message);
    }
    // jira.js errors: { errorMessages: ["..."] }
    if (Array.isArray(body.errorMessages) && body.errorMessages.length > 0) {
      return humanize(body.errorMessages[0]);
    }
  }

  // Fall back to Error.message, but clean it up
  if (err instanceof Error && err.message) {
    return humanize(err.message);
  }

  return fallback;
}

/** Strip technical prefixes like "PUT /api/... failed (400): " */
function humanize(msg: string): string {
  // Match patterns like "GET /api/... failed: 400 ..." or "PUT /api/... failed (400): ..."
  const prefixMatch = msg.match(
    /^(?:GET|POST|PUT|PATCH|DELETE)\s+\/\S+\s+failed(?:\s*\(\d+\))?:?\s*/i,
  );
  if (prefixMatch) {
    msg = msg.slice(prefixMatch[0].length);
  }

  // If what remains looks like raw JSON, try to parse it
  if (msg.startsWith("{") || msg.startsWith("[")) {
    try {
      const parsed = JSON.parse(msg);
      if (typeof parsed === "object" && parsed !== null) {
        if (typeof parsed.error === "string") return parsed.error;
        if (typeof parsed.message === "string") return parsed.message;
        if (Array.isArray(parsed.errorMessages) && parsed.errorMessages[0]) {
          return parsed.errorMessages[0];
        }
      }
    } catch {
      // not JSON, use as-is
    }
  }

  // Clean up "Request failed with status code 401" → "Invalid credentials (401)"
  const statusMatch = msg.match(/^Request failed with status code (\d+)$/);
  if (statusMatch) {
    const code = statusMatch[1];
    if (code === "401") return "Invalid credentials. Check your email and API token.";
    if (code === "403") return "Insufficient permissions for this Jira instance.";
    if (code === "404") return "Jira API not found at this URL. Check the address.";
    return `Request failed (${code}).`;
  }

  return msg;
}
