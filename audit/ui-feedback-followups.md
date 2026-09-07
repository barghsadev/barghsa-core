# UI feedback follow-up

Status: reproduced, not repaired.

The app calls Sonner toast notifications in registration, profile and order flows, but no Toaster is mounted in the application source. A standalone Chromium check against the production build used a controlled successful registration-verification response. It recorded one verification request and the expected redirect to `/`, but zero toast containers and no visible toast. No real account or external provider was used.

The UI package also exports the Sonner Toaster alongside a toast manager from a different Base UI implementation. Current application callers import toast directly from Sonner, so the missing app renderer is the demonstrated application defect. Review the public UI export pairing separately before certifying it.

Next: wire a localized, theme-aware renderer, avoid duplicate feedback where inline messages already exist, prove success/error feedback through real browser interactions, and rerun route budgets. Do not mark this finding closed from source inspection alone.
