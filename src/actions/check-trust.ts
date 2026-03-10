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
import type { ScoreExplainResponse } from "../types";
import {
  extractFirstTrustLookupTarget,
  normalizeChain,
  parseTrustLookupTarget,
} from "../input-policy";

function getTrustService(runtime: IAgentRuntime): TrustService | null {
  return runtime.getService<TrustService>(TrustService.serviceType);
}

function asParams(
  options?: HandlerOptions | Record<string, unknown>,
): Record<string, unknown> {
  const raw = options as { parameters?: Record<string, unknown> } | undefined;
  return raw?.parameters ?? {};
}

function extractFreeText(message: Memory): string {
  if (typeof message.content === "string") return message.content;
  return typeof message.content?.text === "string" ? message.content.text : "";
}

function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return false;
}

function inferExplainFromText(text: string): boolean {
  return /(?:score\/explain|explain=true|include explain|explain details|use the explain endpoint|use .*score\/explain|positives and cautions)/i.test(
    text,
  );
}

export const checkTrustAction: Action = {
  name: "CHECK_AGENT_TRUST",
  description:
    "Check 8K4 trust for an ERC-8004 agent ID (integer) or wallet address. Returns score, score tier, trust tier, and confidence.",
  similes: [
    "CHECK_TRUST",
    "CHECK_8K4_TRUST",
    "VERIFY_AGENT_TRUST",
    "TRUST_SCORE",
  ],
  parameters: [
    {
      name: "agentId",
      description:
        "ERC-8004 agent token ID (integer like 6888) or wallet address (0x...) for wallet trust lookup.",
      required: true,
      schema: { type: "string" },
    },
    {
      name: "chain",
      description: "Optional chain override, e.g. eth, base, bsc.",
      required: false,
      schema: { type: "string" },
    },
    {
      name: "explain",
      description: "Include positives/cautions from /score/explain when using numeric agent ID.",
      required: false,
      schema: { type: "boolean" },
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
    const messageText = extractFreeText(message);
    const targetInput = params.agentId ?? extractFirstTrustLookupTarget(messageText)?.value;
    const target = parseTrustLookupTarget(targetInput);
    const chain = normalizeChain(params.chain);
    const explain =
      params.explain === undefined ? inferExplainFromText(messageText) : asBoolean(params.explain);

    if (!target) {
      const text =
        "I need an explicit agent ID or wallet address to check trust. Use parameters.agentId, a wallet address, or text like agent:6888.";
      if (callback) await callback({ text, actions: [] });
      return { success: false, error: "missing or invalid agentId" };
    }

    try {
      const result =
        target.kind === "wallet"
          ? await service.checkWalletTrust(target.value, chain)
          : await service.checkTrust(target.value, chain, explain);
      const targetLabel =
        target.kind === "wallet" ? target.value : `agent_id=${target.value}`;

      const lines = [
        `[8K4 Trust]`,
        `Target: ${targetLabel} (${result.kind})`,
        `Score: ${result.score}`,
        `Score tier: ${result.score_tier ?? "unknown"}`,
        `Trust tier: ${result.trust_tier ?? "unknown"}`,
        `Confidence: ${result.confidence ?? "unknown"}`,
        `Adjusted: ${result.adjusted ? "yes" : "no"}`,
        `Chain: ${result.chain ?? service.getConfig().defaultChain}`,
      ];

      if (
        Array.isArray(result.adjustment_reasons)
        && result.adjustment_reasons.length > 0
      ) {
        lines.push(`Adjustment reasons: ${result.adjustment_reasons.join("; ")}`);
      }

      if (target.kind === "agent" && explain) {
        const details = result.raw as ScoreExplainResponse;
        if (Array.isArray(details.positives) && details.positives.length > 0) {
          lines.push(`Positives: ${details.positives.join("; ")}`);
        }
        if (Array.isArray(details.cautions) && details.cautions.length > 0) {
          lines.push(`Cautions: ${details.cautions.join("; ")}`);
        }
      }

      if (callback) {
        await callback({
          text: lines.join("\n"),
          actions: [],
        });
      }

      return {
        success: true,
        text: lines.join("\n"),
        data: {
          target: target.kind === "wallet" ? target.value : String(target.value),
          targetKind: result.kind,
          score: result.score,
          score_tier: result.score_tier,
          trust_tier: result.trust_tier,
          confidence: result.confidence,
          adjusted: result.adjusted,
          adjustment_reasons: result.adjustment_reasons,
          chain: result.chain,
          raw: result.raw,
        },
      };
    } catch (error) {
      // Fail-open: return warning-style failure but don't hard block runtime.
      const messageText = error instanceof Error ? error.message : String(error);
      if (callback) {
        await callback({
          text: `Trust check failed (fail-open): ${messageText}`,
          actions: [],
        });
      }
      return { success: false, error: messageText };
    }
  },
  examples: [
    [
      {
        name: "user",
        content: { text: "Check trust for agent 6888 on eth" },
      } as ActionExample,
      {
        name: "assistant",
        content: { text: "Checking 8K4 trust score for agent 6888.", actions: ["CHECK_AGENT_TRUST"] },
      } as ActionExample,
    ],
  ],
};
