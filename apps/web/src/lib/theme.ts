import { getRequestEvent } from "solid-js/web";

/**
 * Theme preference, persisted in a cookie so SSR can render the correct
 * `<html class="dark">` on first paint (no flash, no hydration mismatch).
 * Single source of truth: `tm-theme=dark|light` (default dark).
 */

export const THEME_COOKIE = "tm-theme";
const MAX_AGE = 31536000; // 1 year

/** Parse a `Cookie` header / `document.cookie` value → dark?, null if absent. */
export function parseThemeCookie(header: string | null | undefined): boolean | null {
  if (!header) return null;
  const m = /(?:^|;\s*)tm-theme=(dark|light)/.exec(header);
  if (!m) return null;
  return m[1] === "dark";
}

/**
 * SSR-safe initial value. Server reads the request cookie (same jar the
 * browser will send → hydration always agrees). Client reads
 * `document.cookie` synchronously during render. Falls back to a legacy
 * `localStorage` value once (pre-cookie users), then to dark.
 */
export function getInitialDark(): boolean {
  if (typeof document === "undefined") {
    try {
      const cookie = getRequestEvent()?.request.headers.get("cookie");
      return parseThemeCookie(cookie) ?? true;
    } catch {
      return true;
    }
  }
  const fromCookie = parseThemeCookie(document.cookie);
  if (fromCookie !== null) return fromCookie;
  try {
    const saved = localStorage.getItem("tm-theme");
    if (saved === "light" || saved === "dark") return saved === "dark";
  } catch {
    /* storage unavailable */
  }
  return true;
}

/** Persist preference (client only — call from effects/handlers, never render). */
export function setThemeCookie(dark: boolean) {
  if (typeof document === "undefined") return;
  document.cookie = `${THEME_COOKIE}=${dark ? "dark" : "light"}; path=/; max-age=${MAX_AGE}; SameSite=Lax`;
}
