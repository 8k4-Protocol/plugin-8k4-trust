import type { IAgentRuntime } from "@elizaos/core";

export type GuardMode = "off" | "warn" | "block";
export type GuardFailMode = "open" | "closed";

export interface EightK4Config {
  apiKey?: string;
  apiBase: string;
  defaultChain: string;
  guardMode: GuardMode;
  guardFailMode: GuardFailMode;
  guardBlockThreshold: number;
  guardCautionThreshold: number;
  cacheTtlMs: number;
  cacheMaxEntries: number;
  timeoutMs: number;
  allowCustomApiBase: boolean;
}

const DEFAULT_API_BASE = "https://api.8k4protocol.com";
const DEFAULT_API_HOST = "api.8k4protocol.com";

const DEFAULTS: Omit<EightK4Config, "apiKey" | "guardFailMode"> = {
  apiBase: DEFAULT_API_BASE,
  defaultChain: "eth",
  guardMode: "warn",
  guardBlockThreshold: 30,
  guardCautionThreshold: 60,
  cacheTtlMs: 300_000,
  cacheMaxEntries: 500,
  timeoutMs: 8_000,
  allowCustomApiBase: false,
};

function readString(runtime: IAgentRuntime, key: string): string | undefined {
  const value = runtime.getSetting(key);
  if (value === null || value === undefined) return undefined;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : undefined;
}

function readNumber(runtime: IAgentRuntime, key: string, fallback: number): number {
  const raw = runtime.getSetting(key);
  if (raw === null || raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(runtime: IAgentRuntime, key: string, fallback = false): boolean {
  const raw = runtime.getSetting(key);
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  }
  return fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeApiBase(
  runtime: IAgentRuntime,
  requestedBase: string | undefined,
  allowCustomApiBase: boolean,
): string {
  const candidate = requestedBase ?? DEFAULTS.apiBase;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    runtime.logger?.warn?.(
      `[8k4-trust] Invalid EIGHTK4_API_BASE='${candidate}'. Falling back to ${DEFAULTS.apiBase}`,
    );
    return DEFAULTS.apiBase;
  }

  if (parsed.protocol !== "https:") {
    runtime.logger.warn?.(
      `[8k4-trust] Insecure EIGHTK4_API_BASE protocol '${parsed.protocol}' rejected. Falling back to ${DEFAULTS.apiBase}`,
    );
    return DEFAULTS.apiBase;
  }

  if (parsed.hostname !== DEFAULT_API_HOST) {
    if (!allowCustomApiBase) {
      runtime.logger.warn?.(
        `[8k4-trust] EIGHTK4_API_BASE host '${parsed.hostname}' rejected. Set EIGHTK4_ALLOW_CUSTOM_API_BASE=true to allow non-default hosts. Falling back to ${DEFAULTS.apiBase}`,
      );
      return DEFAULTS.apiBase;
    }

    runtime.logger.warn?.(
      `[8k4-trust] Using non-default API host '${parsed.hostname}' because EIGHTK4_ALLOW_CUSTOM_API_BASE=true`,
    );
  }

  return parsed.origin;
}

export function resolveEightK4Config(runtime: IAgentRuntime): EightK4Config {
  const modeRaw = readString(runtime, "EIGHTK4_GUARD_MODE")?.toLowerCase();
  const guardMode: GuardMode =
    modeRaw === "off" || modeRaw === "warn" || modeRaw === "block"
      ? modeRaw
      : DEFAULTS.guardMode;

  const failModeRaw = readString(runtime, "EIGHTK4_GUARD_FAIL_MODE")?.toLowerCase();
  const guardFailMode: GuardFailMode =
    failModeRaw === "open" || failModeRaw === "closed"
      ? failModeRaw
      : guardMode === "block"
        ? "closed"
        : "open";

  const allowCustomApiBase = readBoolean(
    runtime,
    "EIGHTK4_ALLOW_CUSTOM_API_BASE",
    DEFAULTS.allowCustomApiBase,
  );

  return {
    apiKey: readString(runtime, "EIGHTK4_API_KEY"),
    apiBase: normalizeApiBase(
      runtime,
      readString(runtime, "EIGHTK4_API_BASE"),
      allowCustomApiBase,
    ),
    defaultChain: readString(runtime, "EIGHTK4_DEFAULT_CHAIN") ?? DEFAULTS.defaultChain,
    guardMode,
    guardFailMode,
    guardBlockThreshold: clamp(
      readNumber(runtime, "EIGHTK4_GUARD_BLOCK_THRESHOLD", DEFAULTS.guardBlockThreshold),
      0,
      100,
    ),
    guardCautionThreshold: clamp(
      readNumber(runtime, "EIGHTK4_GUARD_CAUTION_THRESHOLD", DEFAULTS.guardCautionThreshold),
      0,
      100,
    ),
    cacheTtlMs: clamp(readNumber(runtime, "EIGHTK4_CACHE_TTL_MS", DEFAULTS.cacheTtlMs), 1_000, 3_600_000),
    cacheMaxEntries: clamp(
      readNumber(runtime, "EIGHTK4_CACHE_MAX_ENTRIES", DEFAULTS.cacheMaxEntries),
      50,
      10_000,
    ),
    timeoutMs: clamp(readNumber(runtime, "EIGHTK4_TIMEOUT_MS", DEFAULTS.timeoutMs), 500, 30_000),
    allowCustomApiBase,
  };
}
