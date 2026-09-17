import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { MetaProvider, Title } from "@solidjs/meta";
import { Suspense } from "solid-js";
import Nav from "~/components/Nav";
import SiteMeta from "~/components/SiteMeta";
import { SITE_NAME } from "~/lib/seo";
import "./app.css";

export default function App() {
  return (
    <Router
      root={(props) => (
        <MetaProvider>
          <SiteMeta />
          {/* Fallback title: every page overrides it via <Seo>. */}
          <Title>{SITE_NAME}</Title>
          <div class="min-h-screen">
            <Nav />
            <Suspense>{props.children}</Suspense>
            <footer class="mx-auto max-w-5xl px-4 py-8 text-[11px] text-zinc-500">
              Dati ViaggiaTreno · aggiornati dal poller
            </footer>
          </div>
        </MetaProvider>
      )}
    >
      <FileRoutes />
    </Router>
  );
}
