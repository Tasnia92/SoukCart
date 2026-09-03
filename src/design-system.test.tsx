import { Home } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { Brand } from "./components/ui/Brand.tsx";
import { Button, buttonVariants } from "./components/ui/button.tsx";
import { SidebarProvider } from "./components/ui/sidebar.tsx";
import { SidebarNav } from "./components/ui/Workspace.tsx";

describe("shadcn design contract", () => {
  it("preserves the brand contract with Tailwind theme variants", () => {
    const brand = renderToStaticMarkup(<Brand variant="dark" />);

    expect(brand).toContain('href="/"');
    expect(brand).toContain('aria-label="SoukCart home"');
    expect(brand).toContain('src="/soukcart-logo.png"');
    expect(brand).toContain('alt=""');
    expect(brand).toContain("text-primary-foreground");
    expect(brand).toContain("SoukCart");
  });

  it("uses the official Button data-slot and variant contract", () => {
    const primary = renderToStaticMarkup(<Button type="button">Save</Button>);
    expect(primary).toContain('data-slot="button"');
    expect(primary).toContain('data-variant="default"');
    expect(primary).toContain('type="button"');

    const destructive = renderToStaticMarkup(
      <Button type="button" variant="destructive">
        Delete
      </Button>,
    );
    expect(destructive).toContain('data-variant="destructive"');

    const link = renderToStaticMarkup(
      <Button asChild variant="link">
        <a href="/somewhere">Go</a>
      </Button>,
    );
    expect(link).toContain('data-variant="link"');
    expect(link).toContain('href="/somewhere"');
    expect(link).not.toContain("type=");

    expect(buttonVariants({ variant: "ghost" })).toContain("hover:bg-muted");
    expect(buttonVariants({ size: "sm" })).toContain("h-8");
  });

  it("adds active navigation semantics through the official sidebar composition", () => {
    const sidebar = renderToStaticMarkup(
      <SidebarProvider>
        <SidebarNav
          label="Test navigation"
          items={[{ href: "/supplier", icon: Home, label: "Overview", active: true }]}
          userName="Supplier"
          userEmail="supplier@example.com"
          onLogout={() => undefined}
        />
      </SidebarProvider>,
    );

    expect(sidebar).toContain('aria-label="Test navigation"');
    expect(sidebar).toContain('data-slot="sidebar-menu-button"');
    expect(sidebar).toContain('data-active="true"');
    expect(sidebar).toContain('aria-current="page"');
    expect(sidebar).toContain("lucide-house");
  });
});
