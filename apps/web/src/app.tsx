import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { Suspense } from "solid-js";
import Nav from "~/components/Nav";
import "./app.css";

export default function App() {
  return (
    <Router
      root={(props) => (
        <div class="min-h-screen">
          <Nav />
          <Suspense>{props.children}</Suspense>
          <footer class="mx-auto max-w-5xl px-4 py-8 text-[11px] text-zinc-500">
            Dati ViaggiaTreno · aggiornati dal poller
          </footer>
        </div>
      )}
    >
      <FileRoutes />
    </Router>
  );
}
