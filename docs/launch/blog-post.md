# I built a live board of Italian train delays — then made it 30× faster

*Draft blog post. Suggested tags: Go, PostgreSQL, SolidJS, performance, side-project.*

---

Italian trains are late. This is not a hot take — it's a national pastime to
complain about it. What *is* surprising is how hard it is to get a straight
answer to simple questions:

- How many trains are late **right now**?
- Is my train late, and by how much?
- Which region is worst this month?

The data is public. RFI publishes it through **ViaggiaTreno**, a service that
exposes live train positions, delays, and station boards. But it's spread across
a slow, per-station interface that makes the whole network hard to see at once.

So I built **Ritardometro** — a live, no-login board of Italian train delays:
national counters, a 3D map of every circulating train, regional rankings,
station boards, and per-train history.

**Live:** https://train-monitor-v2.vercel.app
**Code:** https://github.com/RiccardoEudizi/train-monitor-monorepo

This is the story of how it works, and of the performance bug that made the
homepage take up to **70 seconds** — and how I fixed it.

## Architecture: poll once, read cheaply

The app never calls ViaggiaTreno directly. Instead, two deployables share one
Postgres database:

```
ViaggiaTreno API
      │  live trains every 40s, discovery every 5m
      ▼
Go poller ───────────► PostgreSQL (Neon)
  tiered scheduler         │  train_runs · stops · daily_* rollups
  change-only writes       ▼
                    SolidStart app (Vercel) ──SSE──► browser
```

- **`services/poller`** — a Go ingester on an always-on host. It discovers runs
  from station boards, refreshes only trains inside their live window, and
  **rewrites a run only when its delay actually changed**. Static schedule data
  is written once and never churned.
- **`apps/web`** — a SolidStart app on Vercel. It only reads Postgres, and pushes
  updates to the browser over a single SSE stream (no client polling).

Two things I'd highlight:

**A tiered scheduler.** A live refresh (40s), a discovery sweep (5m), and
rollup/cleanup jobs all run on independent tickers in separate goroutines, so a
slow 520-board sweep never delays the live refresh.

**Rollups that outlive the hot window.** `train_runs` and `stops` are kept to a
30-day window (currently ~137k runs and ~1.66M stops). Daily aggregates are kept
forever, so "all time" stats survive retention.

The frontend does the fun visual stuff: a WebGL map of Italy with every
circulating train interpolated between its last and next stop and coloured by
delay, a region choropleth, and Chart.js trend panels.

## The bug: the homepage took 70 seconds

The homepage showed a "Panoramica" panel: national average delay, worst region,
delay incidence, a trend chart, and a regional ranking. It worked — and it was
unusably slow.

I measured TTFB: **34–37 seconds**, and sometimes worse. One request didn't
finish in 120 seconds.

I pulled the query plans straight from the database. The first smoking gun was a
`LATERAL` join that, for each run, found the last stop with real data and its
region:

```
Seq Scan on stations stat  (actual time=0.001..0.226 rows=3354) loops=131822
```

Postgres was **seq-scanning the 3,354-row `stations` table 131,822 times**,
because the `LEFT JOIN stations` sat *inside* the lateral. Hoisting that join out
took the query from **72 s to 3.9 s** — an 18× win, from moving one line.

But 3.9 s was still too slow, and the numbers didn't tell the whole story.

## The real problem: shipping 137,000 rows to do arithmetic

The app was fetching **every run in the 30-day window** — 137,696 rows — out of
Postgres and folding them in JavaScript. And the homepage did that **twice**:
once for national stats, once for the regional ranking.

I tested the driver in isolation:

| Query | Rows | Time |
|---|---:|---:|
| `GROUP BY region` | 23 | **183 ms** |
| 30-day raw rows | 137,696 | **22.7 s** |

There it was. The database wasn't slow. **Moving the data was slow.** Transferring
137k rows over Neon's HTTP driver took 15–23 seconds — twice per request — and
under that load the HTTP/2 stream would sometimes just die
(`NGHTTP2_INTERNAL_ERROR`), turning the request into a 500.

The fix was almost anticlimactic: **do the aggregation in SQL.**

National stats became one aggregate row plus one row per day. The regional
ranking became a single `GROUP BY` that returns ~20 rows, with the region
attribution mirrored exactly in SQL (including the historical override for
stations whose stored region was 0):

```sql
SELECT region_id,
       count(*)                                              AS runs,
       count(*) FILTER (WHERE delay > 0)                     AS delayed,
       sum(delay)                                            AS total,
       max(delay)                                            AS max
FROM resolved
WHERE region_id IS NOT NULL
GROUP BY region_id
ORDER BY total DESC;
```

## The results

| | Before | After |
|---|---:|---:|
| Overview query | 68.6 s | **1.2 s** |
| Map regions | 57.7 s | **0.2 s** |
| Homepage TTFB | 20–37 s | **0.55 s** (warm) |

That's roughly **30× faster**, and the numbers are unchanged: the national stats
are byte-for-byte identical, and the regional ranking is within live-data drift.

## What I took away

- **Latency is often data movement, not computation.** The database answered in
  40 ms; the app just insisted on carrying 137k rows across the wire to do
  arithmetic it could have done in place.
- **Read your query plans.** One `LEFT JOIN` in the wrong place turned into
  131,822 sequential scans. The plan told me immediately.
- **Aggregate where the data lives.** "Fetch rows and compute in the app" is a
  fine default at small scale and a trap at real scale.
- **Add a CI gate.** I fixed seven TypeScript errors that had been hiding for
  months because the project had never been typechecked. Now GitHub Actions runs
  typecheck + build for the web and vet + test for the poller on every push.

If you ride Italian trains, the board is live — go check whether your region is
winning. (It's Lombardy. It's always Lombardy.)
