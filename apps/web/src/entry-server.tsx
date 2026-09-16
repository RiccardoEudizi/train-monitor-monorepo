// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server";
import { getInitialDark } from "~/lib/theme";

export default createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => {
      // Seed the theme class from the request cookie so first paint already
      // matches the user's preference (no flash, hydration-safe: the client
      // signal initializes from the same cookie in ~/lib/theme).
      const dark = getInitialDark();
      return (
        <html lang="en" class={dark ? "dark" : undefined}>
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <link rel="icon" href="/favicon.ico" />
            {assets}
          </head>
          <body>
            <div id="app">{children}</div>
            {scripts}
          </body>
        </html>
      );
    }}
  />
));
