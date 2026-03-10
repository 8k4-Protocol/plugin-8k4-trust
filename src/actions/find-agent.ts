import type {
  Action,
  ActionExample,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  Memory,
  State,
} from "@elizaos/core";
import { TrustService } from "../services/trust-service";
import { clampLimit, clampMinScore, normalizeChain, sanitizeQuery } from "../input-policy";

function getTrustService(runtime: IAgentRuntime): TrustService | null {
  return runtime.getService<TrustService>(TrustService.serviceType);
}

function asParams(
  options?: HandlerOptions | Record<string, unknown>,
): Record<string, unknown> {
  const raw = options as { parameters?: Record<string, unknown> } | undefined;
  return raw?.parameters ?? {};
}

function freeText(message: Memory): string {
  if (typeof message.content === "string") return message.content;
  return typeof message.content?.text === "string" ? message.content.text : "";
}

function extractSearchQueryFromText(text: string): string {
  const normalized = sanitizeQuery(text);
  if (!normalized) return "";

  const quoted = normalized.match(/query\s*["“”']([^"“”']{1,200})["“”']/i)
    ?? normalized.match(/["“”']([^"“”']{1,200})["“”']/);
  if (quoted?.[1]) return sanitizeQuery(quoted[1]);

  const stripped = normalized
    .replace(/^use\s+find_trusted_agent\s+for\s+query\s*/i, "")
    .replace(/^find\s+(?:me\s+)?(?:a\s+)?trusted\s+agent\s+for\s+/i, "")
    .replace(/^find\s+(?:me\s+)?(?:an\s+)?agent\s+for\s+/i, "")
    .replace(/^search\s+(?:for\s+)?(?:a\s+)?trusted\s+agent\s+for\s+/i, "")
    .replace(/^search\s+(?:for\s+)?(?:an\s+)?agent\s+for\s+/i, "")
    .replace(/^search\s+(?:for\s+)?/i, "")
    .replace(/^find\s+(?:me\s+)?/i, "")
    .replace(/^(?:a|an)\s+agent\s+for\s+/i, "")
    .replace(/^trusted\s+agent\s+for\s+/i, "")
    .replace(/^agents?\s+(?:for|related to)\s+/i, "")
    .trim();

  return sanitizeQuery(stripped || normalized);
}

export const findTrustedAgentAction: Action = {
  name: "FIND_TRUSTED_AGENT",
  description:
    "Find trusted agents for a task description using 8K4 search endpoint with score filtering.",
  similes: ["FIND_AGENT", "SEARCH_TRUSTED_AGENT", "DISCOVER_TRUSTED_AGENT"],
  parameters: [
    {
      name: "query",
      description: "Task or capability query, e.g. 'token swaps on base'.",
      required: true,
      schema: { type: "string" },
    },
    {
      name: "chain",
      description: "Optional chain filter (eth/base/bsc/etc).",
      required: false,
      schema: { type: "string" },
    },
    {
      name: "minScore",
      description: "Minimum trust score (default 60).",
      required: false,
      schema: { type: "number" },
    },
    {
      name: "limit",
      description: "Maximum results to return (default 20).",
      required: false,
      schema: { type: "number" },
    },
  ],
  validate: async (runtime: IAgentRuntime) => {
    return !!getTrustService(runtime);
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    options?: HandlerOptions | Record<string, unknown>,
    callback?: HandlerCallback,
  ) => {
    const service = getTrustService(runtime);
    if (!service) {
      return { success: false, error: "8k4 trust service unavailable" };
    }

    const params = asParams(options);
    const messageText = freeText(message);
    const query = sanitizeQuery(params.query ?? extractSearchQueryFromText(messageText));
    const chain = normalizeChain(params.chain);
    const minScore = clampMinScore(params.minScore ?? 60, 60);
    const limit = clampLimit(params.limit ?? 20, 20);

    if (!query) {
      const text = "I need a query (task description) to find trusted agents.";
      if (callback) await callback({ text, actions: [] });
      return { success: false, error: "missing query" };
    }

    try {
      const results = await service.searchAgents(query, {
        chain,
        minScore,
        limit,
        contactable: true,
      });

      if (results.length === 0) {
        const text = `No trusted agents found for: ${query}`;
        if (callback) {
          await callback({ text, actions: [] });
        }
        return { success: true, text, data: { results: [] } };
      }

      const lines = ["[8K4 Trusted Agent Search]", `Query: ${query}`, "Top matches:"];
      for (const [index, item] of results.slice(0, 10).entries()) {
        lines.push(
          `${index + 1}. agent_id=${item.agent_id} score=${item.score ?? "n/a"} trust=${item.trust_tier ?? "n/a"} confidence=${item.confidence ?? "n/a"} chain=${item.chain ?? "n/a"}`,
        );
      }

      if (callback) {
        await callback({ text: lines.join("\n"), actions: [] });
      }

      return {
        success: true,
        text: lines.join("\n"),
        data: { query, chain, minScore, limit, results },
      };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      if (callback) {
        await callback({ text: `Trusted agent search failed (fail-open): ${messageText}`, actions: [] });
      }
      return { success: false, error: messageText };
    }
  },
  examples: [
    [
      {
        name: "user",
        content: { text: "Find me a trusted agent for token swaps on base" },
      } as ActionExample,
      {
        name: "assistant",
        content: {
          text: "Searching for trusted swap-capable agents.",
          actions: ["FIND_TRUSTED_AGENT"],
        },
      } as ActionExample,
    ],
  ],
};
