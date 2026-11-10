export const PASSWORD_MIN_LENGTH = 8;
export const REPLACEMENT_PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_REQUIRED_CLASSES = [/[a-z]/, /[A-Z]/, /[0-9]/] as const;

export function meetsPasswordMinimum(value: string): boolean {
  return (
    value.length >= PASSWORD_MIN_LENGTH &&
    PASSWORD_REQUIRED_CLASSES.every((pattern) => pattern.test(value))
  );
}

export function meetsReplacementPasswordPolicy(value: string): boolean {
  return value.length <= REPLACEMENT_PASSWORD_MAX_LENGTH && meetsPasswordMinimum(value);
}
