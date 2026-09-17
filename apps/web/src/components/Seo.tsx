import { Meta, Title } from "@solidjs/meta";
import { canonicalUrl, OG_IMAGE, SITE_NAME, SITE_URL } from "~/lib/seo";

/** One instance per page: SSR head tags and reactive client navigation. */
export default function Seo(props: {
  title: string;
  description: string;
  path: string;
  index?: boolean;
}) {
  const url = () => canonicalUrl(props.path);
  return (
    <>
      <Title>{props.title}</Title>
      <Meta name="description" content={props.description} />
      <Meta
        name="robots"
        content={import.meta.env.SEO_NOINDEX || props.index === false
          ? "noindex, follow"
          : "index, follow, max-image-preview:large"}
      />
      <Meta property="og:site_name" content={SITE_NAME} />
      <Meta property="og:type" content="website" />
      <Meta property="og:title" content={props.title} />
      <Meta property="og:description" content={props.description} />
      <Meta property="og:url" content={url()} />
      <Meta property="og:image" content={`${SITE_URL}${OG_IMAGE}`} />
      <Meta property="og:image:type" content="image/png" />
      <Meta property="og:image:width" content="1200" />
      <Meta property="og:image:height" content="630" />
      <Meta property="og:image:alt" content="train-monitor — Ritardi treni in tempo reale" />
      <Meta property="og:locale" content="it_IT" />
      <Meta name="twitter:card" content="summary_large_image" />
      <Meta name="twitter:title" content={props.title} />
      <Meta name="twitter:description" content={props.description} />
      <Meta name="twitter:image" content={`${SITE_URL}${OG_IMAGE}`} />
      <Meta name="twitter:image:alt" content="train-monitor — Ritardi treni in tempo reale" />
    </>
  );
}
