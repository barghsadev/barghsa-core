-- Migration: 0001_down_uuidv7_function
-- Version: 1 (down)
-- Description: Revert uuid_generate_v7() migration.
--
-- Drops the function created by 0000_init_uuidv7_function.sql.
-- Does NOT drop the pgcrypto extension because it may have been
-- installed independently or be used by other objects.
-- PostgreSQL handles this safely: DROP EXTENSION ... IF EXISTS
-- would fail if other objects depend on it, so we leave it in place.

DROP FUNCTION IF EXISTS public.uuid_generate_v7();