import { describe, expect, it, vi } from "vitest";
import { findTrustedAgentAction } from "../src/actions/find-agent";
import { TrustService } from "../src/services/trust-service";
import { MAX_SEARCH_QUERY_LENGTH } from "../src/input-policy";

function createRuntime(service: Partial<TrustService> | null) {
  return {
    getService: (serviceType: string) =>
      serviceType === TrustService.serviceType ? service : null,
  } as any;
}

describe("FIND_TRUSTED_AGENT action", () => {
  it("extracts a clean query from explicit instruction-style text", async () => {
    const service = {
      searchAgents: vi.fn().mockResolvedValue([]),
    } as Partial<TrustService>;

    const runtime = createRuntime(service);

    await findTrustedAgentAction.handler!(
      runtime,
      { content: { text: 'Use FIND_TRUSTED_AGENT for query "token swaps"' } } as any,
    );

    expect(service.searchAgents).toHaveBeenCalledWith(
      "token swaps",
      expect.objectContaining({ contactable: true }),
    );
  });

  it("clamps limit and minScore and caps query length", async () => {
    const service = {
      searchAgents: vi.fn().mockResolvedValue([]),
    } as Partial<TrustService>;

    const runtime = createRuntime(service);
    const oversizedQuery = `   ${"swap ".repeat(80)}   `;

    await findTrustedAgentAction.handler!(
      runtime,
      { content: { text: "unused" } } as any,
      undefined,
      { parameters: { query: oversizedQuery, minScore: 999, limit: 500 } } as any,
    );

    expect(service.searchAgents).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ minScore: 100, limit: 50, contactable: true }),
    );
    const [query] = (service.searchAgents as any).mock.calls[0];
    expect(query.length).toBe(MAX_SEARCH_QUERY_LENGTH);
  });

  it("rejects missing query after sanitization", async () => {
    const service = {
      searchAgents: vi.fn(),
    } as Partial<TrustService>;

    const runtime = createRuntime(service);
    const result = await findTrustedAgentAction.handler!(
      runtime,
      { content: { text: "   " } } as any,
    );

    expect((result as any).success).toBe(false);
    expect((result as any).error).toBe("missing query");
    expect(service.searchAgents).not.toHaveBeenCalled();
  });
});
