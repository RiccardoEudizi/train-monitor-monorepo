import { createEffect, createSignal, onCleanup, onMount } from "solid-js";

export interface LiveMessage<T = unknown> {
  scope: string;
  updatedAt: string;
  heartbeat?: boolean;
  data: T;
}

export interface UseLiveOptions<T> {
  /** Static URL or reactive accessor (reconnects when it changes). */
  url: string | (() => string);
  enabled?: boolean;
  onMessage?: (msg: LiveMessage<T>) => void;
}

/**
 * Shared EventSource helper with auto-reconnect (exponential backoff).
 * Used for both global (/api/live) and per-page (?station= / ?train=) feeds.
 * SSR-safe: returns offline signals and never touches EventSource on server.
 */
export function useLive<T>(opts: UseLiveOptions<T>) {
  const [connected, setConnected] = createSignal(false);

  if (typeof window === "undefined") {
    return { connected };
  }

  let es: EventSource | null = null;
  let retry = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const currentUrl = () =>
    typeof opts.url === "function" ? opts.url() : opts.url;

  function disconnect() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    es?.close();
    es = null;
  }

  function connect() {
    if (closed || opts.enabled === false) return;
    const url = currentUrl();
    if (!url) return;
    try {
      es = new EventSource(url);
    } catch {
      schedule();
      return;
    }
    es.onopen = () => {
      setConnected(true);
      retry = 0;
    };
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as LiveMessage<T>;
        opts.onMessage?.(msg);
      } catch {
        /* ignore malformed */
      }
    };
    es.onerror = () => {
      setConnected(false);
      disconnect();
      schedule();
    };
  }

  function schedule() {
    if (closed) return;
    retry = Math.min(retry + 1, 6);
    const delay = Math.min(1000 * 2 ** retry, 30000);
    timer = setTimeout(connect, delay);
  }

  // Connect only after hydration completes (onMount never runs during SSR
  // or hydration): an EventSource message that lands mid-hydration would
  // revalidate() the queries and mutate the <For> lists while Solid is still
  // matching server DOM nodes → "Hydration Mismatch / Unable to find DOM
  // nodes for hydration key". Reconnect whenever the URL accessor changes
  // (e.g. route param change), but only once mounted.
  let mounted = false;
  onMount(() => {
    mounted = true;
    connect();
  });

  createEffect(() => {
    currentUrl();
    if (!mounted) return;
    disconnect();
    connect();
  });

  onCleanup(() => {
    closed = true;
    disconnect();
  });

  return { connected };
}
