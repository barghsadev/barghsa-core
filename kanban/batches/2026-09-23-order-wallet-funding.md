# Order wallet funding prompt batch

Canonical scope: `03-core-business.md#T-03.90.02`.

The simple electricity, advanced electricity, and saving-order review screens already show a wallet balance and use the wallet invoice payment flow after order submission. They now also compare that balance with the quoted total. When it is insufficient, the screen states the shortfall and links to the wallet page, where online top-up and bank receipt submission are available. When the balance cannot be loaded, it directs the customer to check the wallet before paying. A sufficient balance needs no prompt.

Validation: the shared prompt test covers shortfall, funding route, and sufficient balance. Existing electricity and saving order UI tests, root build, typecheck, lint, and formatting were run.
