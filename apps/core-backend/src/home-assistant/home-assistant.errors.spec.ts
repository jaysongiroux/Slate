import { formatHomeAssistantError, HomeAssistantUpstreamError } from "./home-assistant.errors";

describe("formatHomeAssistantError", () => {
  it("formats auth failures without leaking upstream payloads", () => {
    const result = formatHomeAssistantError({ status: 401, body: "bad token" });
    expect(result).toEqual({
      code: "home_assistant_auth_failed",
      message:
        "Home Assistant rejected this token. Check the long-lived access token and try again.",
    });
  });

  it("formats forbidden auth failures the same way", () => {
    const result = formatHomeAssistantError({ statusCode: 403, body: "bad token" });
    expect(result).toEqual({
      code: "home_assistant_auth_failed",
      message:
        "Home Assistant rejected this token. Check the long-lived access token and try again.",
    });
  });

  it("formats unreachable network failures", () => {
    const result = formatHomeAssistantError(new TypeError("fetch failed"));
    expect(result).toEqual({
      code: "home_assistant_unreachable",
      message: "Could not reach this Home Assistant instance. Check the URL and network.",
    });
  });

  it("formats plain object network failures from message fields", () => {
    const result = formatHomeAssistantError({ message: "ECONNREFUSED" });
    expect(result).toEqual({
      code: "home_assistant_unreachable",
      message: "Could not reach this Home Assistant instance. Check the URL and network.",
    });
  });

  it.each(["ECONNRESET", "socket hang up", "Failed to fetch"])(
    "formats %s as an unreachable network failure",
    (message) => {
      const result = formatHomeAssistantError(new Error(message));
      expect(result).toEqual({
        code: "home_assistant_unreachable",
        message: "Could not reach this Home Assistant instance. Check the URL and network.",
      });
    },
  );

  it("formats not found errors", () => {
    const result = formatHomeAssistantError(new HomeAssistantUpstreamError(404, "missing"));
    expect(result).toEqual({
      code: "home_assistant_not_found",
      message: "This Home Assistant resource was not found.",
    });
  });

  it("formats unsupported control errors", () => {
    const result = formatHomeAssistantError(new Error("unsupported_control"));
    expect(result).toEqual({
      code: "home_assistant_unsupported_control",
      message: "Slate does not support controls for this entity yet.",
    });
  });

  it("formats websocket unavailable errors", () => {
    const result = formatHomeAssistantError(new Error("websocket_unavailable"));
    expect(result).toEqual({
      code: "home_assistant_websocket_unavailable",
      message: "Live updates are unavailable. Showing the latest refreshable state.",
    });
  });

  it("formats generic service failures", () => {
    const result = formatHomeAssistantError(new Error("something else"));
    expect(result).toEqual({
      code: "home_assistant_service_failed",
      message: "Home Assistant could not run that action.",
    });
  });
});
