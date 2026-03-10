import { describe, expect, it, vi } from "vitest";
import { trustGuardEvaluator, extractTargets } from "../src/evaluators/trust-guard";
import { TrustService } from "../src/services/trust-service";

function createRuntime(
  settings: Record<string, unknown>,
  trustService?: Partial<TrustService>,
) {
  return {
    getSetting: (key: string) => settings[key],
    getService: (serviceType: string) =>
      serviceType === TrustService.serviceType ? trustService : null,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  } as any;
}

describe("trust guard extractTargets", () => {
  it("matches explicit agent patterns only", () => {
    const text = "agent:123 agent_id=456 erc8004:789 8k4:101 agentId:202";
    const targets = extractTargets(text);

    expect(targets.agentIds).toEqual([123, 456, 789, 101, 202]);
  });

  it("does not match bare numbers in normal text", () => {
    const targets = extractTargets("I have 3 dogs and 12 cats");
    expect(targets.agentIds).toEqual([]);
  });

  it("matches wallet addresses", () => {
    const wallet = "0x1111111111111111111111111111111111111111";
    const targets = extractTargets(`check wallet ${wallet}`);
    expect(targets.wallets).toEqual([wallet]);
  });
});

describe("trust guard evaluator", () => {
  it("returns blocked false when mode is off", async () => {
    const runtime = createRuntime({ EIGHTK4_GUARD_MODE: "off" });
    const result = await trustGuardEvaluator.handler(runtime, { content: { text: "agent:123" } } as any);

    expect(result).toEqual({ blocked: false });
  });

  it("returns warning in warn mode for low-score agent", async () => {
    const trustService = {
      checkTrust: vi.fn().mockResolvedValue({ score: 40, trust_tier: "medium", confidence: "low" }),
    } as Partial<TrustService>;

    const runtime = createRuntime({ EIGHTK4_GUARD_MODE: "warn" }, trustService);
    const result = await trustGuardEvaluator.handler(runtime, { content: { text: "send funds to agent:123" } } as any);

    expect(result.blocked).toBe(false);
    expect(result.rewrittenText).toContain("[TRUST-GUARD WARNING]");
  });

  it("blocks in block mode for below-threshold score", async () => {
    const trustService = {
      checkTrust: vi.fn().mockResolvedValue({ score: 10, trust_tier: "high", confidence: "low" }),
    } as Partial<TrustService>;

    const runtime = createRuntime(
      {
        EIGHTK4_GUARD_MODE: "block",
        EIGHTK4_GUARD_BLOCK_THRESHOLD: 30,
      },
      trustService,
    );

    const result = await trustGuardEvaluator.handler(runtime, { content: { text: "agent_id:555" } } as any);

    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Blocked by trust guard");
  });

  it("blocks in block mode for legacy risk_band=high during mixed-version rollout", async () => {
    const trustService = {
      checkTrust: vi.fn().mockResolvedValue({
        score: 85,
        trust_tier: "low",
        risk_band: "high",
        confidence: "medium",
      }),
    } as Partial<TrustService>;

    const runtime = createRuntime({ EIGHTK4_GUARD_MODE: "block" }, trustService);
    const result = await trustGuardEvaluator.handler(runtime, { content: { text: "agent:777" } } as any);

    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("risk_band=high");
  });

  it("blocks in block mode for legacy risk_band=critical during mixed-version rollout", async () => {
    const trustService = {
      checkTrust: vi.fn().mockResolvedValue({
        score: 90,
        trust_tier: "unknown",
        risk_band: "critical",
        confidence: "medium",
      }),
    } as Partial<TrustService>;

    const runtime = createRuntime({ EIGHTK4_GUARD_MODE: "block" }, trustService);
    const result = await trustGuardEvaluator.handler(runtime, { content: { text: "agent:888" } } as any);

    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("risk_band=critical");
  });

  it("blocks in block mode for minimal trust tier even with a decent score", async () => {
    const trustService = {
      checkTrust: vi.fn().mockResolvedValue({ score: 85, trust_tier: "minimal", confidence: "high" }),
    } as Partial<TrustService>;

    const runtime = createRuntime({ EIGHTK4_GUARD_MODE: "block" }, trustService);
    const result = await trustGuardEvaluator.handler(runtime, { content: { text: "agent:777" } } as any);

    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("trust_tier=minimal");
  });

  it("fails open on API error", async () => {
    const trustService = {
      checkTrust: vi.fn().mockRejectedValue(new Error("network fail")),
    } as Partial<TrustService>;

    const runtime = createRuntime(
      { EIGHTK4_GUARD_MODE: "block", EIGHTK4_GUARD_FAIL_MODE: "open" },
      trustService,
    );
    const result = await trustGuardEvaluator.handler(runtime, { content: { text: "agent:999" } } as any);

    expect(result.blocked).toBe(false);
    expect(result.reason).toContain("fail-open");
    expect(runtime.logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Trust guard enforcement failed (block/open) lookup error: network fail"),
    );
  });

  it("fails closed by default in block mode on lookup error", async () => {
    const trustService = {
      checkTrust: vi.fn().mockRejectedValue(new Error("network fail")),
    } as Partial<TrustService>;

    const runtime = createRuntime({ EIGHTK4_GUARD_MODE: "block" }, trustService);
    const result = await trustGuardEvaluator.handler(runtime, { content: { text: "agent:999" } } as any);

    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("enforcement failure");
    expect(runtime.logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Trust guard enforcement failed (block/closed) lookup error: network fail"),
    );
  });

  it("fails closed when the trust service is unavailable", async () => {
    const runtime = createRuntime({ EIGHTK4_GUARD_MODE: "block" });
    const result = await trustGuardEvaluator.handler(runtime, { content: { text: "agent:999" } } as any);

    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("trust service unavailable");
  });
});
