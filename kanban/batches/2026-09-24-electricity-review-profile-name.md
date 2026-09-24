# Electricity review profile identity

Canonical scope: the customer review in `03-core-business.md#T-03.05.04.05`.

The final simple electricity review now shows the active buyer's readable name as well as the profile ID, so the customer can confirm the ordering identity before submitting. The existing authorized profile query supplies the name: an individual's title and name, or a legal profile's registered name. Switching an agent's active legal profile changes the review identity. Older verification responses still show the profile ID.

Validation: profile HTTP and service suites (51 tests), the five-project customer-to-staff electricity browser journey, API and web typechecks, changed-file ESLint and Prettier, API build, and canonical backlog validation. The browser uses controlled API responses; the HTTP integration suite checks profile access and switching against the database.
