import type { IAgentRuntime, Plugin } from "@elizaos/core";
import { checkTrustAction } from "./actions/check-trust";
import { findTrustedAgentAction } from "./actions/find-agent";
import { trustGuardEvaluator } from "./evaluators/trust-guard";
import { trustContextProvider } from "./providers/trust-context";
import { resolveEightK4Config } from "./config";
import { TrustService } from "./services/trust-service";

export { TrustService } from "./services/trust-service";
export * from "./types";
export * from "./config";

export const trustPlugin: Plugin = {
  name: "8k4-trust",
  description:
    "8K4 Protocol trust scoring plugin for ElizaOS. Adds trust checks, trusted-agent discovery, and pre-evaluator guardrails.",
  config: {
    EIGHTK4_API_KEY: null,
    EIGHTK4_API_BASE: "https://api.8k4protocol.com",
    EIGHTK4_DEFAULT_CHAIN: "eth",
    EIGHTK4_GUARD_MODE: "warn",
    EIGHTK4_GUARD_FAIL_MODE: null,
    EIGHTK4_GUARD_BLOCK_THRESHOLD: 30,
    EIGHTK4_GUARD_CAUTION_THRESHOLD: 60,
    EIGHTK4_CACHE_TTL_MS: 300000,
    EIGHTK4_CACHE_MAX_ENTRIES: 500,
    EIGHTK4_TIMEOUT_MS: 8000,
    EIGHTK4_ALLOW_CUSTOM_API_BASE: false,
  },
  init: async (_config: Record<string, string>, runtime: IAgentRuntime) => {
    const resolved = resolveEightK4Config(runtime);
    runtime.logger.info(
      `[8k4-trust] initialized: base=${resolved.apiBase}, defaultChain=${resolved.defaultChain}, guardMode=${resolved.guardMode}`,
    );
  },
  services: [TrustService],
  actions: [checkTrustAction, findTrustedAgentAction],
  evaluators: [trustGuardEvaluator],
  providers: [trustContextProvider],
};

export default trustPlugin;
