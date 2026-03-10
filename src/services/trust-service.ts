import { Service, type IAgentRuntime } from "@elizaos/core";
import { resolveEightK4Config, type EightK4Config } from "../config";
import type {
  AgentSearchItem,
  AgentSearchResponse,
  ScoreExplainResponse,
  ScorePublicResponse,
  TopAgentsResponse,
  TrustCheckResult,
  WalletScoreResponse,
} from "../types";
import { clampLimit, clampMinScore, normalizeWallet, parseAgentId, sanitizeQuery } from "../input-policy";

type CacheEntry<T> = { expiresAt: number; value: T };

interface X402LikeService {
  getFetchWithPayment?: () => typeof fetch;
}

interface RequestOptions {
  paid?: boolean;
  cacheKey?: string;
  cacheTtlMs?: number;
  query?: Record<string, string | number | boolean | undefined>;
}

export class TrustService extends Service {
  static serviceType = "8k4_trust" as const;
  capabilityDescription = "8K4 trust scoring and trusted agent discovery";

  private settings: EightK4Config;
  private cache = new Map<string, CacheEntry<unknown>>();
  private inFlight = new Map<string, Promise<unknown>>();

  constructor(runtime?: IAgentRuntime) {
    super(runtime);
    this.settings = runtime
      ? resolveEightK4Config(runtime)
      : {
          apiBase: "https://api.8k4protocol.com",
          defaultChain: "eth",
          guardMode: "warn",
          guardFailMode: "open",
          guardBlockThreshold: 30,
          guardCautionThreshold: 60,
          cacheTtlMs: 300_000,
          cacheMaxEntries: 500,
          timeoutMs: 8_000,
          allowCustomApiBase: false,
        };
  }

  static async start(runtime: IAgentRuntime): Promise<TrustService> {
    const service = new TrustService(runtime);
    service.settings = resolveEightK4Config(runtime);
    return service;
  }

  async stop(): Promise<void> {
    this.cache.clear();
    this.inFlight.clear();
  }

  getConfig(): EightK4Config {
    this.settings = resolveEightK4Config(this.runtime);
    return this.settings;
  }

  async checkTrust(
    agentId: number,
    chain?: string,
    explain = false,
  ): Promise<TrustCheckResult> {
    const normalizedAgentId = parseAgentId(agentId);
    if (normalizedAgentId === undefined) {
      throw new Error("agentId must be a positive integer ERC-8004 token ID");
    }

    const path = explain
      ? `/agents/${normalizedAgentId}/score/explain`
      : `/agents/${normalizedAgentId}/score`;

    const data = await this.request<ScorePublicResponse | ScoreExplainResponse>(path, {
      paid: true,
      cacheKey: `score:${normalizedAgentId}:${chain ?? ""}:${explain ? "explain" : "public"}`,
      query: { chain: chain || this.settings.defaultChain },
    });

    return {
      kind: "agent",
      score: Number(data.score),
      chain: data.chain ?? chain,
      risk_band: data.risk_band,
      confidence_tier: data.confidence_tier,
      raw: data,
    };
  }

  async checkWalletTrust(wallet: string, chain?: string): Promise<TrustCheckResult> {
    const normalized = normalizeWallet(wallet);
    if (!normalized) {
      throw new Error("wallet must be a valid 0x-prefixed 40-character hex address");
    }

    const data = await this.request<WalletScoreResponse>(`/wallet/${normalized}/score`, {
      paid: true,
      cacheKey: `wallet-score:${wallet}:${chain ?? ""}`,
      query: { chain: chain || this.settings.defaultChain },
    });

    return {
      kind: "wallet",
      score: Number(data.score),
      chain: (typeof data.chain === "string" ? data.chain : chain) || this.settings.defaultChain,
      risk_band:
        typeof data.risk_band === "string" ? data.risk_band : "unknown",
      confidence_tier:
        typeof data.confidence_tier === "string" ? data.confidence_tier : "unknown",
      raw: data,
    };
  }

