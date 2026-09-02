/* -----------------------------------------------------------------------------
 * LandingPage — the public marketing surface at "/".
 *
 * Structure: header → hero (copy + illustrated order journey) → platform
 * highlights → how it works → join band → footer. Every visual is SVG line art
 * or a token coloured surface; the only raster asset is the header logo in
 * public/.
 * -------------------------------------------------------------------------- */

import "./landing.css";
import { useState, type FormEvent } from "react";
import { Brand } from "../../components/ui/Brand.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import type { AuthMode, AuthRole } from "../../components/auth/types.ts";
import { GrowthArt } from "./GrowthArt.tsx";
import { JourneyArt } from "./JourneyArt.tsx";
import {
  FLOW_STEPS,
  FOOTER_COLUMNS,
  HANDOFF_STEPS,
  LEGAL_LINKS,
  NAV_LINKS,
  NEWSLETTER_FEEDBACK,
  PLATFORM_HIGHLIGHTS,
  SECTION_IDS,
} from "./landing-content.ts";

export type OpenAuth = (options: { mode: AuthMode; role: AuthRole }) => void;

export type LandingPageProps = {
  /** Opens the shared auth screen pre-set to a mode (login/register) and role. */
  onOpenAuth: OpenAuth;
};

function LandingHeader({ onOpenAuth }: { onOpenAuth: OpenAuth }) {
  return (
    <header className="ld-header">
      <div className="ld-shell ld-header-inner">
        <Brand className="ld-brand" />
        <nav className="ld-nav" aria-label="SoukCart">
          {NAV_LINKS.map((link) => (
            <a className="ld-nav-link" href={link.href} key={link.label}>
              {link.label}
            </a>
          ))}
        </nav>
        <Button
          className="ld-signin"
          variant="secondary"
          size="compact"
          onClick={() => onOpenAuth({ mode: "login", role: "retailer" })}
        >
          Sign in
        </Button>
      </div>
    </header>
  );
}

