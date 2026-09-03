import { PackageCheckIcon, StoreIcon, TrendingUpIcon } from "lucide-react";

export function GrowthArt() {
  return (
    <div
      className="grid grid-cols-3 gap-3 rounded-2xl bg-muted/50 p-4"
      role="presentation"
      aria-hidden="true"
    >
      <div className="flex aspect-square items-center justify-center rounded-2xl bg-background text-primary ring-1 ring-foreground/10">
        <PackageCheckIcon className="size-8" aria-hidden="true" />
      </div>
      <div className="flex aspect-square items-center justify-center rounded-2xl bg-background text-primary ring-1 ring-foreground/10">
        <TrendingUpIcon className="size-8" aria-hidden="true" />
      </div>
      <div className="flex aspect-square items-center justify-center rounded-2xl bg-background text-primary ring-1 ring-foreground/10">
        <StoreIcon className="size-8" aria-hidden="true" />
      </div>
    </div>
  );
}
