import type { Evaluator, IAgentRuntime, Memory, State } from "@elizaos/core";
import { resolveEightK4Config } from "../config";
import { TrustService } from "../services/trust-service";
import { extractTrustTargets } from "../input-policy";

function getText(message: Memory): string {
  if (typeof message.content === "string") return message.content;
  return typeof message.content?.text === "string" ? message.content.text : "";
}

export const extractTargets = extractTrustTargets;

function shouldWarnOrBlock(
  score: number,
  trustTier: string | undefined,
  riskBand: string | undefined,
  cautionThreshold: number,
  blockThreshold: number,
): { caution: boolean; block: boolean } {
  const normalizedTier = (trustTier ?? "").toLowerCase();
  const normalizedBand = (riskBand ?? "").toLowerCase();

  const lowTrust = normalizedTier === "low";
  const minimalTrust = normalizedTier === "minimal" || normalizedTier === "new";
  const legacyHighRisk = normalizedBand.includes("high") || normalizedBand.includes("critical");

  return {
    caution: score < cautionThreshold || lowTrust || minimalTrust || legacyHighRisk,
    block: score < blockThreshold || minimalTrust || legacyHighRisk,
  };
}

function enforcementFailure(
  runtime: IAgentRuntime,
  config: ReturnType<typeof resolveEightK4Config>,
  reason: string,
  error?: unknown,
) {
  const details = error instanceof Error ? error.message : error ? String(error) : "";
  const suffix = details ? `: ${details}` : "";
  runtime.logger?.error?.(
    `[8k4-trust] Trust guard enforcement failed (${config.guardMode}/${config.guardFailMode}) ${reason}${suffix}`,
  );

  if (config.guardFailMode === "closed") {
    return {
      blocked: true,
      reason: `Blocked by trust guard: enforcement failure (${reason}${suffix})`,
    };
  }

  return {
    blocked: false,
    reason: `Trust guard enforcement failed (fail-open): ${reason}${suffix}`,
  };
}

function describeTrust(score: {
  score: number;
  trust_tier?: string;
  risk_band?: string;
  confidence?: string;
  confidence_tier?: string;
}): string {
  const parts = [
    `score=${score.score}`,
    `trust_tier=${score.trust_tier ?? "unknown"}`,
  ];

  if (score.risk_band) {
    parts.push(`risk_band=${score.risk_band}`);
  }

  parts.push(`confidence=${score.confidence ?? score.confidence_tier ?? "unknown"}`);
  return parts.join(" ");
}

const trustGuardEvaluatorImpl = {
  name: "8k4_trust_guard",
  description:
    "Pre-evaluator that checks 8K4 trust before agent-to-agent interactions and warns/blocks based on configured policy.",
  similes: ["trust guard", "agent trust gate", "pre trust check"],
  examples: [],
  phase: "pre",
  alwaysRun: true,
  validate: async (runtime: IAgentRuntime, message: Memory) => {
    const config = resolveEightK4Config(runtime);
    if (config.guardMode === "off") return false;
    const text = getText(message);
    const { wallets, agentIds } = extractTargets(text);
    return wallets.length > 0 || agentIds.length > 0;
  },
  handler: async (runtime: IAgentRuntime, message: Memory, _state?: State): Promise<any> => {
    const config = resolveEightK4Config(runtime);
    if (config.guardMode === "off") {
      return { blocked: false };
    }

    const trust = runtime.getService<TrustService>(TrustService.serviceType);
    if (!trust) {
      return enforcementFailure(runtime, config, "trust service unavailable");
    }

    const text = getText(message);
    const { wallets, agentIds } = extractTargets(text);

    try {
      for (const wallet of wallets.slice(0, 2)) {
        const score = await trust.checkWalletTrust(wallet, config.defaultChain);
        const decision = shouldWarnOrBlock(
          score.score,
          score.trust_tier,
          score.risk_band,
          config.guardCautionThreshold,
          config.guardBlockThreshold,
        );

        if (config.guardMode === "block" && decision.block) {
          return {
            blocked: true,
            reason: `Blocked by trust guard: wallet ${wallet} ${describeTrust(score)}`,
          };
        }

        if (decision.caution) {
          return {
            blocked: false,
            rewrittenText:
              `[TRUST-GUARD WARNING] wallet=${wallet} ${describeTrust(score)}\n` +
              text,
            reason: "Trust guard caution",
          };
        }
      }

      for (const agentId of agentIds.slice(0, 2)) {
        const score = await trust.checkTrust(agentId, config.defaultChain, false);
        const decision = shouldWarnOrBlock(
          score.score,
          score.trust_tier,
          score.risk_band,
          config.guardCautionThreshold,
          config.guardBlockThreshold,
        );

        if (config.guardMode === "block" && decision.block) {
          return {
            blocked: true,
            reason: `Blocked by trust guard: agent_id=${agentId} ${describeTrust(score)}`,
          };
        }

        if (decision.caution) {
          return {
            blocked: false,
            rewrittenText:
              `[TRUST-GUARD WARNING] agent_id=${agentId} ${describeTrust(score)}\n` +
              text,
            reason: "Trust guard caution",
          };
        }
      }
    } catch (error) {
      return enforcementFailure(runtime, config, "lookup error", error);
    }

    return { blocked: false };
  },
};

export const trustGuardEvaluator = trustGuardEvaluatorImpl as Evaluator;
