-- Migration: 0000_init_uuidv7_function
-- Version: 1 (up)
-- Description: Create uuid_generate_v7() PostgreSQL function for
--              UUIDv7 primary keys with time-sortable values.
--
-- UUIDv7 (RFC 9562) encodes the current Unix timestamp in milliseconds
-- (48 bits) followed by random bits (74 bits), providing time-sortable
-- values that cluster well in B-tree indexes. This reduces index
-- fragmentation compared to UUIDv4 and eliminates the need for
-- sequence-based IDs.
--
-- Layout:
--   0                   1                   2                   3
--   0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
--  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
--  |                           unix_ts_ms                          |
--  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
--  |          unix_ts_ms           |  ver  |       rand_a          |
--  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
--  |var|                        rand_b                             |
--  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
--  |                            rand_b                             |
--  +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.uuid_generate_v7();

-- Ensure pgcrypto extension is available for gen_random_bytes().
-- WITH SCHEMA public pins the extension objects to a fixed schema: without
-- it, PG installs the extension into the first schema of the creating
-- connection's search_path, so `CREATE EXTENSION IF NOT EXISTS` from an
-- isolated test schema makes gen_random_bytes invisible to every other
-- schema (order-dependent test flake — see uuidv7-migration.test.ts CI
-- history). Pinning to public keeps it resolvable from any search_path.
--
-- The advisory transaction lock serializes concurrent `CREATE EXTENSION`
-- attempts: parallel test workers (both API integration suites apply this
-- migration) race on pg_extension_name_index inside `IF NOT EXISTS`
-- otherwise (duplicate key value violates unique constraint
-- "pg_extension_name_index"). The lock makes the second waiter a no-op.
-- IMPORTANT: this file must be applied as a single multi-statement SQL
-- request (pg uses one implicit transaction for the whole string), so the
-- advisory lock is held through CREATE EXTENSION. A per-statement applier
-- would release the lock between statements and restore the race.
SELECT pg_advisory_xact_lock(hashtext('barghsa.pgcrypto'));
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

CREATE OR REPLACE FUNCTION public.uuid_generate_v7()
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
PARALLEL SAFE
AS $$
DECLARE
  ms        BIGINT;
  ts_bytes  BYTEA;
  rnd_bytes BYTEA;
BEGIN
  -- Use clock_timestamp() so concurrent calls in the same transaction
  -- each get a distinct timestamp, preserving monotonic ordering.
  ms := floor(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT;

  -- Convert the 48-bit timestamp to 6 bytes (big-endian).
  -- int8send returns 8 bytes; take the last 6 (low 48 bits).
  ts_bytes := substring(int8send(ms) FROM 3);

  -- 10 bytes of randomness (80 bits); we only need 74 random bits
  -- (4 + 8 + 6 + 56 = 74), so the unused bits are overwritten by
  -- version and variant fields below.
  rnd_bytes := gen_random_bytes(10);

  -- Set the UUID version (bits 48-51 = 0111 = 7).
  -- rnd_bytes[0] corresponds to the high nibble of UUID byte 6.
  -- Keep the low nibble as random (4 bits).
  rnd_bytes := set_byte(
    rnd_bytes,
    0,
    (get_byte(rnd_bytes, 0) & 15) | 112  -- 0x70 = 0111 0000
  );

  -- Set the RFC 4122 variant (bits 64-65 = 10).
  -- rnd_bytes[2] corresponds to UUID byte 8.
  rnd_bytes := set_byte(
    rnd_bytes,
    2,
    (get_byte(rnd_bytes, 2) & 63) | 128  -- 0x80 = 1000 0000
  );

  -- Concatenate: 6 bytes timestamp + 10 bytes random = 16 bytes = UUID.
  RETURN (encode(ts_bytes || rnd_bytes, 'hex'))::uuid;
END;
$$;