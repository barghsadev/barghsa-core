CREATE TABLE "rate_limit_windows" (
	"security" boolean NOT NULL,
	"key" text NOT NULL,
	"window_ms" integer NOT NULL,
	"events" bigint[] NOT NULL,
	"capacity" integer NOT NULL,
	"overflow_until" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	CONSTRAINT "rate_limit_windows_security_key_window_ms_pk" PRIMARY KEY("security","key","window_ms")
);
--> statement-breakpoint
CREATE INDEX "rate_limit_windows_expiry_idx" ON "rate_limit_windows" USING btree ("expires_at");
--> statement-breakpoint
-- Drain old API and worker writers before switching to rolling enforcement.
-- VOLATILE gives internal statements fresh READ COMMITTED snapshots after the
-- lock. A single outer SELECT/SUM would miss writers that committed while waiting.
CREATE FUNCTION rate_limit_rolling(p_security boolean, p_key text, p_window integer,
                                  p_limit integer, p_increment boolean)
RETURNS TABLE(count integer, reset_ms bigint)
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  state rate_limit_windows%ROWTYPE;
  legacy record;
  history bigint[] := '{}';
  now_ms bigint;
  stamp bigint;
  overflow bigint := 0;
  cap integer;
  n integer;
  legacy_table text := CASE WHEN p_security THEN 'security_rate_limit_counters' ELSE 'rate_limit_counters' END;
BEGIN
  IF p_window IS NULL OR p_window < 1 OR p_key IS NULL OR p_security IS NULL
     OR p_increment IS NULL OR (p_increment AND p_limit IS NULL)
     OR (p_limit IS NOT NULL AND (p_limit < 1 OR p_limit > 100000)) THEN
    RAISE EXCEPTION 'Invalid rolling rate-limit parameters';
  END IF;
  -- All windows of a key share the reset lock. Hash collisions only serialize.
  PERFORM pg_advisory_xact_lock(hashtextextended(current_schema() || ':' || p_security::text || ':' || p_key, 0));
  SELECT * INTO state FROM rate_limit_windows w
    WHERE w.security=p_security AND w.key=p_key AND w.window_ms=p_window FOR UPDATE;
  now_ms := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  cap := COALESCE(p_limit + 1, state.capacity, 11);
  SELECT COALESCE(array_agg(t ORDER BY t), '{}') INTO history
    FROM unnest(state.events) t WHERE t > now_ms - p_window;
  overflow := COALESCE(state.overflow_until, 0);
  -- Truncated attempts cannot affect the old quota, but could affect an increased
  -- quota. Carry them conservatively until their last possible expiry.
  IF cap > state.capacity AND overflow > now_ms THEN
    history := history || array_fill(overflow - p_window, ARRAY[cap]);
  END IF;
  -- Legacy buckets have no attempt times. Use the latest possible instant,
  -- including legacy application clock skew, instead of resetting protection.
  FOR legacy IN EXECUTE format('DELETE FROM %I WHERE key=$1 AND window_ms=$2 RETURNING *', legacy_table)
    USING p_key, p_window LOOP
    IF legacy.count IS NULL OR legacy.count < 1 THEN
      RAISE EXCEPTION 'Invalid legacy rate-limit counter';
    END IF;
    stamp := GREATEST(legacy.window_start + legacy.window_ms - 1,
                     floor(extract(epoch FROM legacy.updated_at) * 1000)::bigint);
    IF stamp > now_ms - p_window THEN
      history := history || array_fill(stamp, ARRAY[LEAST(legacy.count, cap)]);
      IF legacy.count > cap THEN overflow := GREATEST(overflow, stamp + p_window); END IF;
    END IF;
  END LOOP;
  IF p_increment THEN history := array_append(history, now_ms); END IF;
  SELECT COALESCE(array_agg(t ORDER BY t), '{}') INTO history FROM unnest(history) t;
  n := cardinality(history);
  IF n > cap THEN
    overflow := GREATEST(overflow, history[n-cap] + p_window);
    history := history[n-cap+1:n];
  END IF;
  n := cardinality(history);
  INSERT INTO rate_limit_windows(security,key,window_ms,events,capacity,overflow_until,expires_at)
    VALUES(p_security,p_key,p_window,history,cap,overflow,
           GREATEST(COALESCE(history[n] + p_window, now_ms), overflow))
    ON CONFLICT(security,key,window_ms) DO UPDATE SET
      events=EXCLUDED.events, capacity=EXCLUDED.capacity,
      overflow_until=EXCLUDED.overflow_until, expires_at=EXCLUDED.expires_at;
  -- A new admission requires fewer than limit live attempts.
  RETURN QUERY SELECT n, CASE WHEN n=0 THEN 0::bigint ELSE
    GREATEST(0::bigint, history[GREATEST(1,n-COALESCE(p_limit,n)+1)] + p_window - now_ms) END;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION rate_limit_rolling_reset(p_security boolean, p_key text)
RETURNS void LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(current_schema() || ':' || p_security::text || ':' || p_key, 0));
  DELETE FROM rate_limit_windows WHERE security=p_security AND key=p_key;
  IF p_security THEN
    DELETE FROM security_rate_limit_counters WHERE key=p_key;
  ELSE
    DELETE FROM rate_limit_counters WHERE key=p_key;
  END IF;
END;
$$;
