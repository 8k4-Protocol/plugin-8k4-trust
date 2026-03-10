export const MAX_AGENT_ID = 999_999_999_999;
export const MAX_SEARCH_LIMIT = 50;
export const MAX_SEARCH_QUERY_LENGTH = 200;

const WALLET_PATTERN = /0x[a-fA-F0-9]{40}/g;
const EXPLICIT_AGENT_PATTERN =
  /\b(?:agent|agent_id|agentId|erc8004|8k4)\s*[:=]\s*(\d{1,12})\b/gi;
const EXACT_EXPLICIT_AGENT_PATTERN =
  /^(?:agent|agent_id|agentId|erc8004|8k4)\s*[:=]\s*(\d{1,12})$/i;

export type TrustLookupTarget =
  | { kind: "wallet"; value: string }
  | { kind: "agent"; value: number };

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function parseAgentId(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 && value <= MAX_AGENT_ID
      ? value
      : undefined;
  }

  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  if (!/^\d{1,12}$/.test(trimmed)) return undefined;

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_AGENT_ID
    ? parsed
    : undefined;
}

export function normalizeWallet(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^0x[a-fA-F0-9]{40}$/.test(trimmed) ? trimmed : undefined;
}

export function parseTrustLookupTarget(value: unknown): TrustLookupTarget | undefined {
  const wallet = normalizeWallet(value);
  if (wallet) return { kind: "wallet", value: wallet };

  const agentId = parseAgentId(value);
  if (agentId !== undefined) return { kind: "agent", value: agentId };

  if (typeof value !== "string") return undefined;
  const explicitMatch = value.trim().match(EXACT_EXPLICIT_AGENT_PATTERN);
  if (!explicitMatch) return undefined;

  const explicitAgentId = parseAgentId(explicitMatch[1]);
  return explicitAgentId !== undefined
    ? { kind: "agent", value: explicitAgentId }
    : undefined;
}

export function extractTrustTargets(text: string): {
  wallets: string[];
  agentIds: number[];
} {
  const wallets = unique(text.match(WALLET_PATTERN) ?? []);
  const agentIds = unique(
    Array.from(text.matchAll(EXPLICIT_AGENT_PATTERN))
      .map((match) => parseAgentId(match[1]))
      .filter((value): value is number => value !== undefined),
  );

  return { wallets, agentIds };
}

export function extractFirstTrustLookupTarget(text: string): TrustLookupTarget | undefined {
  const wallet = (text.match(WALLET_PATTERN) ?? [])[0];
  if (wallet) return { kind: "wallet", value: wallet };

  const explicitAgentMatch = Array.from(text.matchAll(EXPLICIT_AGENT_PATTERN))[0];
  if (!explicitAgentMatch) return undefined;

  const agentId = parseAgentId(explicitAgentMatch[1]);
  return agentId !== undefined ? { kind: "agent", value: agentId } : undefined;
}

export function clampLimit(value: unknown, fallback = 20): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return clampNumber(Math.trunc(parsed), 1, MAX_SEARCH_LIMIT);
}

export function clampMinScore(value: unknown, fallback = 60): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return clampNumber(parsed, 0, 100);
}

export function sanitizeQuery(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
}

export function normalizeChain(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