  async searchAgents(
    query: string,
    options?: {
      chain?: string;
      minScore?: number;
      contactable?: boolean;
      limit?: number;
    },
  ): Promise<AgentSearchItem[]> {
    const normalizedQuery = sanitizeQuery(query);
    if (!normalizedQuery) {
      throw new Error("query must be a non-empty string");
    }

    const minScore = clampMinScore(options?.minScore ?? 60, 60);
    const limit = clampLimit(options?.limit ?? 20, 20);
    const payload = await this.request<AgentSearchResponse>("/agents/search", {
      paid: true,
      cacheKey: `search:${normalizedQuery}:${JSON.stringify({
        chain: options?.chain || this.settings.defaultChain,
        minScore,
        contactable: options?.contactable ?? true,
        limit,
      })}`,
      query: {
        q: normalizedQuery,
        min_score: minScore,
        contactable: options?.contactable ?? true,
        chain: options?.chain || this.settings.defaultChain,
        limit,
      },
      cacheTtlMs: Math.max(this.settings.cacheTtlMs, 60_000),
    });

    return this.pickAgentList(payload);
  }

  async getTopAgents(limit = 10): Promise<AgentSearchItem[]> {
    const normalizedLimit = clampLimit(limit, 10);
    const payload = await this.request<TopAgentsResponse>("/agents/top", {
      paid: false,
      cacheKey: `top:${normalizedLimit}`,
      query: { limit: normalizedLimit },
      cacheTtlMs: Math.max(this.settings.cacheTtlMs, 10 * 60_000),
    });

    return Array.isArray(payload) ? payload : [];
  }

  private pickAgentList(payload: AgentSearchResponse): AgentSearchItem[] {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.items)) return payload.items;
    if (Array.isArray(payload.agents)) return payload.agents;
    if (Array.isArray(payload.results)) return payload.results;
    return [];
  }

  private getCached<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value as T;
  }

  private setCached<T>(key: string, value: T, ttlMs: number): void {
    this.evictExpiredEntries();
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    this.cache.set(key, { value, expiresAt: Date.now() + ttlMs });
    while (this.cache.size > this.settings.cacheMaxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (!oldestKey) break;
      this.cache.delete(oldestKey);
    }
  }

  private evictExpiredEntries(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
  }

  private async request<T>(path: string, opts: RequestOptions): Promise<T> {
    this.settings = resolveEightK4Config(this.runtime);
    this.evictExpiredEntries();

    const cacheKey = opts.cacheKey;
    if (cacheKey) {
      const cached = this.getCached<T>(cacheKey);
      if (cached !== undefined) return cached;

      const pending = this.inFlight.get(cacheKey);
      if (pending) {
        return pending as Promise<T>;
      }
    }

    const promise = this.performRequest<T>(path, opts, cacheKey);
    if (cacheKey) {
      this.inFlight.set(cacheKey, promise);
    }

    try {
      return await promise;
    } finally {
      if (cacheKey && this.inFlight.get(cacheKey) === promise) {
        this.inFlight.delete(cacheKey);
      }
    }
  }

  private async performRequest<T>(
    path: string,
    opts: RequestOptions,
    cacheKey?: string,
  ): Promise<T> {
    const url = new URL(path, this.settings.apiBase);
    const query = opts.query ?? {};
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && String(value).length > 0) {
        url.searchParams.set(key, String(value));
      }
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.settings.apiKey) {
      headers["X-API-Key"] = this.settings.apiKey;
    }

    const fetcher = this.resolveFetcher(opts.paid);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.settings.timeoutMs);

    try {
      const res = await fetcher(url.toString(), {
        method: "GET",
        headers,
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`8K4 API ${res.status} ${res.statusText} at ${path}${errText ? `: ${errText.slice(0, 300)}` : ""}`);
      }

      const json = (await res.json()) as T;
      if (cacheKey) {
        this.setCached(cacheKey, json, opts.cacheTtlMs ?? this.settings.cacheTtlMs);
      }
      return json;
    } finally {
      clearTimeout(timeout);
    }
  }

  private resolveFetcher(paid = false): typeof fetch {
    if (!paid) return fetch;

    if (this.settings.apiKey) {
      return fetch;
    }

    const x402 = this.runtime.getService("x402_payment") as unknown as X402LikeService | null;
    if (x402?.getFetchWithPayment) {
      return x402.getFetchWithPayment();
    }

    // Paid endpoints need auth; fail fast so caller can choose fail-open behavior.
    throw new Error(
      "Paid 8K4 endpoint requires EIGHTK4_API_KEY or plugin-x402 configured for micropayments.",
    );
  }
}