function JourneyScene() {
  return (
    <div className="ld-scene">
      <JourneyArt />
      <ol className="ld-scene-steps" aria-label="How one order moves through SoukCart">
        {HANDOFF_STEPS.map((handoff) => (
          <li className="ld-handoff" data-handoff={handoff.step} key={handoff.step}>
            <span className="ld-handoff-step">{handoff.step}</span>
            <strong className="ld-handoff-title">{handoff.title}</strong>
            <small className="ld-handoff-detail">{handoff.detail}</small>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Hero({ onOpenAuth }: { onOpenAuth: OpenAuth }) {
  return (
    <section className="ld-shell ld-hero" aria-labelledby="ld-hero-title">
      <div className="ld-hero-copy">
        <h1 className="ld-hero-title" id="ld-hero-title">
          One market.
          <br />
          One <em className="ld-accent">order</em> line.
        </h1>
        <p className="ld-hero-lead">From supplier stock to your shop shelf.</p>
        <p className="ld-hero-body">
          Source wholesale essentials, order against available stock, and follow every handoff in
          one place.
        </p>
        <div className="ld-actions">
          <Button onClick={() => onOpenAuth({ mode: "login", role: "retailer" })}>
            <Icon name="store" />
            <span>Log in as retailer</span>
          </Button>
          <Button variant="secondary" onClick={() => onOpenAuth({ mode: "login", role: "seller" })}>
            <Icon name="package" />
            <span>Log in as supplier</span>
          </Button>
        </div>
        <p className="ld-hero-trust">
          <Icon name="lock" />
          <span>Trusted by suppliers and retailers across the market.</span>
        </p>
      </div>
      <JourneyScene />
    </section>
  );
}

function PlatformHighlights() {
  return (
    <section
      className="ld-shell ld-highlights"
      id={SECTION_IDS.platform}
      aria-labelledby="ld-highlights-title"
    >
      <div className="ld-highlights-heading">
        <div>
          <p className="eyebrow ld-eyebrow">Built for wholesale</p>
          <h2 className="ld-highlights-title" id="ld-highlights-title">
            Keep your market moving.
          </h2>
        </div>
        <p className="ld-highlights-copy">
          SoukCart brings the details of every order into one clear, dependable workflow.
        </p>
      </div>
      <div className="ld-highlight-grid">
        {PLATFORM_HIGHLIGHTS.map((highlight) => (
          <article className="ld-highlight-card" key={highlight.title}>
            <span className="ld-highlight-art">
              <Icon name={highlight.icon} />
            </span>
            <div>
              <h3 className="ld-highlight-title">{highlight.title}</h3>
              <p className="ld-highlight-copy">{highlight.copy}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section
      className="ld-shell ld-flow"
      id={SECTION_IDS.howItWorks}
      aria-labelledby="ld-flow-title"
    >
      <div className="ld-flow-intro">
        <p className="eyebrow ld-eyebrow">How it works</p>
        <h2 className="ld-flow-title" id="ld-flow-title">
          One order. End to end.
        </h2>
        <p className="ld-flow-copy">
          A simple process that connects suppliers and retailers seamlessly.
        </p>
      </div>
      <ol className="ld-flow-steps">
        {FLOW_STEPS.map((step) => (
          <li className="ld-flow-step" key={step.step}>
            <span className="ld-flow-art">
              <Icon name={step.icon} />
            </span>
            <span className="ld-flow-index">{step.step}</span>
            <strong className="ld-flow-step-title">{step.title}</strong>
            <span className="ld-flow-step-copy">{step.copy}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function JoinBand({ onOpenAuth }: { onOpenAuth: OpenAuth }) {
  return (
    <section className="ld-shell" id={SECTION_IDS.join} aria-labelledby="ld-join-title">
      <div className="ld-join">
        <GrowthArt />
        <div className="ld-join-copy">
          <p className="eyebrow ld-eyebrow">Ready to grow your business?</p>
          <h2 className="ld-join-title" id="ld-join-title">
            Join SoukCart today.
          </h2>
          <p className="ld-join-body">
            Whether you&apos;re a retailer or supplier, there&apos;s more when we connect.
          </p>
        </div>
        <div className="ld-actions ld-join-actions">
          <Button onClick={() => onOpenAuth({ mode: "register", role: "retailer" })}>
            <span>Buy for my shop</span>
            <Icon name="arrow-right" />
          </Button>
          <Button
            variant="secondary"
            onClick={() => onOpenAuth({ mode: "register", role: "seller" })}
          >
            Sell on SoukCart
          </Button>
        </div>
      </div>
    </section>
  );
}

function NewsletterSignup() {
  const [email, setEmail] = useState("");
  const [feedback, setFeedback] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(NEWSLETTER_FEEDBACK);
  };

  return (
    <form className="ld-newsletter" onSubmit={submit} noValidate={false}>
      <label className="ld-newsletter-field">
        <span className="sr-only">Email address</span>
        <input
          autoComplete="email"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Enter your email"
          required
          type="email"
          value={email}
        />
      </label>
      <Button
        aria-label="Subscribe to SoukCart updates"
        className="ld-newsletter-submit"
        type="submit"
      >
        <Icon name="arrow-right" />
      </Button>
      <p className="ld-newsletter-feedback" aria-live="polite" role="status">
        {feedback}
      </p>
    </form>
  );
}

function LandingFooter() {
  return (
    <footer className="ld-footer">
      <div className="ld-shell ld-footer-inner">
        <div className="ld-footer-brand">
          <p className="ld-footer-word">SoukCart</p>
          <p className="ld-footer-copy">
            The wholesale commerce platform that connects suppliers and retailers. One market. One
            order line.
          </p>
        </div>

        {FOOTER_COLUMNS.map((column) => (
          <nav className="ld-footer-column" aria-label={column.title} key={column.title}>
            <p className="ld-footer-heading">{column.title}</p>
            <ul>
              {column.links.map((link) => (
                <li key={link.label}>
                  <a className="ld-footer-link" href={link.href}>
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}

        <div className="ld-footer-column ld-footer-subscribe">
          <p className="ld-footer-heading">Stay updated</p>
          <p className="ld-footer-copy">Get product updates and market insights.</p>
          <NewsletterSignup />
        </div>
      </div>

      <div className="ld-shell">
        <div className="ld-footer-legal">
          <small>© 2024 SoukCart. All rights reserved.</small>
          <ul>
            {LEGAL_LINKS.map((link) => (
              <li key={link.label}>
                <a className="ld-footer-link" href={link.href}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}

export function LandingPage({ onOpenAuth }: LandingPageProps) {
  return (
    <div className="ld-page">
      <LandingHeader onOpenAuth={onOpenAuth} />
      <main className="ld-main">
        <Hero onOpenAuth={onOpenAuth} />
        <PlatformHighlights />
        <HowItWorks />
        <JoinBand onOpenAuth={onOpenAuth} />
      </main>
      <LandingFooter />
    </div>
  );
}
