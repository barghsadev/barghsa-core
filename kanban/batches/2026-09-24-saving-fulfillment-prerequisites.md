# Saving fulfillment prerequisites — September 24, 2026

Canonical scope: staff stage controls in `03-core-business.md#T-03.10.01.02`, consistent with the payment and contract guards already enforced by the saving fulfillment API.

Staff now see why an active delivery or completion stage cannot finish. Product delivery requires a paid invoice; process completion requires a paid invoice and an active or completed contract. The completion button stays disabled while a prerequisite is unmet, even after staff enter a progress note. English and Persian messages explain the required action. Other stages and the optional handover skip remain available under their existing rules.

The saving browser journey checks that an approved but unpaid order appears in the fulfillment lane with the payment explanation and a disabled delivery action. The backend remains authoritative for concurrent state changes.

Validation: focused saving browser journey in all five configured projects, web and i18n typechecks, targeted lint and formatting, dictionary tests, and backlog validation.
