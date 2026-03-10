import { afterEach, describe, expect, it, vi } from "vitest";
import { TrustService } from "../src/services/trust-service";

const originalFetch = globalThis.fetch;

function setFetchMock(mock: unknown) {
  (globalThis as { fetch: unknown }).fetch = mock;
}

function createRuntime(settings: Record<string, unknown> = {}) {
  return {
    getSetting: (key: string) => settings[key],
    getService: () => null,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  } as any;
}

afterEach(() => {
  vi.restoreAllMocks();
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
});

describe("TrustService", () => {
  it("checkTrust constructs correct URL with agent ID and chain", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        score: 88,
        chain: "base",
        score_tier: "high",
        trust_tier: "high",
        confidence: "high",
        adjusted: false,
        adjustment_reasons: [],
      }),
    });
    setFetchMock(fetchMock);

    const service = new TrustService(
      createRuntime({ EIGHTK4_API_KEY: "test-key", EIGHTK4_API_BASE: "https://api.8k4protocol.com" }),
    );

    const result = await service.checkTrust(6888, "base", false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/agents/6888/score");
    expect(String(url)).toContain("chain=base");
    expect(result.score_tier).toBe("high");
    expect(result.trust_tier).toBe("high");
    expect(result.confidence).toBe("high");
  });

  it("maps legacy public fields into the new contract when needed", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        score: 91,
        chain: "eth",
        final_tier: "Medium",
        risk_band: "low",
        confidence_tier: "High",
        promotion_cap_applied: true,
        promotion_cap_reasons: ["legacy cap"],
      }),
    });
    setFetchMock(fetchMock);

    const service = new TrustService(createRuntime({ EIGHTK4_API_KEY: "test-key" }));
    const result = await service.checkTrust(123, "eth", false);

    expect(result.score_tier).toBe("medium");
    expect(result.trust_tier).toBe("high");
    expect(result.confidence).toBe("high");
    expect(result.adjusted).toBe(true);
    expect(result.adjustment_reasons).toEqual(["legacy cap"]);
    expect(result.risk_band).toBe("low");
    expect(result.confidence_tier).toBe("High");
    expect(result.promotion_cap_applied).toBe(true);
    expect(result.promotion_cap_reasons).toEqual(["legacy cap"]);
    expect((result.raw as any).risk_band).toBe("low");
    expect((result.raw as any).confidence_tier).toBe("High");
  });

  it("preserves transitional legacy aliases for new-format score responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        agent_id: 6888,
        chain: "base",
        global_id: "base:6888",
        score: 42,
        score_tier: "medium",
        trust_tier: "low",
        confidence: "medium",
        adjusted: true,
        adjustment_reasons: ["new pipeline cap"],
        validator_count_bucket: "10+",
        as_of: "2026-03-10T00:00:00Z",
        disclaimer: "test",
      }),
    });
    setFetchMock(fetchMock);

    const service = new TrustService(createRuntime({ EIGHTK4_API_KEY: "test-key" }));
    const result = await service.checkTrust(6888, "base", false);

    expect(result.score_tier).toBe("medium");
    expect(result.trust_tier).toBe("low");
    expect(result.confidence).toBe("medium");
    expect(result.adjusted).toBe(true);
    expect(result.adjustment_reasons).toEqual(["new pipeline cap"]);
    expect(result.risk_band).toBe("high");
    expect(result.confidence_tier).toBe("Medium");
    expect(result.promotion_cap_applied).toBe(true);
    expect(result.promotion_cap_reasons).toEqual(["new pipeline cap"]);
    expect((result.raw as any).risk_band).toBe("high");
    expect((result.raw as any).confidence_tier).toBe("Medium");
  });

  it("caches trust checks so second call does not fetch again", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        score: 91,
        chain: "eth",
        score_tier: "high",
        trust_tier: "high",
        confidence: "high",
        adjusted: false,
        adjustment_reasons: [],
      }),
    });
    setFetchMock(fetchMock);

    const service = new TrustService(createRuntime({ EIGHTK4_API_KEY: "test-key" }));

    await service.checkTrust(123, "eth", false);
    await service.checkTrust(123, "eth", false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("deduplicates in-flight requests for the same cache key", async () => {
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              ok: true,
              json: async () => ({
                score: 91,
                chain: "eth",
                score_tier: "high",
                trust_tier: "high",
                confidence: "high",
                adjusted: false,
                adjustment_reasons: [],
              }),
            });
          }, 10);
        }),
    );
    setFetchMock(fetchMock as any);

    const service = new TrustService(createRuntime({ EIGHTK4_API_KEY: "test-key" }));

    await Promise.all([service.checkTrust(123, "eth", false), service.checkTrust(123, "eth", false)]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("evicts oldest cached entries when max cache size is exceeded", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      const match = String(url).match(/\/agents\/(\d+)\/score/);
      const agentId = Number(match?.[1] ?? 0);
      return {
        ok: true,
        json: async () => ({
          score: 70 + agentId,
          chain: "eth",
          score_tier: "medium",
          trust_tier: "medium",
          confidence: "high",
          adjusted: false,
          adjustment_reasons: [],
        }),
      };
    });
    setFetchMock(fetchMock as any);

    const service = new TrustService(
      createRuntime({ EIGHTK4_API_KEY: "test-key", EIGHTK4_CACHE_MAX_ENTRIES: 50 }),
    );

    for (let agentId = 1; agentId <= 51; agentId += 1) {
      await service.checkTrust(agentId, "eth", false);
    }
    await service.checkTrust(1, "eth", false);

    expect(fetchMock).toHaveBeenCalledTimes(52);
  });

  it("times out when request exceeds configured timeout", async () => {
    const fetchMock = vi.fn((_: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    setFetchMock(fetchMock as any);

    const service = new TrustService(createRuntime({ EIGHTK4_API_KEY: "test-key", EIGHTK4_TIMEOUT_MS: 5 }));

    await expect(service.checkTrust(42, "eth", false)).rejects.toThrow();
  });

  it("throws on non-200 responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "boom",
    });
    setFetchMock(fetchMock);

    const service = new TrustService(createRuntime({ EIGHTK4_API_KEY: "test-key" }));

    await expect(service.checkTrust(99, "eth", false)).rejects.toThrow("8K4 API 500");
  });

  it("getTopAgents handles plain array response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          rank: 1,
          agent_id: 6888,
          chain: "eth",
          global_id: "eth:6888",
          wallet: "0x1111111111111111111111111111111111111111",
          score: 95,
          score_tier: "high",
          trust_tier: "high",
          confidence: "high",
        },
      ],
    });
    setFetchMock(fetchMock);

    const service = new TrustService(createRuntime());
    const results = await service.getTopAgents(1);

    expect(results).toHaveLength(1);
    expect(results[0].agent_id).toBe(6888);
    expect(results[0].rank).toBe(1);
    expect(results[0].wallet).toBe("0x1111111111111111111111111111111111111111");
    expect(results[0].trust_tier).toBe("high");
    expect(results[0].risk_band).toBe("low");
    expect(results[0].confidence_tier).toBe("High");
  });

  it("rejects malformed wallet addresses in checkWalletTrust", async () => {
    const service = new TrustService(createRuntime({ EIGHTK4_API_KEY: "test-key" }));

    await expect(service.checkWalletTrust("../agents/6888/score/explain")).rejects.toThrow(
      "wallet must be a valid 0x-prefixed 40-character hex address",
    );
    await expect(service.checkWalletTrust("not-a-wallet")).rejects.toThrow(
      "wallet must be a valid 0x-prefixed 40-character hex address",
    );
  });

  it("clamps search query parameters before making the request", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    });
    setFetchMock(fetchMock);

    const service = new TrustService(createRuntime({ EIGHTK4_API_KEY: "test-key" }));
    await service.searchAgents(` ${"alpha ".repeat(60)} `, { minScore: -5, limit: 999 });

    const [url] = fetchMock.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.searchParams.get("min_score")).toBe("0");
    expect(parsed.searchParams.get("limit")).toBe("50");
    expect((parsed.searchParams.get("q") ?? "").length).toBeLessThanOrEqual(200);
  });
});
