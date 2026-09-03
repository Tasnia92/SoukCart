import type { ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Brand } from "../components/ui/Brand.tsx";
import { Button } from "@/components/ui/button";
import { Icon, ICON_NAMES } from "../components/ui/Icon.tsx";
import {
  AppShell,
  EmptyState,
  InlineNotice,
  LoadingState,
  PageHeader,
  SearchToolbar,
  SidebarNav,
  StatCard,
  StatGrid,
  TableShell,
  WorkspaceError,
} from "../components/ui/Workspace.tsx";
import "./component-gallery.css";

const noop = () => undefined;

function ThemePanel({ dark = false }: { dark?: boolean }) {
  return (
    <section
      className={`design-gallery-theme${dark ? " dark" : ""} bg-background text-foreground border-border`}
      aria-label={`${dark ? "Dark" : "Light"} theme primitives`}
    >
      <div className="design-gallery-heading">
        <div>
          <p className="eyebrow">{dark ? "Dark tokens" : "Light tokens"}</p>
          <h2 className="display-md">SoukCart primitives</h2>
        </div>
        <Brand variant={dark ? "dark" : "default"} />
      </div>

      <div className="design-gallery-swatches" aria-label="Semantic color roles">
        <TokenSwatch className="bg-background text-foreground border-border" label="Background" />
        <TokenSwatch
          className="bg-card text-card-foreground border-border shadow-sm"
          label="Card"
        />
        <TokenSwatch className="bg-muted text-muted-foreground border-border" label="Muted" />
        <TokenSwatch
          className="bg-primary text-primary-foreground border-primary"
          label="Primary"
        />
        <TokenSwatch className="bg-accent text-accent-foreground border-border" label="Accent" />
        <TokenSwatch
          className="bg-destructive text-destructive-foreground border-destructive"
          label="Destructive"
        />
      </div>

      <div className="design-gallery-actions">
        <Button>
          <Icon name="plus" />
          Primary
        </Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Subtle</Button>
        <Button variant="link">Text action</Button>
        <Button variant="destructive">Delete</Button>
        <Button size="sm">Compact</Button>
        <Button variant="ghost" size="icon" aria-label="Refresh preview">
          <Icon name="refresh" />
        </Button>
        <Button disabled>Working…</Button>
        <Button aria-pressed="true">Pressed</Button>
        <Button asChild variant="secondary">
          <a href="#workspace-preview">Anchor action</a>
        </Button>
      </div>

      <Button className="w-full">A deliberately long block action label for narrow layouts</Button>
    </section>
  );
}

function TokenSwatch({ className, label }: { className: string; label: string }) {
  return <span className={`design-gallery-swatch border ${className}`}>{label}</span>;
}

function GallerySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="design-gallery-section">
      <h2 className="display-md">{title}</h2>
      {children}
    </section>
  );
}

function WorkspacePreview() {
  return (
    <div className="design-gallery-workspace" id="workspace-preview">
      <AppShell
        sidebar={
          <SidebarNav
            label="Gallery navigation"
            items={[
              { href: "#__gallery-overview", icon: "home", label: "Overview", active: true },
              { href: "#__gallery-orders", icon: "package", label: "Orders" },
              { href: "#__gallery-products", icon: "bag", label: "Products" },
              { href: "#__gallery-stock", icon: "layers", label: "Stock" },
            ]}
            userName="A deliberately long supplier name"
            userEmail="supplier.gallery@example.com"
            onLogout={noop}
          />
        }
      >
        <PageHeader
          eyebrow="Development gallery"
          title="Everything in sync."
          copy="Shared workspace pieces reuse the current production CSS contract."
          actions={
            <>
              <Button>
                <Icon name="plus" />
                Add product
              </Button>
              <Button variant="ghost">Refresh</Button>
            </>
          }
        />
        <InlineNotice message="Changes are shown inline, never as a toast." state="success" />
        <StatGrid label="Gallery statistics">
          <StatCard label="Products" value="128" detail="All listings" />
          <StatCard label="Active" value="96" detail="Visible now" />
          <StatCard label="Out of stock" value="12" detail="Needs attention" />
          <StatCard label="Units" value="4,216" detail="Across products" />
        </StatGrid>
        <SearchToolbar
          label="Search gallery products"
          placeholder="Search products"
          result="3 of 128 products"
        />
        <TableShell>
          <Table className="design-gallery-table">
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Miniket rice, 50 kg sack</TableCell>
                <TableCell>Active</TableCell>
                <TableCell>24</TableCell>
                <TableCell>
                  <Button variant="link">Edit</Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableShell>
        <EmptyState
          icon="store"
          title="No matching products"
          copy="Try a different search term."
          action={<Button>Clear search</Button>}
        />
        <LoadingState title="Loading the workspace…" copy="This usually takes a few seconds." />
      </AppShell>
    </div>
  );
}

export function ComponentGallery() {
  return (
    <div className="design-gallery min-h-screen bg-background text-foreground font-sans">
      <header className="design-gallery-intro">
        <p className="eyebrow">Private development surface</p>
        <h1 className="display-xl">SoukCart design foundation.</h1>
        <p className="body-copy">
          Token aliases, exact legacy primitives, responsive workspace patterns, and interaction
          states. This gallery is excluded from production routing.
        </p>
      </header>

      <div className="design-gallery-themes">
        <ThemePanel />
        <ThemePanel dark />
      </div>

      <GallerySection title="Hand-authored icons">
        <div className="design-gallery-icons">
          {ICON_NAMES.map((name) => (
            <span className="design-gallery-icon" key={name} title={name}>
              <Icon name={name} />
              <small>{name}</small>
            </span>
          ))}
        </div>
      </GallerySection>

      <GallerySection title="Focus and feedback">
        <div className="design-gallery-actions">
          <Button>Keyboard focus target</Button>
          <Button variant="secondary" disabled>
            Disabled secondary
          </Button>
          <span
            className="design-gallery-circle rounded-full bg-primary"
            aria-label="Intentional circle"
          />
        </div>
        <InlineNotice message="Information notice" />
        <InlineNotice message="Something needs attention" state="error" />
      </GallerySection>

      <GallerySection title="Shared workspace">
        <WorkspacePreview />
      </GallerySection>

      <GallerySection title="Full-page error state">
        <WorkspaceError
          eyebrow="Supplier workspace"
          title="We could not load your catalog."
          message="The server returned an example error."
          onRetry={noop}
          onLogout={noop}
        />
      </GallerySection>
    </div>
  );
}
