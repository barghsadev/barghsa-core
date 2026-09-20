-- Resolve scheduled prices at read time; no background promotion or row rewrite.
CREATE OR REPLACE FUNCTION effective_product_price(product_uuid uuid, at_time timestamptz DEFAULT CURRENT_TIMESTAMP)
RETURNS bigint
LANGUAGE sql STABLE
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM product_price_versions v
      WHERE v.product_id = product_uuid AND v.effective_from <= at_time
    ) THEN (
      SELECT v.price FROM product_price_versions v
      WHERE v.product_id = product_uuid AND v.effective_from <= at_time
        AND (v.effective_until IS NULL OR v.effective_until > at_time)
      ORDER BY v.effective_from DESC LIMIT 1
    )
    ELSE (SELECT p.price FROM products p WHERE p.id = product_uuid)
  END
$$;
