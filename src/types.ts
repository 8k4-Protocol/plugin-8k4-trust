export type ConfidenceTier = "Minimal" | "Low" | "Medium" | "High" | string;

export interface ScorePublicResponse {
  agent_id: number;
  chain: string;
  global_id: string;
  score: number;
  confidence_tier: ConfidenceTier;
  risk_band: string;
  validator_count_bucket: string;
  as_of: string;
  disclaimer: string;
}

export interface ScoreExplainResponse {
  agent_id: number;
  chain: string;
  global_id: string;
  score: number;
  confidence_tier: ConfidenceTier;
  candidate_tier: string;
  final_tier: string;
  promotion_cap_applied: boolean;
  promotion_cap_to: string | null;
  promotion_cap_reasons: string[];
  risk_band: string;
  as_of: string;
  disclaimer: string;
  positives: string[];
  cautions: string[];
}

// Best-effort typing: wallet score response fields are not fully verified against the live API yet.
export interface WalletScoreResponse {
  wallet: string;
  chain?: string;
  score: number;
  confidence_tier?: string;
  risk_band?: string;
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
  confidence_tier?: string;
  risk_band?: string;
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
  risk_band?: string;
  confidence_tier?: string;
  raw: ScorePublicResponse | ScoreExplainResponse | WalletScoreResponse;
}
