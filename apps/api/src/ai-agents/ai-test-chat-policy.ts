import type { PolicyType } from '../ai-policies/ai-policies.service.js';
import { rulesSchemas } from '../ai-policies/ai-policies.rules.js';

export interface RuntimePolicy {
  id: string;
  title: string;
  policy_type: PolicyType;
  priority: number;
  rules: Record<string, unknown>;
}

export interface PolicyResult {
  id: string;
  title: string;
  type: PolicyType;
  priority: number;
  result: 'applied' | 'blocked';
  ruleChecks?: {
    rule:
      | 'topics'
      | 'actions'
      | 'inputFilter'
      | 'outputFilter'
      | 'scopes'
      | 'tone'
      | 'language'
      | 'maxLength'
      | 'requireSources'
      | 'format'
      | 'rateLimit';
    outcome: 'matched' | 'passed' | 'applied' | 'overridden' | 'blocked';
  }[];
}

export interface PolicyEvaluation {
  blocked: boolean;
  reason: string | null;
  policyRef: string | null;
  results: PolicyResult[];
  instructions: string[];
  scopes: Set<string> | null;
  maxLength: number | null;
  maxLengthPolicyId: string | null;
  requireSourcesPolicyId: string | null;
  outputFormat: { format: 'plain_text' | 'json_object'; policyId: string } | null;
  outputFilters: Array<{ policyId: string; terms: string[] }>;
  rateLimits: Array<{ policyId: string; maxRequests: number; windowSeconds: number }>;
}

/** Merge in explicit priority order. Denials compose; style/format choose the first rule. */
export function evaluatePolicies(policies: RuntimePolicy[], message: string): PolicyEvaluation {
  const normalized = message.toLocaleLowerCase();
  const sorted = [...policies].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const results: PolicyResult[] = [];
  const instructions: string[] = [];
  const outputFilters: PolicyEvaluation['outputFilters'] = [];
  const rateLimits: PolicyEvaluation['rateLimits'] = [];
  let reason: string | null = null;
  let policyRef: string | null = null;
  let scopes: Set<string> | null = null;
  let maxLength: number | null = null;
  let maxLengthPolicyId: string | null = null;
  let requireSourcesPolicyId: string | null = null;
  let outputFormat: PolicyEvaluation['outputFormat'] = null;
  let toneSelected = false;
  let languageSelected = false;

  for (const policy of sorted) {
    const ruleChecks: NonNullable<PolicyResult['ruleChecks']> = [];
    const parsed = rulesSchemas[policy.policy_type].safeParse(policy.rules);
    let denied: string | null = parsed.success ? null : 'policy_invalid';
    if (parsed.success) {
      const rules = parsed.data as Record<string, unknown>;
      const terms = (key: string) => rules[key] as string[];
      switch (policy.policy_type) {
        case 'allowed_topics':
          if (!terms('topics').some((topic) => normalized.includes(topic.toLocaleLowerCase())))
            denied = 'topic_not_allowed';
          ruleChecks.push({ rule: 'topics', outcome: denied ? 'blocked' : 'matched' });
          break;
        case 'disallowed_actions':
          if (terms('actions').some((action) => normalized.includes(action.toLocaleLowerCase())))
            denied = 'action_disallowed';
          ruleChecks.push({ rule: 'actions', outcome: denied ? 'blocked' : 'passed' });
          break;
        case 'content_filter': {
          const blockedTerms = terms('blockedTerms');
          if (blockedTerms.some((term) => normalized.includes(term.toLocaleLowerCase())))
            denied = 'input_filtered';
          ruleChecks.push({ rule: 'inputFilter', outcome: denied ? 'blocked' : 'passed' });
          outputFilters.push({ policyId: policy.id, terms: blockedTerms });
          break;
        }
        case 'data_access_scope': {
          const allowed = new Set(terms('scopes'));
          const current = scopes as Set<string> | null;
          scopes =
            current === null || current.has('all')
              ? allowed
              : allowed.has('all')
                ? current
                : new Set([...current].filter((item) => allowed.has(item)));
          if (scopes.size === 0) denied = 'data_scope_empty';
          ruleChecks.push({ rule: 'scopes', outcome: denied ? 'blocked' : 'applied' });
          break;
        }
        case 'response_style': {
          const tone = rules.tone as string;
          const language = rules.language as string | undefined;
          ruleChecks.push({ rule: 'tone', outcome: toneSelected ? 'overridden' : 'applied' });
          if (!toneSelected) {
            instructions.push(`Use this response tone: ${tone}.`);
            toneSelected = true;
          }
          if (language && !languageSelected) {
            instructions.push(`Respond in ${language}.`);
            languageSelected = true;
            ruleChecks.push({ rule: 'language', outcome: 'applied' });
          } else if (language) {
            ruleChecks.push({ rule: 'language', outcome: 'overridden' });
          }
          const length = rules.maxLength as number | undefined;
          if (length !== undefined) ruleChecks.push({ rule: 'maxLength', outcome: 'applied' });
          if (length !== undefined && (maxLength === null || length < maxLength)) {
            maxLength = length;
            maxLengthPolicyId = policy.id;
          }
          if (rules.requireSources === true && requireSourcesPolicyId === null)
            requireSourcesPolicyId = policy.id;
          if (rules.requireSources === true)
            ruleChecks.push({ rule: 'requireSources', outcome: 'applied' });
          break;
        }
        case 'output_format':
          ruleChecks.push({ rule: 'format', outcome: outputFormat ? 'overridden' : 'applied' });
          if (!outputFormat) {
            outputFormat = {
              format: rules.format as 'plain_text' | 'json_object',
              policyId: policy.id,
            };
            instructions.push(
              outputFormat.format === 'json_object'
                ? 'Return exactly one valid JSON object and no surrounding prose or code fence.'
                : 'Return plain text with no HTML or Markdown formatting.'
            );
          }
          break;
        case 'rate_limit':
          ruleChecks.push({ rule: 'rateLimit', outcome: 'applied' });
          rateLimits.push({
            policyId: policy.id,
            maxRequests: rules.maxRequests as number,
            windowSeconds: rules.windowSeconds as number,
          });
          break;
      }
    }
    if (denied && !reason) {
      reason = denied;
      policyRef = policy.id;
    }
    results.push({
      id: policy.id,
      title: policy.title,
      type: policy.policy_type,
      priority: policy.priority,
      result: denied ? 'blocked' : 'applied',
      ruleChecks,
    });
  }
  for (const result of results)
    for (const check of result.ruleChecks ?? []) {
      if (check.rule === 'maxLength')
        check.outcome = result.id === maxLengthPolicyId ? 'applied' : 'overridden';
      if (check.rule === 'requireSources')
        check.outcome = result.id === requireSourcesPolicyId ? 'applied' : 'overridden';
    }
  return {
    blocked: reason !== null,
    reason,
    policyRef,
    results,
    instructions,
    scopes,
    maxLength,
    maxLengthPolicyId,
    requireSourcesPolicyId,
    outputFormat,
    outputFilters,
    rateLimits,
  };
}

