# Solar site-address return — September 24, 2026

Canonical scope: non-household site address entry in `03-core-business.md#T-03.11.02.03` and resumable request progress in `T-03.90.17`.

When a customer starts a non-household solar request without a saved site address, the form saves its current draft before opening address settings. Settings now offers a bilingual return link for that solar request. On return, the saved site details remain intact and the newly added address is selected even when the older draft had no address ID. The customer can submit the request with that address without re-entering the site details. The return destination is restricted to known customer routes.

Validation: the existing solar intake tests, both solar browser journeys across five browser projects (10 cases), web and dictionary typechecks, dictionary tests, targeted lint and formatting, production web build, and backlog validation.
