package ingest

// SQL kept in one place; logic lives in store.go / rollup.go / cycle.go.

const upsertStopSQL = `
	INSERT INTO stops (run_id, station_code, order_idx, tipo_fermata,
		programmata_arr, programmata_dep, actual_arr, actual_dep,
		delay_arr, delay_dep, actual_type, binario_prog, binario_real)
	VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
	ON CONFLICT (run_id, station_code) DO UPDATE SET
		order_idx=EXCLUDED.order_idx, tipo_fermata=EXCLUDED.tipo_fermata,
		programmata_arr=EXCLUDED.programmata_arr, programmata_dep=EXCLUDED.programmata_dep,
		actual_arr=EXCLUDED.actual_arr, actual_dep=EXCLUDED.actual_dep,
		delay_arr=EXCLUDED.delay_arr, delay_dep=EXCLUDED.delay_dep,
		actual_type=EXCLUDED.actual_type, binario_prog=EXCLUDED.binario_prog,
		binario_real=EXCLUDED.binario_real`

const upsertRunSQL = `
	INSERT INTO train_runs (numero, origine_code, data_partenza, categoria, origine, destinazione,
		dest_code, tipo_treno, provvedimento, orario_partenza, orario_arrivo,
		last_delay, max_delay, last_rilevamento_at, last_rilevamento_stazione, updated_at)
	VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
	ON CONFLICT (numero, origine_code, data_partenza) DO UPDATE SET
		categoria=EXCLUDED.categoria, origine=EXCLUDED.origine, destinazione=EXCLUDED.destinazione,
		dest_code=EXCLUDED.dest_code, tipo_treno=EXCLUDED.tipo_treno,
		provvedimento=EXCLUDED.provvedimento, orario_partenza=EXCLUDED.orario_partenza,
		orario_arrivo=EXCLUDED.orario_arrivo, last_delay=EXCLUDED.last_delay,
		max_delay=EXCLUDED.max_delay, last_rilevamento_at=EXCLUDED.last_rilevamento_at,
		last_rilevamento_stazione=EXCLUDED.last_rilevamento_stazione, updated_at=NOW()
	RETURNING id`

const rollupStopsSQL = `
	WITH ranked AS (
		SELECT CURRENT_DATE AS run_date, r.numero, s.station_code, s.delay_arr,
			GREATEST(s.delay_arr, s.delay_dep) AS dmax,
			(r.provvedimento = 1) AS canc,
			ROW_NUMBER() OVER (PARTITION BY r.numero, s.station_code ORDER BY r.id DESC) AS rn
		FROM stops s
		JOIN train_runs r ON r.id = s.run_id
		WHERE r.data_partenza = CURRENT_DATE
	)
	INSERT INTO daily_stop_stats (run_date, numero, station_code, delay_arr_final, delay_max, cancelled)
	SELECT run_date, numero, station_code, delay_arr, dmax, canc
	FROM ranked WHERE rn = 1
	ON CONFLICT (run_date, numero, station_code) DO UPDATE SET
		delay_arr_final = EXCLUDED.delay_arr_final, delay_max = EXCLUDED.delay_max,
		cancelled = EXCLUDED.cancelled`

// rollupStationsSQL folds today's stops into one row per station-day. This is
// the forever table: station totals/series are read from it once the per-stop
// hot window is pruned. Selection mirrors rollupStopsSQL (latest run wins for
// a duplicated numero+station) so both rollups describe the same stops.
const rollupStationsSQL = `
	WITH ranked AS (
		SELECT CURRENT_DATE AS run_date, r.numero, s.station_code, s.delay_arr,
			GREATEST(s.delay_arr, s.delay_dep) AS dmax,
			(r.provvedimento = 1) AS canc,
			ROW_NUMBER() OVER (PARTITION BY r.numero, s.station_code ORDER BY r.id DESC) AS rn
		FROM stops s
		JOIN train_runs r ON r.id = s.run_id
		WHERE r.data_partenza = CURRENT_DATE
	),
	src AS (
		SELECT run_date, numero, station_code, delay_arr, dmax, canc
		FROM ranked WHERE rn = 1
	)
	INSERT INTO daily_station_stats (
		run_date, station_code, runs, sum_final, sum_max, max_delay,
		cancelled, delayed, p95_final,
		worst_numero, worst_delay, worst_final, worst_cancelled
	)
	SELECT
		run_date,
		station_code,
		count(*)::int,
		COALESCE(sum(delay_arr), 0)::int,
		COALESCE(sum(dmax), 0)::int,
		COALESCE(max(dmax), 0)::int,
		count(*) FILTER (WHERE canc)::int,
		count(*) FILTER (WHERE delay_arr > 0)::int,
		COALESCE(percentile_disc(0.95) WITHIN GROUP (ORDER BY delay_arr), 0)::int,
		(array_agg(numero ORDER BY dmax DESC, delay_arr DESC, numero ASC))[1],
		COALESCE(max(dmax), 0)::int,
		(array_agg(delay_arr ORDER BY dmax DESC, delay_arr DESC, numero ASC))[1],
		(array_agg(canc ORDER BY dmax DESC, delay_arr DESC, numero ASC))[1]
	FROM src
	GROUP BY run_date, station_code
	ON CONFLICT (run_date, station_code) DO UPDATE SET
		runs = EXCLUDED.runs, sum_final = EXCLUDED.sum_final,
		sum_max = EXCLUDED.sum_max, max_delay = EXCLUDED.max_delay,
		cancelled = EXCLUDED.cancelled, delayed = EXCLUDED.delayed,
		p95_final = EXCLUDED.p95_final, worst_numero = EXCLUDED.worst_numero,
		worst_delay = EXCLUDED.worst_delay, worst_final = EXCLUDED.worst_final,
		worst_cancelled = EXCLUDED.worst_cancelled`

