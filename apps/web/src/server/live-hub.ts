/**
 * One poller per live scope, shared by every connected client.
 *
 * The SSE route used to run `snapshot()` on its own timer for every browser
 * connection, so DB work scaled with the number of viewers. This hub keeps a
 * single timer per scope (`global`, `station:<code>`, `train:<numero>`), diffs
 * the payload, and fans the result out to all subscribers.
 *
 * Scope polling starts on the first subscriber and stops shortly after the
 * last one leaves. On Vercel each warm function instance has its own hub, so
 * the coalescing is per-instance; when the app is self-hosted (`pnpm start`)
 * there is exactly one.
 *
 * Dependency-free (types + timers only) so it can be unit tested without a
 * database or a network.
 */

export type ScopeKind = "global" | "station" | "train";

export interface Scope {
  kind: ScopeKind;
  /** Station code or train number. Empty for `global`. */
  id: string;
}

export interface Snapshot {
  updatedAt: string;
  trains: unknown[];
  dbConfigured: boolean;
}

/** Wire format. Unchanged from the previous per-connection route. */
export type ServerMessage =
  | ({
      scope: string;
      heartbeat?: false;
    } & Snapshot)
  | {
      scope: string;
      updatedAt: string;
      heartbeat: true;
    };

export type Subscriber = (msg: ServerMessage) => void;

export interface LiveHubOptions {
  /** Produces the current snapshot for a scope. Should catch and degrade,
   * like the route did, so a DB outage doesn't kill the timer. */
  fetchSnapshot: (scope: Scope) => Promise<Snapshot>;
  /** Cadence of the per-scope diff poll. Default 12s (matches `POLL_MS`). */
  intervalMs?: number;
  /** How long an empty scope keeps its timer/last snapshot. Default 60s. */
  idleGraceMs?: number;
  /** A snapshot younger than this is sent to a late joiner immediately. */
  freshMs?: number;
  /** Cap on distinct scopes being polled at once (abuse guard). */
  maxScopes?: number;
  /** Cap on total SSE subscribers. */
  maxSubscribers?: number;
  log?: (msg: string, err?: unknown) => void;
  now?: () => number;
}

interface Entry {
  scope: Scope;
  key: string;
  subscribers: Set<Subscriber>;
  latest: Snapshot | null;
  latestAt: number;
  /** JSON of the last broadcast `trains`, used for change detection. */
  lastKey: string;
  timer: ReturnType<typeof setTimeout> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  ticking: boolean;
}

export class ScopeLimitError extends Error {
  constructor(message = "too many live scopes") {
    super(message);
    this.name = "ScopeLimitError";
  }
}

export class SubscriberLimitError extends Error {
  constructor(message = "too many live subscribers") {
    super(message);
    this.name = "SubscriberLimitError";
  }
}

export function scopeKey(scope: Scope): string {
  return scope.kind === "global" ? "global" : `${scope.kind}:${scope.id}`;
}

export class LiveHub {
  private readonly entries = new Map<string, Entry>();
  private readonly fetchSnapshot: LiveHubOptions["fetchSnapshot"];
  private readonly intervalMs: number;
  private readonly idleGraceMs: number;
  private readonly freshMs: number;
  private readonly maxScopes: number;
  private readonly maxSubscribers: number;
  private readonly log: (msg: string, err?: unknown) => void;
  private readonly now: () => number;
  private subscriberCount = 0;
  private closed = false;

  constructor(opts: LiveHubOptions) {
    this.fetchSnapshot = opts.fetchSnapshot;
    this.intervalMs = Math.max(1, opts.intervalMs ?? 12_000);
    this.idleGraceMs = Math.max(0, opts.idleGraceMs ?? 60_000);
    this.freshMs = Math.max(0, opts.freshMs ?? 5_000);
    this.maxScopes = Math.max(1, opts.maxScopes ?? 100);
    this.maxSubscribers = Math.max(1, opts.maxSubscribers ?? 500);
    this.log = opts.log ?? ((msg, err) => console.error(msg, err ?? ""));
    this.now = opts.now ?? Date.now;
  }

