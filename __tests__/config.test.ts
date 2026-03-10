import { describe, expect, it, vi } from "vitest";
import { resolveEightK4Config } from "../src/config";

function createRuntime(settings: Record<string, unknown>) {
  return {
    getSetting: (key: string) => settings[key],
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  } as any;
}

describe("resolveEightK4Config", () => {
  it("derives fail mode from guard mode when unset", () => {
    const warnRuntime = createRuntime({ EIGHTK4_GUARD_MODE: "warn" });
    const blockRuntime = createRuntime({ EIGHTK4_GUARD_MODE: "block" });

    expect(resolveEightK4Config(warnRuntime).guardFailMode).toBe("open");
    expect(resolveEightK4Config(blockRuntime).guardFailMode).toBe("closed");
  });

  it("rejects insecure API bases and falls back to the default host", () => {
    const runtime = createRuntime({ EIGHTK4_API_BASE: "http://evil.example" });
    const config = resolveEightK4Config(runtime);

    expect(config.apiBase).toBe("https://api.8k4protocol.com");
    expect(runtime.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Insecure EIGHTK4_API_BASE protocol"),
    );
  });

  it("rejects non-default hosts unless explicitly allowed", () => {
    const runtime = createRuntime({ EIGHTK4_API_BASE: "https://evil.example" });
    const config = resolveEightK4Config(runtime);

    expect(config.apiBase).toBe("https://api.8k4protocol.com");
    expect(runtime.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("EIGHTK4_API_BASE host 'evil.example' rejected"),
    );
  });

  it("allows non-default https hosts only with the escape hatch enabled", () => {
    const runtime = createRuntime({
      EIGHTK4_API_BASE: "https://staging.8k4.example/path",
      EIGHTK4_ALLOW_CUSTOM_API_BASE: true,
    });
    const config = resolveEightK4Config(runtime);

    expect(config.apiBase).toBe("https://staging.8k4.example");
    expect(runtime.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Using non-default API host 'staging.8k4.example'"),
    );
  });
});
