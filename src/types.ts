export type PublicConfidence = "minimal" | "low" | "medium" | "high" | "unknown" | string;
export type TrustTier = "new" | "minimal" | "low" | "medium" | "high" | "unknown" | string;
export type ScoreTier = string;
export type LegacyConfidenceTier = "Minimal" | "Low" | "Medium" | "High" | "Unknown" | string;
export type LegacyRiskBand = "low" | "medium" | "high" | "critical" | "unknown" | string;

export interface LegacyTrustAliases {
  // Transitional aliases preserved for downstream mixed-version consumers.
  risk_band?: LegacyRiskBand;
  confidence_tier?: LegacyConfidenceTier;
}

export interface LegacyAdjustmentAliases {
  // Transitional aliases preserved for downstream mixed-version consumers.
  promotion_cap_applied?: boolean;
  promotion_cap_reasons?: string[];
}

export interface PublicTrustFields {
  score_tier: ScoreTier;
  trust_tier: TrustTier;
  confidence: PublicConfidence;
  adjusted: boolean;
  adjustment_reasons: string[];
}

export interface ScorePublicResponse extends PublicTrustFields, LegacyTrustAliases {
  agent_id: number;
  chain: string;
  global_id: string;
  score: number;
  validator_count_bucket: string;
  as_of: string;
  disclaimer: string;
}

export interface ScoreExplainResponse extends ScorePublicResponse, LegacyAdjustmentAliases {
  candidate_tier?: ScoreTier;
  final_tier?: ScoreTier;
  promotion_cap_to?: string | null;
  positives: string[];
  cautions: string[];
}

// Best-effort typing: wallet score response fields are not fully verified against the live API yet.
export interface WalletScoreResponse extends LegacyTrustAliases, LegacyAdjustmentAliases {
  wallet: string;
  chain?: string;
  score: number;
  score_tier?: ScoreTier;
  trust_tier?: TrustTier;
  confidence?: PublicConfidence;
  adjusted?: boolean;
  adjustment_reasons?: string[];
  as_of?: string;
  disclaimer?: string;
  [key: string]: unknown;
}

export interface AgentSearchItem extends LegacyTrustAliases, LegacyAdjustmentAliases {
  agent_id: number;
  rank?: number;
  wallet?: string;
  chain?: string;
  global_id?: string;
  score?: number;
  score_tier?: ScoreTier;
  trust_tier?: TrustTier;
  confidence?: PublicConfidence;
  adjusted?: boolean;
  adjustment_reasons?: string[];
  contactable?: boolean;
  [key: string]: unknown;
}

export type AgentSearchResponse =
  | AgentSearchItem[]
  | {
      items?: AgentSearchItem[];
      agents?: AgentSearchItem[];
      results?: AgentSearchItem[];
      total?: number;
      [key: string]: unknown;
    };

export type TopAgentsResponse = AgentSearchItem[];

export interface TrustCheckResult extends LegacyTrustAliases, LegacyAdjustmentAliases {
  kind: "agent" | "wallet";
  score: number;
  chain?: string;
  score_tier?: ScoreTier;
  trust_tier?: TrustTier;
  confidence?: PublicConfidence;
  adjusted?: boolean;
  adjustment_reasons?: string[];
  raw: ScorePublicResponse | ScoreExplainResponse | WalletScoreResponse;
}
