import type { LucideIcon } from "lucide-react";
import { ShoppingBag } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Product imagery for media frames. Covers a `relative` parent (e.g. a card
 * image area) and degrades gracefully: a missing image or a failed load
 * renders a quiet branded tile instead of the browser's broken-image glyph.
 */
export function ProductArt({
  src,
  alt = "",
  icon: FallbackIcon = ShoppingBag,
  className,
}: {
  src: string | null | undefined;
  alt?: string;
  icon?: LucideIcon;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const showImage = Boolean(src) && !broken;

  if (!showImage) {
    return (
      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center bg-gradient-to-br from-muted to-muted/60 text-muted-foreground/70",
          className,
        )}
        aria-hidden="true"
      >
        <FallbackIcon className="size-9" strokeWidth={1.5} />
      </div>
    );
  }

  return (
    <img
      className={cn("absolute inset-0 size-full object-cover", className)}
      src={src ?? undefined}
      alt={alt}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}
