import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { Brand } from "./components/ui/Brand.tsx";
import { buttonClassName } from "./components/ui/Button.tsx";
import { Icon, ICON_NAMES, iconPaths } from "./components/ui/Icon.tsx";
import { SidebarNav } from "./components/ui/Workspace.tsx";

function svgBody(markup: string): string {
  return markup.slice(markup.indexOf(">") + 1, markup.lastIndexOf("</svg>"));
}

describe("Phase 2 design contract", () => {
  it("renders every registered icon with the hand-authored SVG registry", () => {
    expect(ICON_NAMES).toHaveLength(25);
    expect(new Set(ICON_NAMES)).toEqual(new Set(Object.keys(iconPaths)));

    for (const name of ICON_NAMES) {
      const reactIcon = renderToStaticMarkup(<Icon name={name} />);
      expect(reactIcon).toContain('viewBox="0 0 24 24"');
      expect(reactIcon).toContain('aria-hidden="true"');
      expect(reactIcon).toContain('focusable="false"');
      expect(svgBody(reactIcon)).toBe(iconPaths[name]);
    }
  });

  it("preserves brand and button class contracts", () => {
    const brand = renderToStaticMarkup(<Brand variant="dark" />);
    expect(brand).toContain('class="brand brand-dark"');
    expect(brand).toContain('href="/"');
    expect(brand).toContain('src="/soukcart-logo.png"');
    expect(brand).toContain('alt=""');
    expect(brand).toContain("SoukCart");

    expect(buttonClassName()).toBe("button button-primary");
    expect(buttonClassName({ variant: "secondary", block: true })).toBe(
      "button button-secondary button-block",
    );
    expect(buttonClassName({ variant: "destructive", size: "compact" })).toBe(
      "delete-button button-compact",
    );
    expect(buttonClassName({ variant: "subtle", size: "icon" })).toBe(
      "button button-subtle icon-button",
    );
  });

  it("adds active navigation semantics without changing legacy classes", () => {
    const sidebar = renderToStaticMarkup(
      <SidebarNav
        label="Test navigation"
        items={[{ href: "/supplier", icon: "home", label: "Overview", active: true }]}
        userName="Supplier"
        userEmail="supplier@example.com"
        onLogout={() => undefined}
      />,
    );
    expect(sidebar).toContain('class="admin-tab is-active"');
    expect(sidebar).toContain('aria-current="page"');
  });
});
