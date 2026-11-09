# Password hashing and calibration

The API and database bootstrap use the same Argon2id password creation settings. The defaults are 37 MiB, three passes and one lane. Each hash has a fresh random salt. The encoded hash carries its own parameters, so changing the policy for new passwords leaves existing hashes verifiable. [Argon2 parameter guidance](https://www.rfc-editor.org/rfc/rfc9106.html#section-4).

| Environment variable          | Default | Allowed integer range |
| ----------------------------- | ------: | --------------------: |
| `PASSWORD_ARGON2_MEMORY_KIB`  |   37888 |           37888–65536 |
| `PASSWORD_ARGON2_ITERATIONS`  |       3 |                   3–6 |
| `PASSWORD_ARGON2_PARALLELISM` |       1 |                   1–2 |

Leave the variables unset to use the defaults. Out-of-range values prevent the process from loading the policy. If changing the defaults for an environment, use the same values for the API and the database bootstrap process.

Build the shared package before running the benchmark. It uses synthetic input and reports hash and verification latency, four concurrent verifications and peak process memory.

```sh
pnpm --filter @barghsa/shared build
node apps/api/scripts/benchmark-password-hash.mjs
PASSWORD_ARGON2_MEMORY_KIB=65536 node apps/api/scripts/benchmark-password-hash.mjs
```

For a packaged runtime, mount the script read-only beside the API's package manifest in an isolated container under the intended CPU and memory limits. Before increasing any cost, verify peak memory and the login latency and error budgets under the expected concurrent load. Keep the existing defaults until that rehearsal passes.

The isolated staging runtime measured 365 ms p95 verification at the default settings and 663 ms at the upper configuration bounds. Peak process memory was roughly 179 MiB and 308 MiB respectively across the sequential and concurrent tests. These measurements cover the hashing process with synthetic input. The production login request budget is checked separately.

The explicit staff temporary-password flow shows the generated password once to the authorized, recently verified creator. The create response is private and uncached, and staff readback omits the credential. The password hash is stored and the recipient must replace the password before a session can be issued. The activation-link flow uses the restricted delivery queue.
