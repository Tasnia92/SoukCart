export function renderBrand(variant: "light" | "dark" = "light"): string {
  const modifier = variant === "dark" ? " brand-dark" : "";
  return `<a class="brand${modifier}" href="/" aria-label="SoukCart home">
    <img class="brand-logo" src="/soukcart-logo.png" alt="" width="1536" height="1024" />
    <span class="brand-word">SoukCart</span>
  </a>`;
}
