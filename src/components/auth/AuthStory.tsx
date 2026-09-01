import { Icon } from "../ui/Icon.tsx";

export function AuthStory() {
  return (
    <aside className="auth-story" aria-label="SoukCart highlights">
      <div className="story-content">
        <div>
          <p className="eyebrow story-eyebrow">Why SoukCart</p>
          <h2 className="display-xl story-headline">Sell everywhere. Stay in sync.</h2>
          <p className="story-copy">
            Connect your storefronts, keep inventory accurate, and spend more time growing your
            business.
          </p>
        </div>

        <div className="story-art-frame" aria-hidden="true">
          <svg
            className="story-art"
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

        <div className="story-chips">
          <span className="chip">
            <Icon name="store" />
            <span>Storefront sync</span>
          </span>
          <span className="chip">
            <Icon name="layers" />
            <span>Live inventory</span>
          </span>
          <span className="chip">
            <Icon name="refresh" />
            <span>Order routing</span>
          </span>
        </div>
      </div>
    </aside>
  );
}
