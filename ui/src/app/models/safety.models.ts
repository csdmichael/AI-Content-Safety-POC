/**
 * NEW FILE — safety.models.ts
 * TypeScript interfaces for the Agent Safety API responses.
 */

export interface PromptInjectionResult {
  injection_detected: boolean;
  confidence: number;
  matched_patterns: { pattern_name: string; matched_text: string }[];
  risk_level: 'none' | 'low' | 'medium' | 'high';
  recommendation: string;
}

export interface PolicyCheckResult {
  passed: boolean;
  violations: { keyword: string; position: number }[];
  enforcement: 'block' | 'warn';
}

export interface ToolValidationResult {
  valid: boolean;
  issues: string[];
  severity: 'warn' | 'error';
}

export interface TaskAdherenceResult {
  score: number;
  input_keywords: string[];
  response_keywords: string[];
  matched_keywords: string[];
  issues: string[];
}

export interface ContextDriftResult {
  drift_score: number;
  similarity: number;
  drifted: boolean;
  issues: string[];
}

export interface SafetyMetadata {
  injection_check: PromptInjectionResult;
  policy_check: PolicyCheckResult;
  tool_issues: { tool: string; source: string; issue: string }[];
  task_adherence: TaskAdherenceResult;
  context_drift: ContextDriftResult;
  overall_safe: boolean;
}

export interface AgentGuardResult {
  response: string;
  safety: SafetyMetadata;
}

export interface SafetyStatusResponse {
  enabled: boolean;
  task_adherence_threshold: number;
  context_drift_threshold: number;
  policy: {
    blocked_keywords_count: number;
    restricted_tools: string[];
    max_severity: number;
    enforcement_mode: string;
  };
  allowed_tools: Record<string, string[]>;
}
