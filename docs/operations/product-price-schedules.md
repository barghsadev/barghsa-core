# Product price schedules

Deploy production migration 0114 before the API revision that reads `effective_product_price`. The migration adds a read function and preserves every product and price-history row.

Catalogue list/detail, the public active-product list, order gift-code calculations, green-product activation checks and automatic invoice creation resolve the effective version. An effective interval includes its start and excludes its end. Invoice creation supplies its calculation timestamp so its price and VAT snapshots use the same instant. Existing invoices retain their stored amounts.

Before the first historical price starts, the function uses the legacy `products.price` value. This keeps an existing unversioned product usable while its first future change is scheduled. Once price history has started, a gap or expired final interval yields no price. It does not revive the legacy value to conceal an invalid history.

`products.price` remains the legacy/current-write cache; it is not the authority for reading scheduled prices. Reads apply a schedule without waiting for a worker to copy values into that column. New pricing consumers must call the resolver with their calculation timestamp instead of reading the column directly.

Historical reconstruction before the first price version is limited to the retained legacy value. The migration cannot recover prices that were changed without history. Keep price-history backups and investigate gaps before repairing them; do not delete versions to force fallback pricing.
