export type PublicConfidence = "minimal" | "low" | "medium" | "high" | string;
export type TrustTier = "new" | "minimal" | "low" | "medium" | "high" | string;
export type ScoreTier = string;

export interface PublicTrustFields {
  score_tier: ScoreTier;
  trust_tier: TrustTier;
  confidence: PublicConfidence;
  adjusted: boolean;
  adjustment_reasons: string[];
}

export interface ScorePublicResponse extends PublicTrustFields {
  agent_id: number;
  chain: string;
  global_id: string;
  score: number;
  validator_count_bucket: string;
  as_of: string;
  disclaimer: string;
}

export interface ScoreExplainResponse extends ScorePublicResponse {
  positives: string[];
  cautions: string[];
}

// Best-effort typing: wallet score response fields are not fully verified against the live API yet.
export interface WalletScoreResponse {
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

export interface AgentSearchItem {
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

export interface TrustCheckResult {
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
