function cost(name: string, minimum: number, maximum: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return minimum;

  const number = Number(value);
  if (!/^\d+$/.test(value) || number < minimum || number > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
}

/** Password creation policy from T-02.01.02. memoryCost is measured in KiB. */
export const PASSWORD_HASH_OPTIONS = Object.freeze({
  type: 2 as const, // Argon2id
  version: 0x13,
  memoryCost: cost('PASSWORD_ARGON2_MEMORY_KIB', 37 * 1024, 64 * 1024),
  timeCost: cost('PASSWORD_ARGON2_ITERATIONS', 3, 6),
  parallelism: cost('PASSWORD_ARGON2_PARALLELISM', 1, 2),
  hashLength: 32,
});
