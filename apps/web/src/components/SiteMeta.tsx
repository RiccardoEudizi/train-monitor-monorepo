import { Link, Meta } from "@solidjs/meta";
import { useLocation } from "@solidjs/router";
import { canonicalUrl, SITE_NAME } from "~/lib/seo";

/** Global head metadata, mounted once inside MetaProvider.
 * Pair with Seo (per-page tags): this owns canonical/charset/viewport/icons. */
export default function SiteMeta() {
  const location = useLocation();
  const path = () => location.pathname.replace(/^(\/stazione\/)([^/]+)\/?$/, (_, prefix, code) => `${prefix}${code.toUpperCase()}`);
  return (
    <>
      <Link rel="canonical" href={canonicalUrl(path())} />
      <Meta charset="utf-8" />
      <Meta name="viewport" content="width=device-width, initial-scale=1" />
      <Meta name="theme-color" content="#09090b" />
      <Meta name="application-name" content={SITE_NAME} />
      <Link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48" />
      <Link rel="icon" href="/icon.svg" type="image/svg+xml" sizes="any" />
      <Link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
      <Link rel="manifest" href="/site.webmanifest" />
    </>
  );
}
