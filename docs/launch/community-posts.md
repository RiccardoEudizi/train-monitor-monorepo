# Launch posts (drafts)

Copy/paste these when you're ready. Adjust tone as you like.

---

## Show HN

**Title**

> Show HN: Ritardometro – a live, no-login board of Italian train delays

**Body**

I got tired of how hard it is to answer "how late is the Italian rail network
right now?", so I built a live board for it.

ViaggiaTreno (RFI's public data service) has the data, but it's per-station and
slow, so you can't see the network at once. Ritardometro turns it into a single
live view: national counters, a WebGL map of every circulating train (interpolated
between its last and next stop, coloured by delay), regional rankings, station
boards, and per-train history.

Live: https://train-monitor-v2.vercel.app
Code: https://github.com/RiccardoEudizi/train-monitor-monorepo

How it works: a Go poller discovers runs from station boards, refreshes only
trains in their live window, and rewrites a run only when its delay actually
changed (40s cadence, 24/7). It writes to Postgres; a SolidStart app on Vercel
reads Postgres and pushes updates over one SSE stream. The app never calls
ViaggiaTreno directly.

The most interesting part was a performance bug: the homepage took up to 70s
because it shipped 137k rows out of Postgres to fold them in JavaScript (twice
per request). Moving the aggregation into SQL made it ~30× faster — overview
68.6s → 1.2s, homepage TTFB 20–37s → ~0.6s warm. I wrote it up here: <link>.

Feedback welcome, especially on the data model and the poller's scheduling.

---

## r/italy

**Titolo**

> Ho fatto un sito che mostra tutti i ritardi dei treni italiani in tempo reale

**Testo**

Ciao a tutti! ViaggiaTreno ha i dati ma è scomodo: stazione per stazione, lento,
non si vede mai il quadro d'insieme. Così ho costruito **Ritardometro**, una
board live e senza login:

- contatori nazionali (quanti treni in viaggio, quanti in ritardo *adesso*);
- **mappa 3D** con tutti i treni in circolazione, posizione interpolata tra
  l'ultima e la prossima fermata e colorati per ritardo;
- classifica per regione (30g / 7g / 1g / totale);
- scheda stazione con arrivi/partenze e storico 30 giorni;
- scheda treno con fermate, ritardo live e storico.

I dati sono quelli ufficiali di ViaggiaTreno, aggiornati in tempo reale (il
poller ricontrolla i treni in viaggio ogni 40 secondi). Niente pubblicità,
niente account.

👉 https://train-monitor-v2.vercel.app

È un progetto personale e non ufficiale (non sono affiliato a RFI/Trenitalia).
Se trovate numeri strani o avete idee, fatemi sapere 🙂

---

## r/italyInformatica

**Titolo**

> Ritardometro: board live dei ritardi dei treni italiani (Go + Postgres +
> SolidStart), con un bug di performance da 70s

**Testo**

Ciao! Condivido un side project: **Ritardometro**, una board pubblica e senza
login dei ritardi dei treni italiani. Dati da ViaggiaTreno.

Live: https://train-monitor-v2.vercel.app
Repo (MIT): https://github.com/RiccardoEudizi/train-monitor-monorepo

Architettura: un poller in **Go** scopre le corse dalle board delle stazioni,
aggiorna solo i treni nella loro finestra live e riscrive una corsa **solo se il
ritardo è cambiato** (cadenza 40s). Scrive su **Postgres**; un'app **SolidStart**
su Vercel legge il DB e spinge gli aggiornamenti al browser con un solo stream
**SSE**. L'app non chiama mai ViaggiaTreno direttamente. C'è anche una mappa 3D
(Three.js) con i treni interpolati tra le fermate.

La parte più interessante è stata una **query lentissima**: la homepage arrivava
a 70s di TTFB perché la query "regione dell'ultimo rilevamento" faceva un
`LEFT JOIN stations` *dentro* un `LATERAL`, causando ~131k seq scan sulla tabella
`stations` (3354 righe). Spostando la join fuori: 72s → 3.9s.

Ma il problema vero era un altro: l'app trasferiva **137k righe** da Postgres per
aggregarle in JavaScript, **due volte per richiesta**. Facendo la `GROUP BY` in
SQL e restituendo ~20 righe: overview 68.6s → 1.2s, homepage ~20s → ~0.6s.
Il DB rispondeva in 40ms; era lo *spostamento* dei dati a essere lento.

C'è anche CI (GitHub Actions: typecheck+build web, vet+build+test poller) e
qualche unit test sul poller. Feedback benvenuto!

---

## LinkedIn

> Ho pubblicato **Ritardometro**, una board live dei ritardi dei treni italiani:
> contatori nazionali, una mappa 3D di tutti i treni in circolazione, classifiche
> regionali e storico per stazione e per treno. Senza login, senza pubblicità.
>
> Stack: poller in Go (scheduler a più livelli, scritture solo quando cambia
> qualcosa) → PostgreSQL → app SolidStart su Vercel, aggiornamenti in tempo reale
> via SSE. Mappa 3D in Three.js.
>
> La sfida più interessante è stata di performance: la homepage impiegava fino a
> 70 secondi perché l'app trasferiva ~137k righe dal DB per aggregarle in
> JavaScript. Spostando l'aggregazione in SQL (e sistemando una join che causava
> ~131k scansioni sequenziali) è diventata ~30 volte più veloce.
>
> 🔗 https://train-monitor-v2.vercel.app
>
> #golang #postgresql #solidjs #webdev #performance
