# Financial administration settings

Electricity configuration retains the existing admin pages. `/admin/electricity-rules`
contains independent simple and advanced green rules, activation safety, thresholds
and percentage sliders. `/admin/contract-limits` contains the maximum duration,
lead time and customer quantity increase percentage. The wallet receipt workspace
contains the online top-up limit, including the approved zero-limit kill switch.
These controls retain their existing permissions, confirmation and receipt checks.
The settings navigation offers electricity rules and contract limits; wallet limits
remain alongside their financial operations workspace.

VAT product overrides are enabled by adding an effective-dated assignment and
disabled by ending its effective window. The UI uses explicit add/end actions
instead of mutating a historical assignment's boolean flag. The rate and override
tables retain historical windows. New rates can be scheduled in the account's
timezone, with validation of invalid local times. Submitted financial snapshots
retain their original rates.

Gift codes retain the approved names, routes and redemption ledger. The admin
editor preserves exact IRR strings and rejects percentage rounding. Unverified
gift-code outcomes hold the draft until a fresh read and explicit recovery.
Statistics distinguish consumed and released redemptions; changing a code's
active status does not rewrite that history.