const rollupTrainsSQL = `
	INSERT INTO daily_train_stats (run_date, numero, origine_code, origine, destinazione, last_delay, max_delay, provvedimento, region_id, region_station, stops_count, avg_stop_delay)
	SELECT r.data_partenza, r.numero, r.origine_code, r.origine, r.destinazione, r.last_delay, r.max_delay, r.provvedimento,
		COALESCE(sl.region_id, so.region_id), COALESCE(sl.code, so.code),
		COALESCE(sa.n, 0), COALESCE(sa.avg_delay, 0)
	FROM train_runs r
	LEFT JOIN LATERAL (
		SELECT stat.region_id AS region_id, st.station_code AS code
		FROM stops st
		LEFT JOIN stations stat ON stat.code = st.station_code
		WHERE st.run_id = r.id
			AND (st.actual_arr IS NOT NULL OR st.actual_dep IS NOT NULL)
		ORDER BY st.order_idx DESC
		LIMIT 1
	) sl ON true
	LEFT JOIN LATERAL (
		SELECT count(*)::int AS n,
			COALESCE(round(avg(GREATEST(st.delay_arr, st.delay_dep))), 0)::int AS avg_delay
		FROM stops st
		WHERE st.run_id = r.id
			AND (st.actual_arr IS NOT NULL OR st.actual_dep IS NOT NULL)
	) sa ON true
	LEFT JOIN stations so ON so.code = r.origine_code
	WHERE r.data_partenza = CURRENT_DATE
	ON CONFLICT (run_date, numero, origine_code) DO UPDATE SET
		origine = EXCLUDED.origine, destinazione = EXCLUDED.destinazione,
		last_delay = EXCLUDED.last_delay, max_delay = EXCLUDED.max_delay,
		provvedimento = EXCLUDED.provvedimento, region_id = EXCLUDED.region_id,
		region_station = EXCLUDED.region_station,
		stops_count = EXCLUDED.stops_count, avg_stop_delay = EXCLUDED.avg_stop_delay`

const cleanupRunsSQL = `DELETE FROM train_runs WHERE data_partenza < NOW() - make_interval(days => $1)`

// Bounds the per-stop detail table; station totals live in daily_station_stats.
const cleanupDailyStopsSQL = `DELETE FROM daily_stop_stats WHERE run_date < CURRENT_DATE - make_interval(days => $1)`

const upsertInfoSQL = `
	INSERT INTO info_news (kind, payload) VALUES ($1, $2)
	ON CONFLICT (kind) DO UPDATE SET payload=EXCLUDED.payload, fetched_at=NOW()`

const existsRunSQL = `
	SELECT 1 FROM train_runs
	WHERE numero = $1 AND origine_code = $2 AND data_partenza = $3
	LIMIT 1`

// Active runs: trains that can still change. Mirrors the web "ora" filter
// (fetchDelays) with a slightly wider grace so the poller keeps writing the
// final snapshot just after arrival. Cancelled runs (provvedimento=1) never
// change again and are excluded.
const selectActiveRunsSQL = `
	SELECT numero, origine_code, data_partenza, orario_partenza, orario_arrivo,
		last_delay, provvedimento, last_rilevamento_at
	FROM train_runs
	WHERE data_partenza >= CURRENT_DATE - INTERVAL '1 day'
	  AND data_partenza <= CURRENT_DATE
	  AND COALESCE(provvedimento, 0) != 1
	  AND (
	    orario_partenza IS NULL OR orario_arrivo IS NULL
	    OR (
	      orario_partenza <= NOW() + make_interval(mins => $1)
	      AND orario_arrivo + make_interval(mins => GREATEST(COALESCE(last_delay, 0), 0))
	          > NOW() - make_interval(mins => $2)
	    )
	  )`
