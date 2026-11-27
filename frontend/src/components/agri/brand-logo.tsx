import { cn } from "@/lib/utils";

/** The AgriSense round emblem (public/brand). `size` in pixels. */
export function BrandLogo({ size = 36, className }: { size?: number; className?: string }) {
  const src = size > 64 ? "/brand/agrisense-logo-192.png" : "/brand/agrisense-logo-64.png";
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt="AgriSense"
      className={cn("shrink-0 rounded-full", className)}
      style={{ width: size, height: size }}
      decoding="async"
    />
  );
}
