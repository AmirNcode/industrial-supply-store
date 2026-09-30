import Image from "next/image";
import { ProductIcon } from "./ProductIcon";
import { optimizableImageUrl } from "@/lib/catalogImages";

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
 * Anything that is not our own Storage — an `http:` source, a supplier URL
 * an admin pasted — falls back to a plain `<img>`. The optimiser accepts only
 * Storage (`optimizableImageUrl`, next.config.ts), and one that refuses a URL
 * fails the whole render; an unoptimised image beats a broken page.
 */
export function CatalogImage({
  imageUrl,
  icon,
  alt,
  size,
  className = "",
  eager = false,
  fill = false,
}: {
  imageUrl: string;
  icon: string;
  alt: string;
  size: number;
  className?: string;
  eager?: boolean;
  fill?: boolean;
}) {
  if (!imageUrl) {
    return <ProductIcon name={icon} size={size} className={className} />;
  }

  if (!optimizableImageUrl(imageUrl, process.env.CATALOG_IMAGE_HOST)) {
    return (
      // Not ours to optimise, and a refused URL would fail the render.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt={alt}
        width={fill ? undefined : size}
        height={fill ? undefined : size}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        className={`catalog-art ${fill ? "absolute inset-0 h-full w-full " : ""}${className}`}
      />
    );
  }

  if (fill) {
    return (
      <Image
        src={imageUrl}
        alt={alt}
        fill
        sizes={`${size}px`}
        loading={eager ? "eager" : "lazy"}
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
