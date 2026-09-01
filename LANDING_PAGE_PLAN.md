# SoukCart Homepage — Faire-Inspired Marketplace Plan

> **Direction:** Merchandise-first wholesale marketplace  
> **Reference:** Faire’s discovery-led homepage structure  
> **SoukCart identity:** Warm cream, sand, ink, terracotta, sharp geometry, Geist  
> **Primary route:** `/` for signed-out visitors

---

## 1. Design intent

The homepage should feel like a real wholesale marketplace from the first screen. Visitors should immediately be able to search, understand the catalog, browse categories, see popular products, and choose whether they are buying for a shop or supplying the market.

The structural inspiration is [Faire’s marketplace homepage](https://www.faire.com/) and its [retailer/brand model](https://www.faire.com/how-faire-works): prominent search, category-led discovery, image-first merchandising, repeated product shelves, editorial supplier stories, and separate paths for retailers and suppliers.

SoukCart should **borrow that commerce hierarchy, not Faire’s trade dress**. Do not copy Faire’s logo, wording, icons, exact layouts, product imagery, or proprietary claims. SoukCart keeps its own palette, sharp corners, Geist typography, Bangladeshi taka pricing, food/household categories, and operational stock/order focus.

### Remove from the previous direction

- No giant cropped `SOUK / CART` hero typography
- No page-long Order Spine
- No sticky order Docket controlling the whole page
- No experimental scroll narrative
- No oversized editorial product strips that slow down browsing

The new homepage should be calmer, easier to scan, and substantially more product-led.

---

## 2. Visual foundation

## 2.1 Background system — exact values

The entire homepage uses the warm SoukCart palette. Pure white must not become the visible page background.

| Role             |     Value | Exact use                                                          |
| ---------------- | --------: | ------------------------------------------------------------------ |
| Main canvas      | `#FAF9F5` | Body, header, product shelves, footer ground                       |
| Soft surface     | `#F5F4EF` | Search field, product-card information areas, quiet panels         |
| Sand section     | `#EDE9DE` | Main hero, retailer benefit band, image grounds                    |
| Deep sand        | `#E9E6DC` | Category navigation, alternate merchandising bands, supplier story |
| Hairlines        | `#DAD9D4` | Borders, shelf dividers, header rules                              |
| Text             | `#141413` | Primary headings, names, prices, navigation                        |
| Body text        | `#3D3929` | Descriptions and supporting copy                                   |
| Muted text       | `#6E6D68` | Supplier names, units, metadata                                    |
| Terracotta       | `#C96442` | Primary CTAs, active category, sale/stock accents                  |
| Terracotta hover | `#B05730` | Hover and pressed primary actions                                  |

### Background sequence

The page should visibly alternate warm neutrals so long product shelves remain readable:

```text
Utility bar       #E9E6DC
Main header       #FAF9F5
Category nav      #FAF9F5
Hero              #EDE9DE
Category tiles    #FAF9F5
Best sellers      #FAF9F5
Retailer benefits #E9E6DC
Curated markets   #FAF9F5
Restock shelf     #F5F4EF
Supplier story    #EDE9DE
New arrivals      #FAF9F5
Supplier CTA      #141413
Footer            #FAF9F5
```

### Color rules

- `#FAF9F5` should cover roughly 55–65% of the page.
- Sand tones should create section boundaries, not decorative patches.
- Terracotta should stay under roughly 8% of the visible page and indicate action or state.
- Never place a large terracotta background directly beside another highly saturated image.
- Product photography may contain natural color; the interface chrome stays within the palette.
- Existing dark-mode tokens remain authoritative when `.dark` is present.

## 2.2 Typography

Use Geist across the app and homepage.

| Use                     | Family     | Treatment                              |
| ----------------------- | ---------- | -------------------------------------- |
| Headlines               | Geist Sans | 600–700, sentence case, tight tracking |
| Body and navigation     | Geist Sans | 400–500                                |
| Product prices          | Geist Mono | 500, tabular numerals                  |
| Stock and unit metadata | Geist Mono | 400–500                                |

### Suggested scale

- Hero heading: `clamp(2.75rem, 5vw, 4.75rem)`, line-height `0.98`, weight 650–700
- Section heading: `clamp(1.75rem, 3vw, 2.5rem)`, line-height `1.1`, weight 600
- Product name: 15–16px, weight 500–600
- Body: 16–18px, line-height `1.5`
- Metadata: 12–14px

Avoid all-uppercase display headlines. Uppercase is reserved for small operational labels such as `IN STOCK`, `MOST ORDERED`, and `COD AVAILABLE`.

## 2.3 Shape and depth

- Standard radius remains `0`.
- Product images, promotional tiles, search, menus, and buttons remain sharp-edged.
- Use 1px `#DAD9D4` rules instead of floating shadows.
- Product cards can be borderless when the image and spacing make the boundaries clear.
- Only true quantity buttons, status dots, or avatars may be circular.
- No glass panels, gradients, glow, or frosted navigation.

---

## 3. Page shell

### Width

- Main content maximum: 1440px for merchandising shelves
- Text-heavy content maximum: 1200px
- Desktop gutters: `clamp(1.5rem, 4vw, 4rem)`
- Product grid: 5 columns on wide desktop, 4 on standard desktop, 2 on mobile
- Shelf gap: 16–24px

### Existing breakpoints

- Above `62rem`: full header, category navigation, 4–5 product columns
- At `62rem`: compressed header, 3 product columns, stacked hero when needed
- At `45rem`: mobile header, horizontally scrollable shelves or 2-column grids
- At `35rem`: tighter gutters, full-width CTAs, 1.4–2 visible shelf cards to suggest horizontal scrolling

---

## 4. Header and navigation

Faire’s strongest relevant pattern is that the marketplace navigation is useful before the visitor reaches the hero. SoukCart should do the same.

## 4.1 Utility bar

**Background:** `#E9E6DC`  
**Height:** 32–36px  
**Border:** bottom hairline

### Left

- `Wholesale for independent retailers`

### Right

- `For retailers`
- `For suppliers`
- `Help` only when a real help destination exists

Use 12–13px Geist Sans. Do not turn these into promotional badges.

## 4.2 Main header

**Background:** `#FAF9F5`  
**Height:** 72–80px  
**Layout:** logo / search / account actions

### Left

Use the existing SoukCart raster logo with the live-text wordmark.

### Center search

The search is the dominant header control.

**Placeholder:** `Search products, categories, or suppliers`

**Treatment:**

- Background `#F5F4EF`
- 1px `#DAD9D4` border
- Search icon at the start
- Clear button when populated
- Minimum height 48px
- No rounded capsule
- Focus border/ring `#C96442`

For signed-out visitors, submitting a search can either show approved public results or preserve the query through registration. Do not present a search control that silently discards input.

### Right

- `Sign in`
- `Join as retailer` — primary terracotta
- Compact `Sell on SoukCart` link

Signed-in visitors see `Open workspace` and their cart/order entry point.

## 4.3 Category navigation

**Background:** `#FAF9F5`  
**Height:** 44–48px  
**Borders:** top and bottom hairline

Show the highest-priority categories first:

1. Rice & Grains
2. Pulses & Lentils
3. Oils & Ghee
4. Vegetables
5. Fruits
6. Dairy & Eggs
7. Meat & Fish
8. Spices
9. Snacks & Drinks
10. Bakery & Sweets
11. Household
12. All categories

The row scrolls horizontally on smaller screens. The active category uses an ink or terracotta underline, not a rounded pill.

---

## 5. Homepage sequence

## 5.1 Merchandising hero

The hero should resemble a wholesale campaign on a marketplace homepage: concise message on one side, a rich product composition on the other.

**Background:** `#EDE9DE`  
**Desktop height:** approximately 520–620px  
**Layout:** 42% copy / 58% product photography

### Copy

**Eyebrow:** `Wholesale for your shelves`  
**Headline:**

> Stock your shop with products that move.

**Body:**

> Browse supplier stock, compare unit prices, and place your wholesale order in one clear flow.

**Primary CTA:** `Shop wholesale`  
**Secondary CTA:** `Sell on SoukCart`

Under the CTAs, use a quiet capability line:

`Live stock • Online or cash on delivery • Order tracking`

### Product composition

Use one large editorial image or a four-image modular collage featuring SoukCart categories:

- Open rice sack
- Lentils or spices
- Oil/ghee bottle
- Fresh produce crate

The collage uses hard rectangular crops separated by 4–8px cream/sand gutters. No text is generated inside the image.

### Optional seasonal variant

The hero may support manually curated campaigns such as:

- Ramadan pantry restock
- Everyday shop essentials
- Fresh market arrivals
- Tea and snack shelf

Campaign copy and assets must be managed content, not hard-coded into layout logic.

## 5.2 Shop by category

**Background:** `#FAF9F5`  
**Heading:** `Shop by category`  
**Action:** `View all categories`

### Layout

- 6 image tiles on wide desktop
- 3 × 2 on tablet
- Horizontal rail with 2.3 visible tiles on mobile

### Featured categories

- Rice & Grains
- Pulses & Lentils
- Oils & Ghee
- Spices
- Snacks & Drinks
- Household

### Tile treatment

- 4:3 image
- Category name below the image, not over it
- Optional real product count in muted text
- No card shadow
- No radius
- Image ground may alternate between `#EDE9DE` and `#E9E6DC`

## 5.3 Best sellers this week

**Background:** `#FAF9F5`  
**Heading:** `Best sellers this week`  
**Subheading:** `Products with the highest delivered quantity in the last 30 days.`

This is the first Faire-like horizontal product shelf.

### Shelf behavior

- 5 cards visible on wide screens
- 4 on standard desktop
- 2 on tablet
- 1.4–2 on mobile with native horizontal scrolling
- Previous/next controls on desktop
- `View all` link aligned with the heading
- Use scroll snap on touch devices

### Initial design fixtures

| Product      | Display price | Unit | Source status             |
| ------------ | ------------: | ---- | ------------------------- |
| Miniket rice |     `৳125.50` | kg   | Existing test product     |
| Atlas dates  |     `৳240.00` | kg   | Existing in-stock fixture |
| Mint tea     |     `৳180.00` | box  | Existing active fixture   |

Add more products only from approved launch inventory.

### Truthful ranking

- Rank by delivered order-item quantity over the previous 30 days.
- Aggregate on the server; never expose raw customer orders.
- Include active products and current supplier attribution.
- Prefer products currently in stock.
- If there is not enough data, rename the section `Popular picks` or `Featured products` and remove best-seller claims.

## 5.4 Product-card specification

All homepage shelves use one consistent card.

### Card order

1. Product image, 4:5 or 4:3
2. Stock label where relevant
3. Product name
4. Supplier display name
5. Price and unit
6. Optional quantity/add action

### Example

```text
[ PRODUCT IMAGE ]
IN STOCK
Miniket rice
Supplier name
৳125.50 / kg
[ − ] 1 [ + ]    [ Add ]
```

### Rules

- Image background: `#F5F4EF` or `#EDE9DE`
- Card body: `#FAF9F5` on canvas sections; `#F5F4EF` on sand sections
- Product name: Geist Sans 500–600
- Supplier: muted Geist Sans
- Price: Geist Mono 500
- Stock: explicit text, never color only
- No stars or reviews until the app has a review model
- No favorite button until the app has a saved-item model
- No minimum-order claim until supported by the product model
- Add actions must enforce authentication and current stock

## 5.5 Retailer benefits strip

**Background:** `#E9E6DC`  
**Layout:** four equal columns separated by vertical hairlines

### Heading

> Wholesale ordering without the back-and-forth.

### Benefits

1. **Stock you can see**  
   Order against current supplier availability.
2. **Clear unit pricing**  
   Compare products by their selling unit.
3. **Flexible checkout**  
   Pay online or choose cash on delivery.
4. **Orders in one place**  
   Follow progress and return to invoices.

Use small hand-authored line icons or no icons. Do not put each benefit in a floating card.

## 5.6 Curated market collections

**Background:** `#FAF9F5`  
**Heading:** `Curated for the way you stock`

Use two wide editorial tiles, similar to marketplace campaign modules but distinctly SoukCart.

### Collection A

**Title:** `Everyday pantry restock`  
**Copy:** `Rice, lentils, oil, spices, and the staples customers ask for every day.`  
**CTA:** `Shop pantry essentials`

### Collection B

**Title:** `Tea, snacks, and quick sellers`  
**Copy:** `Build the counter shelf with easy-to-order boxes and packs.`  
**CTA:** `Shop snacks and drinks`

### Layout

- First tile: 60% image / 40% copy on `#EDE9DE`
- Second tile: 40% copy / 60% image on `#E9E6DC`
- Alternate image position to avoid repetition
- Stack on mobile with image first

## 5.7 Restock essentials shelf

**Background:** `#F5F4EF`  
**Heading:** `Restock essentials`  
**Subheading:** `Reliable products for everyday shop inventory.`

Use another horizontal product shelf. Unlike best sellers, this can be manually curated by category or product IDs. It must never pretend to be algorithmically personalized when it is not.

Recommended initial category mix:

- Rice & Grains
- Pulses & Lentils
- Oils & Ghee
- Household

Card bodies use `#F5F4EF`; image wells use `#E9E6DC` so the shelf remains visible against the soft surface.

## 5.8 Supplier story

**Background:** `#EDE9DE`  
**Layout:** 55% documentary supplier image / 45% story

Faire uses brand stories to make a large marketplace feel human. SoukCart should adapt this to real suppliers only.

### Content model

- Supplier name
- One-line location, if approved
- 2–3 sentence supplier story
- Product categories supplied
- 3 small product thumbnails
- `View supplier products` CTA

### Placeholder copy structure

**Eyebrow:** `Supplier spotlight`  
**Headline:** `[Supplier name] keeps everyday essentials moving.`  
**Body:** `[Two approved sentences about the supplier, sourcing, operation, or product focus.]`

Do not invent a founder story, quote, location, certification, or production method. If no approved supplier story exists, replace this module with a category campaign.

## 5.9 New arrivals shelf

**Background:** `#FAF9F5`  
**Heading:** `New to the market`  
**Subheading:** `Recently published products from active suppliers.`

Sort by a real creation/publication timestamp descending. If the product table does not expose a reliable timestamp, use a manually curated section and call it `Fresh picks`.

## 5.10 Retailer conversion band

**Background:** `#E9E6DC`

### Copy

**Headline:** `Buying for your shop? Start with the shelves.`  
**Body:** `Create a retailer account to build orders, choose payment, and track delivery progress.`  
**CTA:** `Join as retailer`

Use a compact collage of ordered products rather than a dashboard screenshot.

## 5.11 Supplier acquisition band

**Background:** `#141413`  
**Text:** `#FAF9F5`  
**Accent:** `#C96442`

### Copy

**Eyebrow:** `For suppliers`  
**Headline:** `Put your products in front of the next shop order.`  
**Body:** `Publish products, update stock, and move incoming orders from confirmation to shipping.`  
**Primary CTA:** `Sell on SoukCart`  
**Secondary CTA:** `Sign in`

Use one documentary product/packing image with a hard rectangular crop. No fake growth metrics or unsupported “storefront sync” claim.

## 5.12 Footer

**Background:** `#FAF9F5`  
**Border:** top hairline

### Columns

- Brand statement
- Shop: categories, best sellers, new arrivals
- Retailers: join, sign in, orders when authorized
- Suppliers: sell, sign in
- Legal/help links only when real destinations exist

Bottom row includes the current year and `SoukCart`. No newsletter form unless email marketing and consent handling are actually implemented.

---

## 6. Responsive behavior

## Desktop

- Full utility, main, and category header stack
- Search remains the largest header control
- Hero stays side by side
- Product shelves show 4–5 cards
- Collection and supplier modules use editorial split layouts

## Tablet — `62rem` and below

- Utility links reduce to the two audience paths
- Search moves to a full-width second header row if necessary
- Hero can use 45/55 or stack below approximately 800px
- Product shelves show 2–3 cards
- Benefits become a 2 × 2 grid

## Mobile — `45rem` and below

- Header row: menu / centered brand / account or cart
- Search occupies its own full-width row
- Category navigation remains horizontally scrollable
- Hero stacks copy then imagery
- Category and product shelves use native horizontal scrolling
- `View all` stays visible beside or below each section heading
- Curated and supplier modules stack image first
- Retailer/supplier CTAs become full width

## Small mobile — `35rem` and below

- Page gutters reduce to 16px
- Hero heading stays at least 40–44px where possible
- Product shelves show approximately 1.35 cards to signal more content
- Do not hide price, unit, stock, or supplier name
- No sticky bottom element may cover product actions

---

## 7. Interaction patterns

### Search

- Suggestions may group products, categories, and suppliers.
- Keyboard users can move through suggestions and close with Escape.
- Empty search submits nothing.
- Signed-out searches preserve the query through auth if results are protected.

### Shelves

- Desktop arrow controls have accessible names.
- Touch devices use native scrolling and scroll snap.
- Do not autoplay any shelf.
- Do not hide essential products inside an inaccessible carousel.
- `View all` always provides a non-carousel path.

### Product actions

- Quantity controls preserve 44px targets.
- Add feedback appears inline, such as `Added to order`.
- Out-of-stock products cannot be added.
- Price and stock refresh from current data before mutation.

### Motion

- Use 160–240ms opacity/background transitions.
- Product images may scale to a maximum of 1.02 on hover.
- No parallax, scroll-jacking, large entrance choreography, or continuous marquee animation.
- Respect the existing reduced-motion stylesheet.

---

## 8. AI asset generation prompts

## Shared photographic direction

Append this to all photography prompts:

> Contemporary wholesale marketplace photography for a South Asian B2B commerce homepage, documentary but carefully composed, warm natural side light, tactile real food and packaging, cream `#FAF9F5` and sand `#EDE9DE` surfaces, restrained terracotta `#C96442` prop detail, sharp rectangular composition, realistic scale, practical independent-shop mood, natural color, no gradient, no glossy 3D render, no floating products, no rounded UI, no person unless requested, no text, no letters, no numbers, no logo, no watermark, no branded packaging.

Generate at 2× the required display dimensions. The interface must add all names, prices, labels, ranks, and CTAs as HTML.

## Asset 1 — hero wholesale collage source

**Filename:** `landing-hero-market.webp`  
**Ratio:** 4:3  
**Minimum:** 2000 × 1500

**Prompt:**

> Editorial overhead wholesale spread arranged as four connected rectangular zones: open sack of fine white rice with a squared metal scoop, neat tray of red lentils, completely unbranded clear bottle of golden cooking oil, and a wooden crate of fresh green vegetables; strong crop variation between zones, warm sand table, small terracotta inventory cord connecting two zones, ample edge-safe space for responsive cropping. Contemporary wholesale marketplace photography for a South Asian B2B commerce homepage, documentary but carefully composed, warm natural side light, tactile real food and packaging, cream and sand surfaces, sharp rectangular composition, practical independent-shop mood, no gradient, no 3D render, no person, no text, no logo, no watermark, no branded packaging.

**Alt:** `Rice, lentils, cooking oil, and vegetables arranged for wholesale.`

## Asset 2 — category image set

**Filenames:** `category-rice.webp`, `category-pulses.webp`, `category-oils.webp`, `category-spices.webp`, `category-snacks.webp`, `category-household.webp`  
**Ratio:** 4:3 each  
**Minimum:** 1200 × 900 each

Use this prompt template, replacing `[CATEGORY]`:

> Close, abundant wholesale arrangement of [CATEGORY] filling most of a hard rectangular frame, shown in plain crates, trays, sacks, or unbranded packaging appropriate to the product, one simple market measuring tool, warm cream and sand ground, consistent camera height and left-side daylight across the full image set. Contemporary South Asian B2B marketplace photography, tactile and realistic, restrained terracotta detail, no gradient, no 3D render, no people, no text, no logo, no watermark, no branded packaging.

## Asset 3 — Miniket rice product

**Filename:** `product-miniket-rice.webp`  
**Ratio:** 4:5  
**Minimum:** 1200 × 1500

**Prompt:**

> Fine white Miniket rice in an open plain jute sack beside a squared galvanized scoop, product centered low with breathing space above, each grain visible, warm cream seamless ground, small terracotta tie on the sack, direct marketplace product photography with natural contact shadow. No text, no logo, no watermark, no branded packaging.

**Alt:** `Miniket rice in an open sack beside a metal scoop.`

## Asset 4 — Atlas dates product

**Filename:** `product-atlas-dates.webp`  
**Ratio:** 4:5  
**Minimum:** 1200 × 1500

**Prompt:**

> Glossy brown dates densely arranged in a shallow unbranded rectangular wooden tray, a few dates opened to show texture, warm sand seamless ground, restrained olive-brown shadow, one terracotta twine detail, direct wholesale marketplace product photograph. No text, no logo, no watermark, no branded packaging.

**Alt:** `Brown dates arranged in a shallow wooden tray.`

## Asset 5 — mint tea product

**Filename:** `product-mint-tea.webp`  
**Ratio:** 4:5  
**Minimum:** 1200 × 1500

**Prompt:**

> Loose dried mint tea leaves in an open plain kraft box with a small squared metal scoop and a few fresh mint stems, warm cream seamless ground, controlled natural green, terracotta paper seal with no writing, direct wholesale marketplace product photograph. No text, no logo, no watermark, no branded packaging.

**Alt:** `Loose mint tea with a metal scoop and fresh mint.`

## Asset 6 — pantry collection banner

**Filename:** `collection-pantry-restock.webp`  
**Ratio:** 16:10  
**Minimum:** 1920 × 1200

**Prompt:**

> Working independent-shop pantry restock scene viewed from slightly above: plain sacks of rice and lentils, unbranded oil bottles, spice jars without labels, and stacked kraft boxes arranged on a long cream counter, composition weighted to the right with clean negative space on the left for web copy, realistic quantities and slight working-market imperfection, warm daylight. No person, no text, no logo, no watermark, no branded packaging.

**Alt:** `Pantry staples arranged on a shop counter for restocking.`

## Asset 7 — tea and snacks collection banner

**Filename:** `collection-tea-snacks.webp`  
**Ratio:** 16:10  
**Minimum:** 1920 × 1200

**Prompt:**

> Wholesale tea and snack shelf preparation: plain kraft tea boxes, loose tea in a metal scoop, unbranded biscuit and snack packets in muted paper packaging, shallow wooden display trays, warm sand background, composition weighted left with negative space on the right for web copy, restrained terracotta crate edge, practical independent retailer mood. No text, no logo, no watermark, no branded packaging.

**Alt:** `Tea and snack products prepared for an independent shop shelf.`

## Asset 8 — supplier spotlight

**Filename:** `supplier-spotlight.webp`  
**Ratio:** 4:3  
**Minimum:** 1800 × 1350

**Prompt:**

> Documentary portrait of a South Asian wholesale supplier in a clean working stockroom, standing naturally beside plain stacked food crates and sealed kraft cartons, confident but not posed like corporate stock photography, warm side light, cream wall and subtle terracotta packing tape, realistic working environment, no visible brand labels, no readable paperwork, generous side space for crop. No text, no logo, no watermark.

**Alt:** Replace with an approved description naming the real supplier when the story is finalized.

Do not publish this asset as a real supplier story unless the depicted person and story are approved. A real commissioned photograph is strongly preferred for this module.

## Asset 9 — supplier acquisition banner

**Filename:** `landing-supplier-packing.webp`  
**Ratio:** 3:2  
**Minimum:** 1800 × 1200

**Prompt:**

> Close documentary crop of hands packing a plain wholesale order: kraft carton, simple food packages without labels, black packing marker, terracotta tape, squared metal scale at the edge, deep near-black surrounding surface suitable for an ink-colored website section, practical motion and natural light, no readable writing, no face. No text, no logo, no watermark, no branded packaging.

**Alt:** `A supplier packing products into a wholesale order carton.`

## Asset 10 — social sharing image

**Filename:** `soukcart-og.webp`  
**Size:** 1200 × 630

Compose this in a design tool rather than asking AI to render text:

- `#FAF9F5` background
- Existing SoukCart logo
- Headline in Geist Sans: `Wholesale stock for your shelves.`
- Cropped hero market image on the right
- One `#C96442` action block
- Thin `#DAD9D4` rule
- Keep essential content inside 1080 × 566

---

## 9. Data and merchandising

## Public catalog

Only show product, price, stock, and supplier fields publicly when product policy and RLS allow it. Do not weaken table policies to populate the homepage.

Approved homepage product fields:

- Product ID
- Name
- Description excerpt
- Current price
- Unit
- Current stock state or approved stock band
- Category
- Image URL
- Supplier display name
- Active state
- Created/published timestamp when reliable

## Shelf sources

| Shelf                  | Recommended source                           |
| ---------------------- | -------------------------------------------- |
| Best sellers this week | Delivered quantity aggregated over 30 days   |
| Restock essentials     | Manually curated product/category IDs        |
| New to the market      | Active products by reliable publication date |
| Category counts        | Active visible products grouped by category  |

## Fallbacks

- No best-seller data → `Featured products`
- No publication timestamp → curated `Fresh picks`
- Missing image → soft-sand placeholder with existing package icon
- Out of stock → visible label and disabled action
- Loading → fixed-ratio skeletons matching final cards
- Data error → omit the affected shelf or show a quiet inline state; keep account CTAs usable

---

## 10. Routing and authentication

The current `/` route also owns authentication redirects and payment return handling.

### Required order

1. Payment return keys (`status`, `tran_id`, `val_id`, `soukcart:payment-return`) take precedence.
2. Signed-out `/` renders this homepage.
3. Signed-in `/` continues to the user’s role workspace unless product approves a behavior change.
4. Authentication moves to `/auth`.
5. `Join as retailer` preselects `retailer`.
6. `Sell on SoukCart` preselects database role `seller` while visible copy says Supplier.
7. Admin authentication remains at `/admin`; never advertise admin registration.

### Search and product links

If the public catalog remains protected:

- Preserve search query, category, or product destination through authentication.
- Explain that an account is required before redirecting.
- Never render apparently interactive product actions that discard user intent.

---

## 11. Accessibility and performance

### Accessibility

- Use one `h1` and logical `h2` headings for every shelf/module.
- Search has a visible label or accessible name.
- Product cards are semantic `article` elements.
- Every product image has useful alt text.
- Category and shelf controls are keyboard operable.
- Arrow controls have explicit accessible names.
- Stock and selection are not conveyed by color alone.
- Controls maintain at least 44 × 44px targets.
- Focus uses the terracotta ring token.
- Native horizontal scrolling must not trap focus.
- Reduced-motion behavior remains intact.

### Performance

- Continue self-hosting Geist Sans and Geist Mono.
- Prioritize only the hero image.
- Lazy-load category and shelf imagery below the fold.
- Use AVIF/WebP with responsive `srcset` and `sizes`.
- Reserve image dimensions to prevent layout shift.
- Avoid a heavy carousel dependency; native overflow plus small controls is sufficient.
- Do not preload every product image or font weight.

### Metadata

**Title:** `SoukCart — Wholesale products for independent retailers`  
**Description:** `Browse wholesale products, order against available stock, and connect with suppliers on SoukCart.`

---

## 12. Suggested component map

```text
LandingPage
├── UtilityBar
├── MarketplaceHeader
│   ├── Brand
│   ├── MarketplaceSearch
│   ├── AccountActions
│   └── CategoryNav
├── MerchandisingHero
├── CategoryShelf
├── ProductShelf — best sellers
│   └── LandingProductCard
├── RetailerBenefits
├── CuratedCollections
├── ProductShelf — restock essentials
├── SupplierSpotlight
├── ProductShelf — new arrivals
├── RetailerCta
├── SupplierCta
└── MarketplaceFooter
```

### Reuse

- Existing `Brand`
- Existing button treatments and focus behavior
- Product pricing/unit formatting
- Quantity and stock behavior
- Inline notices
- Loading and empty-state conventions
- Theme tokens in `src/theme.css`

Do not add a generic landing-page block library or a new icon package for this page.

---

## 13. Decisions before implementation

1. Can signed-out visitors view real product names, prices, stock, and supplier names?
2. Can signed-out users search, or should query intent be preserved through registration?
3. Is `/auth` approved as the new signed-out authentication route?
4. Which real products populate the first three shelves?
5. Is `Best sellers` based on delivered quantity over 30 days?
6. Is there a reliable product creation/publication timestamp for `New to the market`?
7. Is there an approved real supplier story and photograph?
8. Which seasonal or curated campaigns should launch first?
9. Are privacy, terms, and support destinations available?

---

## 14. Acceptance checklist

### Faire-inspired marketplace structure

- [ ] Search and category navigation are prominent before the hero.
- [ ] The hero is a merchandising campaign rather than an abstract brand statement.
- [ ] Category tiles and multiple product-discovery shelves dominate the homepage.
- [ ] Retailer and supplier paths are both clear.
- [ ] Supplier storytelling uses real approved information.
- [ ] The page does not copy Faire’s brand, wording, assets, or exact modules.

### SoukCart identity

- [ ] Main background is `#FAF9F5`, not white.
- [ ] Section surfaces use `#F5F4EF`, `#EDE9DE`, and `#E9E6DC` exactly as mapped.
- [ ] Hairlines use `#DAD9D4`.
- [ ] Primary text uses `#141413`.
- [ ] Terracotta `#C96442` is reserved for actions and active states.
- [ ] Geist Sans and Geist Mono are used consistently.
- [ ] Corners remain sharp and shadows restrained.

### Commerce truth

- [ ] Best-seller labels are backed by delivered-order data or removed.
- [ ] Prices, units, stock, and supplier attribution are current.
- [ ] No unsupported reviews, favorites, MOQs, metrics, or claims appear.
- [ ] Public product access does not weaken RLS.
- [ ] Search and product intent survive authentication when required.

### Responsive and accessible

- [ ] Header and search work at 62rem, 45rem, and 35rem.
- [ ] Every shelf has a keyboard-accessible non-carousel route.
- [ ] Product cards retain name, supplier, price, unit, and stock on mobile.
- [ ] All controls meet 44px target size and visible focus requirements.
- [ ] The page remains usable with reduced motion and failed shelf data.

---

## 15. Source-of-truth files

- `src/theme.css` — exact palette, Geist font stacks, radii, and shadows
- `src/main.tsx` — self-hosted Geist imports
- `src/style.css` — existing controls, product cards, and breakpoints
- `src/components/ui/Brand.tsx` — logo and live wordmark
- `src/features/retailer/RetailerCatalog.tsx` — catalog and ordering behavior
- `src/features/retailer/retailer-catalog-api.ts` — product/supplier shape
- `src/features/supplier/supplier-products-api.ts` — category taxonomy
- `src/features/workspace/format.ts` — taka price formatting
- `task.md` — routing, auth, payment, and backend contracts

---

## Reference note

The Faire references in this plan are used only to identify high-level marketplace information architecture and discovery patterns. All wording, visual styling, data behavior, and asset direction above are original to SoukCart and adapted to its current product capabilities.

Content derived from public references was paraphrased for compliance with licensing restrictions.
