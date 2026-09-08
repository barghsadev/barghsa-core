/** Password creation policy from T-02.01.02. memoryCost is measured in KiB. */
export const PASSWORD_HASH_OPTIONS = Object.freeze({
  type: 2 as const, // Argon2id
  version: 0x13,
  memoryCost: 37 * 1024,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
});
