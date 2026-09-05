import { useState, type FormEvent, type SVGProps } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, ChevronDownIcon, GlobeIcon } from "lucide-react";
import { Brand } from "@/components/ui/Brand";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  FOOTER_COLUMNS,
  HERO_POINTS,
  NAV_LINKS,
  NEWSLETTER_FEEDBACK,
  RETAILER_SECTION,
  RETAILER_STEPS,
  SECTION_IDS,
  SOCIAL_LINKS,
  SUPPLIER_SECTION,
  SUPPLIER_STEPS,
} from "./landing-content.ts";

function FacebookIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      {...props}
    >
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>
  );
}

function LinkedinIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      {...props}
    >
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
      <rect width="4" height="12" x="2" y="9" />
      <circle cx="4" cy="4" r="2" />
    </svg>
  );
}

function InstagramIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      {...props}
    >
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  );
}

const SOCIAL_ICONS = [FacebookIcon, LinkedinIcon, InstagramIcon];

function LandingHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Brand size="lg" />
        <nav className="hidden items-center gap-7 lg:flex" aria-label="SoukCart">
          {NAV_LINKS.map((link) => (
            <a
              className="text-sm font-medium text-foreground/75 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              href={link.href}
              key={link.label}
            >
              {link.label}
            </a>
          ))}
        </nav>
        <Button asChild className="px-4">
          <Link to="/login" search={{ role: "retailer" }}>
            Log in
          </Link>
        </Button>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative isolate overflow-hidden" aria-labelledby="ld-hero-title">
      <img
        src="/hero-bg.jpg"
        alt=""
        aria-hidden="true"
        className="absolute inset-0 size-full object-cover object-[72%_center]"
        width={1920}
        height={1080}
      />
      <div
        className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-transparent"
        aria-hidden="true"
      />
      <div className="relative mx-auto flex min-h-[38rem] max-w-7xl flex-col justify-center px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <h1
          className="text-4xl font-extrabold leading-[1.15] tracking-tight text-foreground sm:text-5xl"
          id="ld-hero-title"
        >
          <span className="block">Wholesale groceries.</span>
          <span className="block">Stronger businesses.</span>
          <span className="block text-primary">Better communities.</span>
        </h1>
        <p className="mt-6 max-w-md text-base leading-7 text-foreground/70">
          Soukcart is the B2B marketplace that connects grocery suppliers and retailers to buy and
          sell smarter, together.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg" className="px-5">
            <Link to="/register" search={{ role: "seller" }}>
              Join as Supplier
              <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="bg-background px-5">
            <Link to="/register" search={{ role: "retailer" }}>
              Join as Retailer
              <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
        </div>
        <ul className="mt-12 flex flex-wrap gap-x-10 gap-y-5">
          {HERO_POINTS.map((point) => {
            const PointIcon = point.icon;
            return (
              <li className="flex items-center gap-3" key={point.title}>
                <span className="grid size-11 shrink-0 place-items-center rounded-lg border border-border bg-background text-primary">
                  <PointIcon className="size-5" aria-hidden="true" />
                </span>
                <span className="flex max-w-40 flex-col">
                  <span className="text-sm font-semibold text-foreground">{point.title}</span>
                  <span className="text-xs leading-4 text-muted-foreground">{point.copy}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function StepList({ steps }: { steps: (typeof SUPPLIER_STEPS)[number][] }) {
  return (
    <ul className="flex flex-col gap-3">
      {steps.map((step) => {
        const StepIcon = step.icon;
        return (
          <li
            className="flex items-center gap-4 rounded-lg bg-background p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)] ring-1 ring-foreground/5"
            key={step.step}
          >
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
              {step.step}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[0.9375rem] font-semibold text-foreground">{step.title}</p>
              <p className="mt-0.5 text-sm leading-5 text-muted-foreground">{step.copy}</p>
            </div>
            <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <StepIcon className="size-5" aria-hidden="true" />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function JourneyColumn({
  sectionId,
  icon: SectionIcon,
  title,
  steps,
}: {
  sectionId: string;
  icon: typeof SUPPLIER_SECTION.icon;
  title: string;
  steps: (typeof SUPPLIER_STEPS)[number][];
}) {
  return (
    <div className="scroll-mt-24" id={sectionId}>
      <div className="mb-6 flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-lg bg-background text-primary shadow-sm ring-1 ring-foreground/5">
          <SectionIcon className="size-5" aria-hidden="true" />
        </span>
        <h3 className="text-xl font-bold text-foreground">{title}</h3>
      </div>
      <StepList steps={steps} />
    </div>
  );
}

function HowItWorks() {
  return (
    <section
      className="bg-[#F7F5F2] pt-16 sm:pt-20"
      id={SECTION_IDS.howItWorks}
      aria-labelledby="ld-flow-title"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-xl flex-col text-center">
          <p className="text-sm font-bold uppercase tracking-wide text-primary">How It Works</p>
          <h2
            className="mt-3 text-balance text-3xl font-bold tracking-tight text-foreground sm:text-[2rem]"
            id="ld-flow-title"
          >
            Built for how grocery businesses trade.
          </h2>
          <p className="mx-auto mt-3 max-w-md text-base leading-7 text-muted-foreground">
            Whether you supply or sell, Soukcart makes the process simple, transparent, and
            profitable.
          </p>
        </div>
        <div className="mt-12 grid gap-10 lg:grid-cols-2 lg:gap-16">
          <JourneyColumn
            sectionId={SECTION_IDS.forSuppliers}
            icon={SUPPLIER_SECTION.icon}
            title={SUPPLIER_SECTION.title}
            steps={SUPPLIER_STEPS}
          />
          <JourneyColumn
            sectionId={SECTION_IDS.forRetailers}
            icon={RETAILER_SECTION.icon}
            title={RETAILER_SECTION.title}
            steps={RETAILER_STEPS}
          />
        </div>
      </div>
    </section>
  );
}

function JoinBand() {
  return (
    <section
      className="bg-[#F7F5F2] pb-16 pt-12 sm:pb-20 sm:pt-14"
      id={SECTION_IDS.join}
      aria-labelledby="ld-join-title"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-2xl bg-[#FAF3EE]">
          <img
            src="/banner.png"
            alt=""
            aria-hidden="true"
            className="absolute inset-y-0 right-0 h-full w-auto max-w-none"
            width={1620}
            height={654}
          />
          <div
            className="absolute inset-0 bg-gradient-to-r from-[#FAF3EE] via-[#FAF3EE]/70 to-transparent"
            aria-hidden="true"
          />
          <div className="relative flex flex-col items-start gap-5 px-6 py-10 sm:px-10 sm:py-14 lg:px-14">
            <p className="text-sm font-bold uppercase tracking-wide text-primary">
              Ready to grow together?
            </p>
            <h2
              className="text-balance text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
              id="ld-join-title"
            >
              <span className="block">One platform.</span>
              <span className="block">Endless opportunities.</span>
            </h2>
            <p className="max-w-sm text-base leading-7 text-foreground/70">
              Join thousands of grocery businesses already growing with Soukcart.
            </p>
            <Button asChild size="lg" className="mt-2 px-5">
              <Link to="/register" search={{ role: "retailer" }}>
                Get Started Today
                <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
              </Link>
            </Button>
          </div>
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
    <form className="w-full" onSubmit={submit} noValidate={false}>
      <FieldGroup className="gap-2">
        <Field orientation="horizontal" className="relative">
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
            className="h-11 border-border bg-background pr-14"
          />
          <Button
            type="submit"
            size="icon"
            aria-label="Subscribe to SoukCart updates"
            className="absolute right-1.5 top-1.5 size-8 rounded-md"
          >
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
    <footer className="bg-background">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:grid-cols-2 sm:px-6 lg:grid-cols-[1.5fr_1fr_1fr_1fr_1.6fr] lg:gap-8 lg:px-8">
        <div className="flex flex-col gap-4">
          <Brand />
          <p className="max-w-64 text-sm leading-6 text-muted-foreground">
            Soukcart is a B2B marketplace for grocery suppliers and retailers to trade smarter and
            grow together.
          </p>
          <ul className="mt-2 flex gap-2.5">
            {SOCIAL_LINKS.map((social, index) => {
              const SocialIcon = SOCIAL_ICONS[index];
              return (
                <li key={social.label}>
                  <a
                    className="grid size-9 place-items-center rounded-full bg-muted text-foreground transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    href={social.href}
                    aria-label={social.label}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <SocialIcon className="size-4" aria-hidden="true" />
                  </a>
                </li>
              );
            })}
          </ul>
        </div>

        {FOOTER_COLUMNS.map((column) => (
          <nav className="flex flex-col gap-4" aria-label={column.title} key={column.title}>
            <p className="text-[0.9375rem] font-bold text-foreground">{column.title}</p>
            <ul className="flex flex-col gap-2.5">
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

        <div className="flex flex-col gap-4">
          <p className="text-[15px] font-bold text-foreground">Subscribe to our newsletter</p>
          <p className="text-sm leading-6 text-muted-foreground">
            Get updates on new features, offers and more.
          </p>
          <NewsletterSignup />
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Separator />
        <div className="flex flex-col gap-3 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <small>© {new Date().getFullYear()} Soukcart. All rights reserved.</small>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg px-1 py-1 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            aria-label="Change language, current language English"
          >
            <GlobeIcon className="size-4" aria-hidden="true" />
            <span>English</span>
            <ChevronDownIcon className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </footer>
  );
}

export function LandingPage() {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <LandingHeader />
      <main>
        <Hero />
        <HowItWorks />
        <JoinBand />
      </main>
      <LandingFooter />
    </div>
  );
}
