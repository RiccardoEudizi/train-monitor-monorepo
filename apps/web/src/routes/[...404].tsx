import { A } from "@solidjs/router";

export default function NotFound() {
  return (
    <main class="mx-auto max-w-5xl px-4 pb-16 text-center">
      <p class="py-8 text-xs uppercase tracking-[0.25em] text-zinc-500">
        errore · 404
      </p>
      <h1 class="text-3xl font-bold tracking-tight">Pagina non trovata</h1>
      <p class="mx-auto mt-3 max-w-md text-sm text-zinc-500">
        La pagina che cerchi non esiste o è stata spostata.
      </p>
      <div class="mt-6 flex items-center justify-center gap-2 text-sm">
        <A
          href="/"
          class="rounded bg-zinc-900 px-4 py-2 font-bold text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          home
        </A>
        <A
          href="/ritardi"
          class="rounded border border-zinc-300 px-4 py-2 text-zinc-500 dark:border-zinc-700"
        >
          ritardi
        </A>
      </div>
    </main>
  );
}
