import {
  ArrowRightIcon,
  Building2Icon,
  PackageCheckIcon,
  StoreIcon,
  TruckIcon,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const JOURNEY_ICONS: readonly LucideIcon[] = [
  Building2Icon,
  PackageCheckIcon,
  TruckIcon,
  StoreIcon,
];

export function JourneyArt() {
  return (
    <Card className="border-0 bg-muted/40 shadow-none" role="presentation" aria-hidden="true">
      <CardContent className="grid grid-cols-4 items-center gap-2">
        {JOURNEY_ICONS.map((JourneyIcon, index) => (
          <div className="flex min-w-0 items-center gap-2" key={index}>
            <div className="flex min-w-0 flex-1 items-center justify-center rounded-2xl bg-background p-4 text-primary ring-1 ring-foreground/10">
              <JourneyIcon className="size-7 sm:size-9" aria-hidden="true" />
            </div>
            {index < JOURNEY_ICONS.length - 1 ? (
              <ArrowRightIcon
                className="hidden size-4 shrink-0 text-muted-foreground sm:block"
                aria-hidden="true"
              />
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
