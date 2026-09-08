import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import { dictionary as common, adjacencyGraphs } from '@zxcvbn-ts/language-common';
import { dictionary as english } from '@zxcvbn-ts/language-en';

export type StrengthLevel = 'weak' | 'fair' | 'good' | 'strong';
export interface StrengthResult {
  score: number;
  level: StrengthLevel;
}

// This module and its dictionaries load only when the strength meter is used.
// Estimation is local. The server's password policy remains authoritative.
const estimator = new ZxcvbnFactory({
  dictionary: { ...common, ...english },
  graphs: adjacencyGraphs,
  maxLength: 128,
});

export function evaluateStrength(password: string): StrengthResult {
  const { score } = estimator.check(password);
  const level = score < 2 ? 'weak' : score === 2 ? 'fair' : score === 3 ? 'good' : 'strong';
  return { score: score * 25, level };
}
