/** Change this origin when moving to a custom domain. */
export const SITE_URL = "https://train-monitor-v2.vercel.app";
export const SITE_NAME = "Ritardometro";
export const OG_IMAGE = "/social-card.png";
export const SITE_DESCRIPTION =
  "Ritardometro — i treni italiani, in ritardo live: ritardi, arrivi e partenze per stazione, fermate e statistiche storiche. Dati ViaggiaTreno aggiornati in tempo reale.";

/** Canonicals exclude filters, tracking parameters, fragments and trailing slashes. */
export function canonicalUrl(path: string): string {
  const pathname = `/${path.split(/[?#]/)[0].replace(/^\/+|\/+$/g, "")}`;
  return `${SITE_URL}${pathname}`;
}

export function pageTitle(specific: string): string {
  return `${specific} | ${SITE_NAME}`;
}
