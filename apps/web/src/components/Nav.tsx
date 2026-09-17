import { A } from "@solidjs/router";
import CommandPalette from "~/components/CommandPalette";
import { ThemeToggle } from "~/components/ui";

export default function Nav() {
  return (
    <header class="border-b border-zinc-200 dark:border-zinc-800">
      <div class="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
        <A href="/" class="text-sm font-bold tracking-tight">
          train-monitor
        </A>
        <nav class="flex items-center gap-3 text-xs uppercase tracking-widest text-zinc-500">
          <A href="/ritardi" end activeClass="text-zinc-900 dark:text-zinc-100">
            ritardi
          </A>
          <span class="text-zinc-300 dark:text-zinc-700">/</span>
          <span class="hidden sm:inline">live</span>
        </nav>
        <div class="ml-auto flex items-center gap-2">
          <CommandPalette />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
