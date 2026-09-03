import { useState, type FormEvent } from "react";
import { ArrowRightIcon, LockKeyholeIcon, PackageIcon, StoreIcon } from "lucide-react";
import { Brand } from "@/components/ui/Brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
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
    <header className="sticky top-0 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <Brand />
        <nav
          className="order-last flex w-full items-center gap-1 overflow-x-auto pt-1 md:order-none md:w-auto md:pt-0"
          aria-label="SoukCart"
        >
          {NAV_LINKS.map((link) => (
            <a
              className="rounded-full px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              href={link.href}
              key={link.label}
            >
              {link.label}
            </a>
          ))}
        </nav>
        <Button
          type="button"
          variant="secondary"
          size="sm"
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
    <div className="flex min-w-0 flex-col gap-4">
      <JourneyArt />
      <ol
        className="grid grid-cols-2 gap-3 sm:grid-cols-4"
        aria-label="How one order moves through SoukCart"
      >
        {HANDOFF_STEPS.map((handoff) => (
          <li data-handoff={handoff.step} key={handoff.step}>
            <Card className="h-full" size="sm">
              <CardHeader>
                <Badge className="w-fit" variant="outline">
                  {handoff.step}
                </Badge>
                <CardTitle>{handoff.title}</CardTitle>
                <CardDescription>
                  <small>{handoff.detail}</small>
                </CardDescription>
              </CardHeader>
            </Card>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Hero({ onOpenAuth }: { onOpenAuth: OpenAuth }) {
  return (
    <section
      className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[0.9fr_1.1fr] lg:px-8"
      aria-labelledby="ld-hero-title"
    >
      <div className="flex flex-col gap-6">
        <h1
          className="text-balance text-5xl font-semibold tracking-tight sm:text-6xl lg:text-7xl"
          id="ld-hero-title"
        >
          One market.
          <br />
          One <em className="not-italic text-primary">order</em> line.
        </h1>
        <div className="flex flex-col gap-3">
          <p className="text-xl font-medium sm:text-2xl">From supplier stock to your shop shelf.</p>
          <p className="max-w-xl text-base leading-7 text-muted-foreground">
            Source wholesale essentials, order against available stock, and follow every handoff in
            one place.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            type="button"
            size="lg"
            onClick={() => onOpenAuth({ mode: "login", role: "retailer" })}
          >
            <StoreIcon data-icon="inline-start" aria-hidden="true" />
            <span>Log in as retailer</span>
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={() => onOpenAuth({ mode: "login", role: "seller" })}
          >
            <PackageIcon data-icon="inline-start" aria-hidden="true" />
            <span>Log in as supplier</span>
          </Button>
        </div>
        <p className="flex max-w-xl items-start gap-2 text-sm text-muted-foreground sm:items-center">
          <LockKeyholeIcon className="mt-0.5 size-4 shrink-0 sm:mt-0" aria-hidden="true" />
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
      className="border-y bg-muted/30"
      id={SECTION_IDS.platform}
      aria-labelledby="ld-highlights-title"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
        <div className="grid gap-5 md:grid-cols-[1fr_0.8fr] md:items-end">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-primary">Built for wholesale</p>
            <h2
              className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl"
              id="ld-highlights-title"
            >
              Keep your market moving.
            </h2>
          </div>
          <p className="text-base leading-7 text-muted-foreground md:text-right">
            SoukCart brings the details of every order into one clear, dependable workflow.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {PLATFORM_HIGHLIGHTS.map((highlight) => {
            const HighlightIcon = highlight.icon;
            return (
              <article key={highlight.title}>
                <Card className="h-full">
                  <CardHeader>
                    <CardTitle>
                      <h3>{highlight.title}</h3>
                    </CardTitle>
                    <CardDescription>{highlight.copy}</CardDescription>
                    <CardAction>
                      <Badge variant="secondary">
                        <HighlightIcon aria-hidden="true" />
                      </Badge>
                    </CardAction>
                  </CardHeader>
                </Card>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section
      className="mx-auto flex max-w-7xl flex-col gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:px-8"
      id={SECTION_IDS.howItWorks}
      aria-labelledby="ld-flow-title"
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-2 text-center">
        <p className="text-sm font-medium text-primary">How it works</p>
        <h2
          className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl"
          id="ld-flow-title"
        >
          One order. End to end.
        </h2>
        <p className="text-base leading-7 text-muted-foreground">
          A simple process that connects suppliers and retailers seamlessly.
        </p>
      </div>
      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FLOW_STEPS.map((step) => {
          const StepIcon = step.icon;
          return (
            <li key={step.step}>
              <Card className="h-full">
                <CardHeader>
                  <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <StepIcon className="size-5" aria-hidden="true" />
                  </div>
                  <CardTitle>{step.title}</CardTitle>
                  <CardDescription>{step.copy}</CardDescription>
                  <CardAction>
                    <Badge variant="outline">{step.step}</Badge>
                  </CardAction>
                </CardHeader>
              </Card>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function JoinBand({ onOpenAuth }: { onOpenAuth: OpenAuth }) {
  return (
    <section
      className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8"
      id={SECTION_IDS.join}
      aria-labelledby="ld-join-title"
    >
      <Card>
        <CardHeader className="text-center">
          <p className="text-sm font-medium text-primary">Ready to grow your business?</p>
          <CardTitle>
            <h2
              className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl"
              id="ld-join-title"
            >
              Join SoukCart today.
            </h2>
          </CardTitle>
          <CardDescription>
            Whether you&apos;re a retailer or supplier, there&apos;s more when we connect.
          </CardDescription>
        </CardHeader>
        <CardContent className="mx-auto w-full max-w-md">
          <GrowthArt />
        </CardContent>
        <CardFooter className="flex-col justify-center gap-3 border-t sm:flex-row">
          <Button
            type="button"
            size="lg"
            onClick={() => onOpenAuth({ mode: "register", role: "retailer" })}
          >
            <span>Buy for my shop</span>
            <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={() => onOpenAuth({ mode: "register", role: "seller" })}
          >
            Sell on SoukCart
          </Button>
        </CardFooter>
      </Card>
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
    <form className="w-full" onSubmit={submit} noValidate={false}>
      <FieldGroup className="gap-2">
        <Field orientation="horizontal" className="gap-2">
          <FieldLabel className="sr-only" htmlFor="newsletter-email">
            Email address
          </FieldLabel>
          <Input
            id="newsletter-email"
            autoComplete="email"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Enter your email"
            required
            type="email"
            value={email}
          />
          <Button type="submit" size="icon" aria-label="Subscribe to SoukCart updates">
            <ArrowRightIcon aria-hidden="true" />
          </Button>
        </Field>
        <p className="min-h-5 text-sm text-muted-foreground" aria-live="polite" role="status">
          {feedback}
        </p>
      </FieldGroup>
    </form>
  );
}

function LandingFooter() {
  return (
    <footer className="border-t bg-muted/20">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:grid-cols-2 sm:px-6 lg:grid-cols-5 lg:px-8">
        <div className="flex flex-col gap-3">
          <p className="text-lg font-semibold">SoukCart</p>
          <p className="text-sm leading-6 text-muted-foreground">
            The wholesale commerce platform that connects suppliers and retailers. One market. One
            order line.
          </p>
        </div>

        {FOOTER_COLUMNS.map((column) => (
          <nav className="flex flex-col gap-3" aria-label={column.title} key={column.title}>
            <p className="text-sm font-semibold">{column.title}</p>
            <ul className="flex flex-col gap-2">
              {column.links.map((link) => (
                <li key={link.label}>
                  <a
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    href={link.href}
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}

        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold">Stay updated</p>
          <p className="text-sm leading-6 text-muted-foreground">
            Get product updates and market insights.
          </p>
          <NewsletterSignup />
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Separator />
        <div className="flex flex-col gap-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <small>© 2024 SoukCart. All rights reserved.</small>
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            {LEGAL_LINKS.map((link) => (
              <li key={link.label}>
                <a
                  className="transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  href={link.href}
                >
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
    <div className="min-h-svh bg-background text-foreground">
      <LandingHeader onOpenAuth={onOpenAuth} />
      <main>
        <Hero onOpenAuth={onOpenAuth} />
        <PlatformHighlights />
        <HowItWorks />
        <JoinBand onOpenAuth={onOpenAuth} />
      </main>
      <LandingFooter />
    </div>
  );
}
