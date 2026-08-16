import Image from "next/image";
import { ProductIcon } from "./ProductIcon";

/**
 * Remote or uploaded catalog artwork, with the in-house SVG as its empty state.
 *
 * Everything here is painted into a 34–64px tile from a source that is a
 * supplier's full-size photograph, so the picture goes through Next's image
 * optimiser: it is resized to the tile, converted to a modern format, and
 * cached on the CDN. The original stays whatever size it was uploaded at,
 * which is fine — storage is cheap and bandwidth is not.
 *
 * `sizes` is the tile's own width rather than a viewport expression, because
 * these never reflow: a 44px thumbnail is 44px at every breakpoint. Without it
 * the optimiser assumes the image might fill the viewport and serves something
 * far larger than the tile can show.
 *
 * An `http:` source falls back to a plain `<img>`. `remotePatterns` allows
 * HTTPS only, and an optimiser that refuses the URL fails the whole render —
 * an insecure image is worth serving unoptimised, not worth a broken page.
 */
export function CatalogImage({
  imageUrl,
  icon,
  alt,
  size,
  className = "",
  eager = false,
}: {
  imageUrl: string;
  icon: string;
  alt: string;
  size: number;
  className?: string;
  eager?: boolean;
}) {
  if (!imageUrl) {
    return <ProductIcon name={icon} size={size} className={className} />;
  }

  if (!imageUrl.startsWith("https://")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- see above: the
      // optimiser is HTTPS-only and refusing the URL would fail the render.
      <img
        src={imageUrl}
        alt={alt}
        width={size}
        height={size}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        className={`catalog-art ${className}`}
      />
    );
  }

  return (
    <Image
      src={imageUrl}
      alt={alt}
      width={size}
      height={size}
      sizes={`${size}px`}
      loading={eager ? "eager" : "lazy"}
      className={`catalog-art ${className}`}
    />
  );
}
