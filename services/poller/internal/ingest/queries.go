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
	INSERT INTO daily_stop_stats (run_date, numero, station_code, delay_arr_final, delay_max, cancelled, samples)
	SELECT run_date, numero, station_code, delay_arr, dmax, canc, 1
	FROM ranked WHERE rn = 1
	ON CONFLICT (run_date, numero, station_code) DO UPDATE SET
		delay_arr_final = EXCLUDED.delay_arr_final, delay_max = EXCLUDED.delay_max,
		cancelled = EXCLUDED.cancelled, samples = EXCLUDED.samples`

const rollupTrainsSQL = `
	INSERT INTO daily_train_stats (run_date, numero, origine_code, origine, destinazione, last_delay, max_delay, provvedimento, region_id, region_station)
	SELECT r.data_partenza, r.numero, r.origine_code, r.origine, r.destinazione, r.last_delay, r.max_delay, r.provvedimento,
		COALESCE(sl.region_id, so.region_id), COALESCE(sl.code, so.code)
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
	LEFT JOIN stations so ON so.code = r.origine_code
	WHERE r.data_partenza = CURRENT_DATE
	ON CONFLICT (run_date, numero, origine_code) DO UPDATE SET
		origine = EXCLUDED.origine, destinazione = EXCLUDED.destinazione,
		last_delay = EXCLUDED.last_delay, max_delay = EXCLUDED.max_delay,
		provvedimento = EXCLUDED.provvedimento, region_id = EXCLUDED.region_id,
		region_station = EXCLUDED.region_station`

const cleanupRunsSQL = `DELETE FROM train_runs WHERE data_partenza < NOW() - make_interval(days => $1)`

const upsertInfoSQL = `
	INSERT INTO info_news (kind, payload) VALUES ($1, $2)
	ON CONFLICT (kind) DO UPDATE SET payload=EXCLUDED.payload, fetched_at=NOW()`
