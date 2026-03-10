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
type TrustPayload = Record<string, unknown>;

interface X402LikeService {
  getFetchWithPayment?: () => typeof fetch;
}

interface RequestOptions {
  paid?: boolean;
  cacheKey?: string;
  cacheTtlMs?: number;
  query?: Record<string, string | number | boolean | undefined>;
}

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function readLowercaseString(value: unknown): string | undefined {
  const normalized = readTrimmedString(value);
  return normalized ? normalized.toLowerCase() : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
  return normalized;
}

function mapRiskBandToTrustTier(riskBand: string | undefined): string | undefined {
  if (!riskBand) return undefined;
  const normalized = riskBand.toLowerCase();
  if (normalized.includes("critical")) return "minimal";
  if (normalized.includes("high")) return "low";
  if (normalized.includes("medium")) return "medium";
  if (normalized.includes("low")) return "high";
  return undefined;
}

function mapTrustTierToRiskBand(trustTier: string | undefined): string | undefined {
  if (!trustTier) return undefined;
  const normalized = trustTier.toLowerCase();
  if (normalized === "minimal" || normalized === "new") return "critical";
  if (normalized === "low") return "high";
  if (normalized === "medium") return "medium";
  if (normalized === "high") return "low";
  return undefined;
}

function toLegacyConfidenceTier(confidence: string | undefined): string | undefined {
  if (!confidence) return undefined;
  const normalized = confidence.trim();
  if (normalized.length === 0) return undefined;
  const lower = normalized.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
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
    const normalized = this.normalizeScoreResponse(data);

    return {
      kind: "agent",
      score: Number(normalized.score),
      chain: normalized.chain ?? chain,
      score_tier: normalized.score_tier,
      trust_tier: normalized.trust_tier,
      confidence: normalized.confidence,
      adjusted: normalized.adjusted,
      adjustment_reasons: normalized.adjustment_reasons,
      risk_band: normalized.risk_band ?? "unknown",
      confidence_tier: normalized.confidence_tier ?? "Unknown",
      promotion_cap_applied:
        "promotion_cap_applied" in normalized
          ? normalized.promotion_cap_applied
          : normalized.adjusted,
      promotion_cap_reasons:
        "promotion_cap_reasons" in normalized
          ? normalized.promotion_cap_reasons ?? normalized.adjustment_reasons
          : normalized.adjustment_reasons,
      raw: normalized,
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
    const normalizedData = this.normalizeWalletScoreResponse(data);

    return {
      kind: "wallet",
      score: Number(normalizedData.score),
      chain:
        (typeof normalizedData.chain === "string" ? normalizedData.chain : chain)
        || this.settings.defaultChain,
      score_tier: normalizedData.score_tier ?? "unknown",
      trust_tier: normalizedData.trust_tier ?? "unknown",
      confidence: normalizedData.confidence ?? "unknown",
      adjusted: normalizedData.adjusted ?? false,
      adjustment_reasons: normalizedData.adjustment_reasons ?? [],
      risk_band: normalizedData.risk_band ?? "unknown",
      confidence_tier: normalizedData.confidence_tier ?? "Unknown",
      promotion_cap_applied: normalizedData.promotion_cap_applied ?? normalizedData.adjusted ?? false,
      promotion_cap_reasons:
        normalizedData.promotion_cap_reasons ?? normalizedData.adjustment_reasons ?? [],
      raw: normalizedData,
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

    return Array.isArray(payload) ? payload.map((item) => this.normalizeAgentItem(item)) : [];
  }

  private pickAgentList(payload: AgentSearchResponse): AgentSearchItem[] {
    const items = Array.isArray(payload)
      ? payload
      : Array.isArray(payload.items)
        ? payload.items
        : Array.isArray(payload.agents)
          ? payload.agents
          : Array.isArray(payload.results)
            ? payload.results
            : [];

    return items.map((item) => this.normalizeAgentItem(item));
  }

  private normalizeScoreResponse(
    data: ScorePublicResponse | ScoreExplainResponse,
  ): ScorePublicResponse | ScoreExplainResponse {
    const payload = data as unknown as TrustPayload;
    const scoreTier = this.readScoreTier(payload) ?? "unknown";
    const trustTier = this.readTrustTier(payload) ?? "unknown";
    const confidence = this.readConfidence(payload) ?? "unknown";
    const adjusted = this.readAdjusted(payload) ?? false;
    const adjustmentReasons = this.readAdjustmentReasons(payload);
    const riskBand = this.readRiskBand(payload, trustTier) ?? "unknown";
    const confidenceTier = this.readLegacyConfidenceTier(payload, confidence) ?? "Unknown";

    const normalizedBase: ScorePublicResponse = {
      ...data,
      agent_id: Number(data.agent_id),
      chain: typeof data.chain === "string" ? data.chain : "",
      global_id: typeof data.global_id === "string" ? data.global_id : "",
      score: Number(data.score),
      score_tier: scoreTier,
      trust_tier: trustTier,
      confidence,
      adjusted,
      adjustment_reasons: adjustmentReasons,
      risk_band: riskBand,
      confidence_tier: confidenceTier,
      validator_count_bucket:
        typeof data.validator_count_bucket === "string" ? data.validator_count_bucket : "",
      as_of: typeof data.as_of === "string" ? data.as_of : "",
      disclaimer: typeof data.disclaimer === "string" ? data.disclaimer : "",
    };

    if ("positives" in data || "cautions" in data) {
      return {
        ...normalizedBase,
        positives: readStringArray((data as unknown as TrustPayload).positives) ?? [],
        cautions: readStringArray((data as unknown as TrustPayload).cautions) ?? [],
        final_tier: readTrimmedString(payload.final_tier) ?? scoreTier,
        candidate_tier: readTrimmedString(payload.candidate_tier),
        promotion_cap_applied: this.readLegacyPromotionCapApplied(payload, adjusted) ?? adjusted,
        promotion_cap_reasons: this.readLegacyPromotionCapReasons(payload, adjustmentReasons),
        promotion_cap_to:
          typeof payload.promotion_cap_to === "string" || payload.promotion_cap_to === null
            ? (payload.promotion_cap_to as string | null)
            : null,
      };
    }

    return normalizedBase;
  }

  private normalizeWalletScoreResponse(data: WalletScoreResponse): WalletScoreResponse {
    const payload = data as unknown as TrustPayload;
    const normalized: WalletScoreResponse = {
      ...data,
      wallet: typeof data.wallet === "string" ? data.wallet : "",
      score: Number(data.score),
    };

    const scoreTier = this.readScoreTier(payload);
    const trustTier = this.readTrustTier(payload);
    const confidence = this.readConfidence(payload);
    const adjusted = this.readAdjusted(payload);
    const adjustmentReasons = this.readAdjustmentReasons(payload);
    const riskBand = this.readRiskBand(payload, trustTier);
    const confidenceTier = this.readLegacyConfidenceTier(payload, confidence);
    const promotionCapApplied = this.readLegacyPromotionCapApplied(payload, adjusted);
    const promotionCapReasons = this.readLegacyPromotionCapReasons(payload, adjustmentReasons);

    if (scoreTier) normalized.score_tier = scoreTier;
    if (trustTier) normalized.trust_tier = trustTier;
    if (confidence) normalized.confidence = confidence;
    if (adjusted !== undefined) normalized.adjusted = adjusted;
    normalized.adjustment_reasons = adjustmentReasons;
    if (riskBand) normalized.risk_band = riskBand;
    if (confidenceTier) normalized.confidence_tier = confidenceTier;
    if (promotionCapApplied !== undefined) normalized.promotion_cap_applied = promotionCapApplied;
    normalized.promotion_cap_reasons = promotionCapReasons;

    return normalized;
  }

  private normalizeAgentItem(item: AgentSearchItem): AgentSearchItem {
    const payload = item as unknown as TrustPayload;
    const normalized: AgentSearchItem = {
      ...item,
      agent_id: Number(item.agent_id),
      score: typeof item.score === "number" ? item.score : undefined,
    };

    const scoreTier = this.readScoreTier(payload);
    const trustTier = this.readTrustTier(payload);
    const confidence = this.readConfidence(payload);
    const adjusted = this.readAdjusted(payload);
    const adjustmentReasons = this.readAdjustmentReasons(payload);
    const riskBand = this.readRiskBand(payload, trustTier);
    const confidenceTier = this.readLegacyConfidenceTier(payload, confidence);
    const promotionCapApplied = this.readLegacyPromotionCapApplied(payload, adjusted);
    const promotionCapReasons = this.readLegacyPromotionCapReasons(payload, adjustmentReasons);

    if (scoreTier) normalized.score_tier = scoreTier;
    if (trustTier) normalized.trust_tier = trustTier;
    if (confidence) normalized.confidence = confidence;
    if (adjusted !== undefined) normalized.adjusted = adjusted;
    normalized.adjustment_reasons = adjustmentReasons;
    if (riskBand) normalized.risk_band = riskBand;
    if (confidenceTier) normalized.confidence_tier = confidenceTier;
    if (promotionCapApplied !== undefined) normalized.promotion_cap_applied = promotionCapApplied;
    normalized.promotion_cap_reasons = promotionCapReasons;

    return normalized;
  }

  private readScoreTier(payload: TrustPayload): string | undefined {
    return (
      readLowercaseString(payload.score_tier)
      ?? readLowercaseString(payload.final_tier)
      ?? readLowercaseString(payload.candidate_tier)
    );
  }

  private readTrustTier(payload: TrustPayload): string | undefined {
    return readLowercaseString(payload.trust_tier)
      ?? mapRiskBandToTrustTier(readLowercaseString(payload.risk_band));
  }

  private readRiskBand(payload: TrustPayload, trustTier?: string): string | undefined {
    return readLowercaseString(payload.risk_band)
      ?? mapTrustTierToRiskBand(trustTier ?? readLowercaseString(payload.trust_tier));
  }

  private readConfidence(payload: TrustPayload): string | undefined {
    return readLowercaseString(payload.confidence)
      ?? readLowercaseString(payload.confidence_tier);
  }

  private readLegacyConfidenceTier(
    payload: TrustPayload,
    confidence?: string,
  ): string | undefined {
    return readTrimmedString(payload.confidence_tier)
      ?? toLegacyConfidenceTier(confidence ?? this.readConfidence(payload));
  }

  private readAdjusted(payload: TrustPayload): boolean | undefined {
    return readBoolean(payload.adjusted)
      ?? readBoolean(payload.promotion_cap_applied);
  }

  private readLegacyPromotionCapApplied(
    payload: TrustPayload,
    adjusted?: boolean,
  ): boolean | undefined {
    return readBoolean(payload.promotion_cap_applied)
      ?? adjusted
      ?? this.readAdjusted(payload);
  }

  private readAdjustmentReasons(payload: TrustPayload): string[] {
    return readStringArray(payload.adjustment_reasons)
      ?? readStringArray(payload.promotion_cap_reasons)
      ?? [];
  }

  private readLegacyPromotionCapReasons(
    payload: TrustPayload,
    adjustmentReasons?: string[],
  ): string[] {
    return readStringArray(payload.promotion_cap_reasons)
      ?? adjustmentReasons
      ?? this.readAdjustmentReasons(payload);
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