  /**
   * Attach a subscriber. Sends the cached snapshot right away when it is
   * fresh, otherwise triggers an immediate poll. Returns an unsubscribe fn.
   */
  subscribe(scope: Scope, subscriber: Subscriber): () => void {
    if (this.closed) throw new Error("hub is closed");
    if (this.subscriberCount >= this.maxSubscribers) {
      throw new SubscriberLimitError();
    }

    const key = scopeKey(scope);
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= this.maxScopes) throw new ScopeLimitError();
      entry = {
        scope,
        key,
        subscribers: new Set(),
        latest: null,
        latestAt: 0,
        lastKey: "",
        timer: null,
        idleTimer: null,
        ticking: false,
      };
      this.entries.set(key, entry);
    }

    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
    entry.subscribers.add(subscriber);
    this.subscriberCount += 1;

    const fresh = entry.latest !== null && this.now() - entry.latestAt <= this.freshMs;
    if (fresh) {
      // Late joiner: skip the wait for the next tick.
      this.emit(subscriber, { scope: key, ...entry.latest! });
    }

    if (!entry.ticking && !entry.timer) {
      if (fresh) this.schedule(entry);
      else void this.run(entry);
    }

    return () => this.unsubscribe(entry!, subscriber);
  }

  /** Introspection for tests. */
  stats(): {
    scopes: number;
    subscribers: number;
    entries: Array<{ key: string; subscribers: number; ageMs: number | null; polling: boolean }>;
  } {
    const entries = [...this.entries.values()].map((e) => ({
      key: e.key,
      subscribers: e.subscribers.size,
      ageMs: e.latest ? this.now() - e.latestAt : null,
      polling: e.timer !== null || e.ticking,
    }));
    return { scopes: entries.length, subscribers: this.subscriberCount, entries };
  }

  /** Stop every timer and drop all subscribers (shutdown/HMR). */
  close(): void {
    this.closed = true;
    for (const entry of this.entries.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
      entry.timer = null;
      entry.idleTimer = null;
      entry.subscribers.clear();
    }
    this.entries.clear();
    this.subscriberCount = 0;
  }

  private unsubscribe(entry: Entry, subscriber: Subscriber): void {
    if (!entry.subscribers.delete(subscriber)) return;
    this.subscriberCount = Math.max(0, this.subscriberCount - 1);
    if (entry.subscribers.size > 0 || this.closed) return;

    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      entry.idleTimer = null;
      if (entry.subscribers.size > 0) return;
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = null;
      this.entries.delete(entry.key);
    }, this.idleGraceMs);
    entry.idleTimer.unref?.();
  }

  private schedule(entry: Entry): void {
    if (this.closed || entry.timer || entry.ticking) return;
    if (entry.subscribers.size === 0) return;
    entry.timer = setTimeout(() => {
      entry.timer = null;
      void this.run(entry);
    }, this.intervalMs);
    entry.timer.unref?.();
  }

  private async run(entry: Entry): Promise<void> {
    if (this.closed || entry.ticking) return;
    if (entry.subscribers.size === 0) return;

    entry.ticking = true;
    try {
      const snap = await this.fetchSnapshot(entry.scope);
      const key = JSON.stringify(snap.trains);
      entry.latest = snap;
      entry.latestAt = this.now();

      if (key !== entry.lastKey) {
        entry.lastKey = key;
        this.broadcast(entry, { scope: entry.key, ...snap });
      } else {
        this.broadcast(entry, {
          scope: entry.key,
          updatedAt: snap.updatedAt,
          heartbeat: true,
        });
      }
    } catch (err) {
      // A failed poll must not kill the scope: log and try again next tick.
      this.log(`[live] snapshot failed for ${entry.key}`, err);
    } finally {
      entry.ticking = false;
      this.schedule(entry);
    }
  }

  private broadcast(entry: Entry, msg: ServerMessage): void {
    for (const sub of entry.subscribers) this.emit(sub, msg);
  }

  private emit(subscriber: Subscriber, msg: ServerMessage): void {
    try {
      subscriber(msg);
    } catch (err) {
      // A dead socket must not break fan-out for everyone else.
      this.log(`[live] subscriber threw`, err);
    }
  }
}
