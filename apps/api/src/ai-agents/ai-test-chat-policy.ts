export interface RuntimePolicy {
  id: string;
  title: string;
  policy_type: 'allowed_topics' | 'disallowed_actions' | 'data_access_scope' | 'response_style';
  rules: Record<string, unknown>;
}

export interface PolicyResult {
  id: string;
  title: string;
  type: RuntimePolicy['policy_type'];
  result: 'applied' | 'blocked';
}

/** Explicit term matching is intentionally conservative; no model-generated permission decision. */
export function evaluatePolicies(policies: RuntimePolicy[], message: string) {
  const normalized = message.toLocaleLowerCase();
  const results: PolicyResult[] = [];
  const instructions: string[] = [];
  let blocked = false;
  let scopes: Set<string> | null = null;
  let maxLength: number | null = null;
  for (const policy of policies) {
    const terms = (value: unknown) =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
    let denied = false;
    switch (policy.policy_type) {
      case 'allowed_topics': {
        const topics = terms(policy.rules.topics);
        denied =
          !topics.length || !topics.some((topic) => normalized.includes(topic.toLocaleLowerCase()));
        break;
      }
      case 'disallowed_actions':
        denied = terms(policy.rules.actions).some((action) =>
          normalized.includes(action.toLocaleLowerCase())
        );
        break;
      case 'data_access_scope': {
        const allowed = new Set(terms(policy.rules.scopes));
        const current = scopes as Set<string> | null;
        scopes =
          current === null || current.has('all')
            ? allowed
            : allowed.has('all')
              ? current
              : new Set([...current].filter((item) => allowed.has(item)));
        break;
      }
      case 'response_style': {
        const tone = typeof policy.rules.tone === 'string' ? policy.rules.tone : '';
        const language = typeof policy.rules.language === 'string' ? policy.rules.language : '';
        if (tone) instructions.push(`Use this response tone: ${tone.slice(0, 200)}.`);
        if (language) instructions.push(`Respond in ${language.slice(0, 50)}.`);
        const length = policy.rules.maxLength;
        if (typeof length === 'number' && Number.isInteger(length) && length > 0)
          maxLength = Math.min(maxLength ?? length, length);
        break;
      }
    }
    blocked ||= denied;
    results.push({
      id: policy.id,
      title: policy.title,
      type: policy.policy_type,
      result: denied ? 'blocked' : 'applied',
    });
  }
  return { blocked, results, instructions, scopes, maxLength };
}
