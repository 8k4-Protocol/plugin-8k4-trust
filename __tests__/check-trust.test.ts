import { describe, expect, it, vi } from "vitest";
import { checkTrustAction } from "../src/actions/check-trust";
import { TrustService } from "../src/services/trust-service";

function createRuntime(service: Partial<TrustService> | null) {
  return {
    getService: (serviceType: string) =>
      serviceType === TrustService.serviceType ? service : null,
  } as any;
}

describe("CHECK_AGENT_TRUST action", () => {
  it("validate returns false when service is missing", async () => {
    const runtime = createRuntime(null);
    await expect(checkTrustAction.validate!(runtime, {} as any)).resolves.toBe(false);
  });

  it("handles wallet address input and routes to wallet endpoint", async () => {
    const service = {
      checkWalletTrust: vi.fn().mockResolvedValue({
        kind: "wallet",
        score: 80,
        chain: "eth",
        score_tier: "high",
        trust_tier: "high",
        confidence: "high",
        adjusted: false,
        adjustment_reasons: [],
        raw: {},
      }),
      checkTrust: vi.fn(),
      getConfig: vi.fn().mockReturnValue({ defaultChain: "eth" }),
    } as Partial<TrustService>;

    const runtime = createRuntime(service);
    const wallet = "0x1111111111111111111111111111111111111111";

    const result = await checkTrustAction.handler!(
      runtime,
      { content: { text: `check ${wallet}` } } as any,
      undefined,
      { parameters: { agentId: wallet } } as any,
    );

    expect(service.checkWalletTrust).toHaveBeenCalledWith(wallet, undefined);
    expect(service.checkTrust).not.toHaveBeenCalled();
    expect((result as any).success).toBe(true);
    expect((result as any).text).toContain("Trust tier: high");
  });

  it("handles numeric agent ID input", async () => {
    const service = {
      checkWalletTrust: vi.fn(),
      checkTrust: vi.fn().mockResolvedValue({
        kind: "agent",
        score: 72,
        chain: "base",
        score_tier: "medium",
        trust_tier: "medium",
        confidence: "medium",
        adjusted: true,
        adjustment_reasons: ["manual review adjustment"],
        raw: {},
      }),
      getConfig: vi.fn().mockReturnValue({ defaultChain: "eth" }),
    } as Partial<TrustService>;

    const runtime = createRuntime(service);
    const result = await checkTrustAction.handler!(
      runtime,
      { content: { text: "check agent" } } as any,
      undefined,
      { parameters: { agentId: "6888", chain: "base" } } as any,
    );

    expect(service.checkTrust).toHaveBeenCalledWith(6888, "base", false);
    expect((result as any).success).toBe(true);
    expect((result as any).data.trust_tier).toBe("medium");
  });

  it("uses only explicit agent-id patterns from free text", async () => {
    const service = {
      checkWalletTrust: vi.fn(),
      checkTrust: vi.fn().mockResolvedValue({
        kind: "agent",
        score: 72,
        chain: "eth",
        score_tier: "medium",
        trust_tier: "medium",
        confidence: "medium",
        adjusted: false,
        adjustment_reasons: [],
        raw: {},
      }),
      getConfig: vi.fn().mockReturnValue({ defaultChain: "eth" }),
    } as Partial<TrustService>;

    const runtime = createRuntime(service);
    await checkTrustAction.handler!(
      runtime,
      { content: { text: "roadmap 2026 but trust-check agent:6888 please" } } as any,
    );

    expect(service.checkTrust).toHaveBeenCalledWith(6888, undefined, false);
  });

  it("does not infer bare numbers from free text", async () => {
    const service = {
      checkWalletTrust: vi.fn(),
      checkTrust: vi.fn(),
      getConfig: vi.fn().mockReturnValue({ defaultChain: "eth" }),
    } as Partial<TrustService>;

    const runtime = createRuntime(service);
    const result = await checkTrustAction.handler!(
      runtime,
      { content: { text: "roadmap 2026 has 3 milestones" } } as any,
    );

    expect((result as any).success).toBe(false);
    expect((result as any).error).toBe("missing or invalid agentId");
    expect(service.checkTrust).not.toHaveBeenCalled();
  });

  it("rejects invalid explicit agentId parameters", async () => {
    const service = {
      checkWalletTrust: vi.fn(),
      checkTrust: vi.fn(),
      getConfig: vi.fn().mockReturnValue({ defaultChain: "eth" }),
    } as Partial<TrustService>;

    const runtime = createRuntime(service);
    const result = await checkTrustAction.handler!(
      runtime,
      { content: { text: "check trust" } } as any,
      undefined,
      { parameters: { agentId: "9999999999999" } } as any,
    );

    expect((result as any).success).toBe(false);
    expect((result as any).error).toBe("missing or invalid agentId");
    expect(service.checkTrust).not.toHaveBeenCalled();
  });

  it("infers explain mode from message text when parameters are not provided", async () => {
    const service = {
      checkWalletTrust: vi.fn(),
      checkTrust: vi.fn().mockResolvedValue({
        kind: "agent",
        score: 90,
        chain: "eth",
        score_tier: "high",
        trust_tier: "high",
        confidence: "high",
        adjusted: false,
        adjustment_reasons: [],
        raw: { positives: ["good"], cautions: [] },
      }),
      getConfig: vi.fn().mockReturnValue({ defaultChain: "eth" }),
    } as Partial<TrustService>;

    const runtime = createRuntime(service);
    await checkTrustAction.handler!(
      runtime,
      { content: { text: "Check trust for agent:6888 and include explain details" } } as any,
    );

    expect(service.checkTrust).toHaveBeenCalledWith(6888, undefined, true);
  });

  it("passes explain flag through for numeric IDs", async () => {
    const service = {
      checkWalletTrust: vi.fn(),
      checkTrust: vi.fn().mockResolvedValue({
        kind: "agent",
        score: 90,
        chain: "eth",
        score_tier: "high",
        trust_tier: "high",
        confidence: "high",
        adjusted: false,
        adjustment_reasons: [],
        raw: { positives: ["good"], cautions: [] },
      }),
      getConfig: vi.fn().mockReturnValue({ defaultChain: "eth" }),
    } as Partial<TrustService>;

    const runtime = createRuntime(service);
    await checkTrustAction.handler!(
      runtime,
      { content: { text: "agent 6888" } } as any,
      undefined,
      { parameters: { agentId: "6888", explain: true } } as any,
    );

    expect(service.checkTrust).toHaveBeenCalledWith(6888, undefined, true);
  });
});