/** Validate the model's text before it can be shown or stored as a completed turn. */
export function evaluatePolicyOutput(
  evaluation: PolicyEvaluation,
  reply: string
): {
  blocked: boolean;
  reason: string | null;
  policyRef: string | null;
} {
  const normalized = reply.toLocaleLowerCase();
  for (const filter of evaluation.outputFilters)
    if (filter.terms.some((term) => normalized.includes(term.toLocaleLowerCase())))
      return { blocked: true, reason: 'output_filtered', policyRef: filter.policyId };
  if (evaluation.maxLength !== null && reply.length > evaluation.maxLength)
    return { blocked: true, reason: 'output_too_long', policyRef: evaluation.maxLengthPolicyId };
  if (evaluation.outputFormat?.format === 'json_object') {
    try {
      const value: unknown = JSON.parse(reply);
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return {
          blocked: true,
          reason: 'output_format_invalid',
          policyRef: evaluation.outputFormat.policyId,
        };
    } catch {
      return {
        blocked: true,
        reason: 'output_format_invalid',
        policyRef: evaluation.outputFormat.policyId,
      };
    }
  }
  if (
    evaluation.outputFormat?.format === 'plain_text' &&
    /<\/?[a-z][^>]*>|```|^\s{0,3}#{1,6}\s/m.test(reply)
  )
    return {
      blocked: true,
      reason: 'output_format_invalid',
      policyRef: evaluation.outputFormat.policyId,
    };
  return { blocked: false, reason: null, policyRef: null };
}
