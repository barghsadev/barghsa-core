/** The command and financial owner are part of the confirmation hash. */
export interface FinancialReviewScope {
  action: string;
  profileId: string;
  resourceId: string;
}

/** Money in command-specific data must use exact decimal strings. */
export interface FinancialReviewSnapshot<T extends object = Record<string, unknown>> {
  schemaVersion: 1;
  scope: FinancialReviewScope;
  data: T;
  hash: string;
}
