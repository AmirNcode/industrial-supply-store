import { ProductIcon } from "./ProductIcon";

/** Remote/uploaded catalog artwork with the existing SVG as its empty fallback. */
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

  return (
    // eslint-disable-next-line @next/next/no-img-element -- administrators can
    // provide arbitrary supplier hosts, which cannot be predeclared for Image.
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
