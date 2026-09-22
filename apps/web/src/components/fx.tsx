import { createSignal, createEffect, onMount, Show, type JSX } from "solid-js";

/**
 * FX layer: CSS-first transitions.
 *
 * - `PixelValue` (pixelated switch) and `AsciiFx` (blur add/remove)
 *   run on CSS keyframes. SSR-safe: first paint has no animation classes;
 *   transitions only fire client-side after mount + value change.
 */

/** Client capability probe. */
export function useFxSupport() {
  const [mounted, setMounted] = createSignal(false);
  const [reducedMotion, setReducedMotion] = createSignal(false);
  onMount(() => {
    setMounted(true);
    try {
      setReducedMotion(
        window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      );
    } catch {
      setReducedMotion(false);
    }
  });
  return {
    mounted,
    animate: () => mounted() && !reducedMotion(),
  };
}

/** Pixelated switch for numbers / short titles. */
export function PixelValue(props: {
  value: string;
  class?: string;
  children?: JSX.Element;
}) {
  const fx = useFxSupport();
  const [prev, setPrev] = createSignal(props.value);
  const [phase, setPhase] = createSignal<"idle" | "swap">("idle");
  let timer: ReturnType<typeof setTimeout> | undefined;

  createEffect(() => {
    const next = props.value;
    if (!fx.mounted()) {
      setPrev(next);
      return;
    }
    if (next === prev()) return;
    if (!fx.animate()) {
      setPrev(next);
      return;
    }
    setPhase("swap");
    if (timer) clearTimeout(timer);
    // Keep old layer long enough for the dissolve, then commit.
    timer = setTimeout(() => {
      setPrev(next);
      setPhase("idle");
    }, 260);
  });

  const showSwap = () => phase() === "swap" && prev() !== props.value;

  return (
    <span class={`fx-pixel-wrap ${props.class ?? ""}`}>
      <Show when={showSwap()} fallback={<span class="fx-pixel-idle">{props.children}</span>}>
        {/* Old value dissolves out (blocky, behind). */}
        <span aria-hidden="true" class="fx-pixel-old">
          {prev()}
        </span>
        {/* New value pixelates in (live content for AT). */}
        <span class="fx-pixel-new">{props.children}</span>
      </Show>
    </span>
  );
}

/** Blur add/remove wrapper for ASCII charts (`<pre>` blocks).
 * `delayMs` staggers the enter animation (e.g. per ranking row). */
export function AsciiFx(props: {
  watch: string;
  children: JSX.Element;
  delayMs?: number;
}) {
  const fx = useFxSupport();
  const [key, setKey] = createSignal(props.watch);
  const [entering, setEntering] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  createEffect(() => {
    const next = props.watch;
    if (!fx.mounted()) {
      setKey(next);
      return;
    }
    if (next === key()) return;
    setKey(next);
    if (!fx.animate()) return;
    setEntering(true);
    if (timer) clearTimeout(timer);
    timer = setTimeout(
      () => setEntering(false),
      280 + (props.delayMs ?? 0),
    );
  });

  return (
    <div
      class={`fx-ascii w-full max-w-full min-w-0 overflow-hidden ${entering() ? "fx-ascii-enter" : ""}`}
      style={entering() ? { "animation-delay": `${props.delayMs ?? 0}ms` } : undefined}
    >
      {props.children}
    </div>
  );
}
