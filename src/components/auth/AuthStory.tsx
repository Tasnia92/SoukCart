import { Layers3Icon, RefreshCwIcon, StoreIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function AuthStory() {
  return (
    <aside
      className="relative hidden min-h-svh overflow-hidden bg-primary p-10 text-primary-foreground lg:flex lg:items-center"
      aria-label="SoukCart highlights"
    >
      <div className="mx-auto flex w-full max-w-xl flex-col gap-8">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-primary-foreground/70">
            Why SoukCart
          </p>
          <h2 className="text-balance text-4xl font-semibold tracking-tight xl:text-5xl">
            Sell everywhere. Stay in sync.
          </h2>
          <p className="max-w-lg text-base leading-7 text-primary-foreground/80">
            Connect your storefronts, keep inventory accurate, and spend more time growing your
            business.
          </p>
        </div>

        <div
          className="rounded-3xl border border-primary-foreground/20 bg-primary-foreground/5 p-5"
          aria-hidden="true"
        >
          <svg
            className="aspect-[4/3] w-full text-primary-foreground/75"
            viewBox="0 0 400 300"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            focusable="false"
          >
            <path d="M24 240h140" />
            <path d="M236 240h140" />
            <path d="M48 240v-84h104v84" />
            <path d="M40 156l10-28h100l10 28" />
            <path d="M40 156a13 13 0 0 0 26 0 13 13 0 0 0 26 0 13 13 0 0 0 26 0 13 13 0 0 0 26 0" />
            <path d="M66 240v-38h26v38" />
            <path d="M110 200h28v20h-28z" />
            <path d="M252 240v-84h104v84" />
            <path d="M244 156l10-28h100l10 28" />
            <path d="M244 156a13 13 0 0 0 26 0 13 13 0 0 0 26 0 13 13 0 0 0 26 0 13 13 0 0 0 26 0" />
            <path d="M270 240v-38h26v38" />
            <path d="M314 200h28v20h-28z" />
            <g transform="translate(121 -15) scale(6.5)">
              <path
                vectorEffect="non-scaling-stroke"
                d="M19.2 8.8A7.5 7.5 0 0 0 5.4 6.7L3.5 8.6M3.5 8.6V4.8M3.5 8.6h3.8M4.8 15.2a7.5 7.5 0 0 0 13.8 2.1l1.9-1.9M20.5 15.4v3.8M20.5 15.4h-3.8"
              />
            </g>
            <path d="M188 224h24v16h-24z" />
            <path d="M200 224v16" />
            <path d="M194 224v-6h12v6" />
          </svg>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">
            <StoreIcon data-icon="inline-start" aria-hidden="true" />
            Storefront sync
          </Badge>
          <Badge variant="secondary">
            <Layers3Icon data-icon="inline-start" aria-hidden="true" />
            Live inventory
          </Badge>
          <Badge variant="secondary">
            <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
            Order routing
          </Badge>
        </div>
      </div>
    </aside>
  );
}
