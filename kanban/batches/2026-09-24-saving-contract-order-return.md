# Saving contract to order return

Canonical scope: partial progress on `07-ui-ux-design.md#T-07.18.03.02`, the linked-order contract detail handoff.

An authorized customer viewing a published saving contract can now open its saving order. The contract response resolves the saving order's own ID from the contract's generic order ID and matches the profile; unpublished contracts remain inaccessible. Electricity contracts keep their existing electricity order link.

Validation: the PostgreSQL saving-order workflow test checks that the contract is hidden before publication and that its published response contains both order identities. The contract HTTP suite checks customer access behavior, and bilingual web tests check the saving route. Workspace checks run before push; GitHub CI runs on the pushed commit.
