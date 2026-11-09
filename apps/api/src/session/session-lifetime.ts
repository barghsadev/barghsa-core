function readLimit(name: string, maximum: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return maximum;

  const number = Number(value);
  if (!/^[1-9]\d*$/.test(value) || number > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}`);
  }
  return number;
}

export const SESSION_IDLE_TIMEOUT_MS = readLimit('SESSION_IDLE_TIMEOUT_MINUTES', 30) * 60_000;
export const SESSION_ABSOLUTE_TIMEOUT_MS =
  readLimit('SESSION_ABSOLUTE_TIMEOUT_HOURS', 24) * 3_600_000;
