import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Brand } from '@/components/Brand'
import { Button } from '@/components/ui'
import { ShieldCheck, Tag, Truck, Grid2x2, ClipboardList, Menu, X, UserPlus, PackagePlus, Inbox, ClipboardCheck, TrendingUp, Search, Scale, ShoppingCart, Warehouse } from 'lucide-react'

const supplierSteps = [
  { title: 'Create Your Account', Icon: UserPlus },
  { title: 'List Your Products', Icon: PackagePlus },
  { title: 'Receive Orders', Icon: Inbox },
  { title: 'Confirm Orders', Icon: ClipboardCheck },
  { title: 'Grow Your Business', Icon: TrendingUp },
]
const retailerSteps = [
  { title: 'Find Products', Icon: Search },
  { title: 'Compare & Choose', Icon: Scale },
  { title: 'Place Your Order', Icon: ShoppingCart },
  { title: 'Track & Receive', Icon: Truck },
  { title: 'Stock & Grow', Icon: Warehouse },
]
export function Landing() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')

  function subscribe(e: FormEvent) {
    e.preventDefault()
    const value = email.trim()
    if (!value) {
      setNote('Enter your email to subscribe.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setNote('Enter a valid email address.')
      return
    }
    setNote('Thanks — you are subscribed.')
    setEmail('')
  }

  return (
    <div className="min-h-screen bg-white text-foreground">
      <header className="border-b border-border/60 relative z-10 bg-white">
        <div className="mx-auto max-w-[1120px] px-4 h-[68px] flex items-center justify-between gap-4">
          <Brand />
          <nav className="hidden md:flex items-center gap-8 text-[14px] text-[#4b5563]">
            <a href="#how" className="hover:text-foreground">How It Works</a>
            <a href="#how-suppliers" className="hover:text-foreground">For Suppliers</a>
            <a href="#how-retailers" className="hover:text-foreground">For Retailers</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/login"><Button className="h-9 px-4">Log in</Button></Link>
            <button type="button" className="md:hidden p-2 text-muted" aria-label="Open menu" onClick={() => setMenuOpen((v) => !v)}>
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav className="md:hidden border-t border-border px-4 py-3 flex flex-col gap-2 text-sm">
            <a href="#how" onClick={() => setMenuOpen(false)}>How It Works</a>
            <a href="#how-suppliers" onClick={() => setMenuOpen(false)}>For Suppliers</a>
            <a href="#how-retailers" onClick={() => setMenuOpen(false)}>For Retailers</a>
          </nav>
        )}
      </header>

      <section
        className="relative w-full flex items-center bg-white overflow-hidden"
        style={{ minHeight: 'calc(100dvh - 68px)' }}
      >
        <div
          className="hidden md:block absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(90deg, #fff 0%, #fff 42%, transparent 62%), url(/brand/hero-bg.jpg)',
            backgroundSize: 'cover',
            backgroundPosition: 'right center',
            backgroundRepeat: 'no-repeat',
          }}
        />
        <div className="relative w-full mx-auto max-w-[1120px] px-4 py-14 md:py-20">
          <div className="max-w-[22rem] sm:max-w-[28rem] md:max-w-[36rem]">
            <h1 className="text-[2.125rem] sm:text-[2.5rem] md:text-[3.25rem] font-bold leading-[1.14] tracking-[-0.03em] [text-wrap:unset]">
              <span className="block">Wholesale groceries.</span>
              <span className="block">Stronger businesses.</span>
              <span className="block text-primary">Better communities.</span>
            </h1>
            <p className="mt-6 text-base md:text-lg text-muted max-w-[30rem] leading-[1.65]">
              SoukCart is the B2B marketplace that connects grocery suppliers and retailers to buy and sell smarter, together.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/register?role=retailer"><Button className="h-12 px-6">Join as Retailer →</Button></Link>
              <Link to="/register?role=supplier"><Button variant="secondary" className="h-12 px-6 bg-white border-[#c9c9c9] text-[#242526]">Join as Supplier →</Button></Link>
            </div>
          </div>
        </div>
      </section>

      <section id="benefits" className="bg-soft">
        <div className="mx-auto max-w-[1120px] px-4 py-12 grid md:grid-cols-3 gap-8 items-center">
          {[
            { Icon: ShieldCheck, t: 'Verified Partners', d: 'Trusted & reliable network' },
            { Icon: Tag, t: 'Competitive Prices', d: 'Better deals, higher margins' },
            { Icon: Truck, t: 'Reliable Delivery', d: 'On-time, every time' },
          ].map(({ Icon, t, d }) => (
            <div key={t} className="flex flex-col items-center text-center gap-3">
              <span className="h-14 w-14 rounded-2xl border border-[#f2ccc1] bg-white flex items-center justify-center text-primary">
                <Icon size={26} />
              </span>
              <div>
                <div className="font-semibold text-lg text-foreground">{t}</div>
                <div className="text-[15px] text-muted mt-0.5">{d}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="how" className="bg-soft">
        <div className="mx-auto max-w-[1120px] px-4 py-16">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <p className="text-[12px] font-semibold tracking-[0.1em] uppercase text-primary">How it works</p>
            <h2 className="text-3xl font-bold mt-2 text-balance">Built for how grocery businesses trade.</h2>
            <p className="text-muted mt-3 text-base text-pretty">
              Whether you supply or sell, SoukCart makes the process simple, transparent, and profitable.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-8">
            <div id="how-suppliers">
              <div className="flex items-center gap-3 mb-5">
                <span className="h-12 w-12 rounded-2xl border border-[#f2ccc1] bg-white flex items-center justify-center text-primary">
                  <Grid2x2 size={22} />
                </span>
                <div className="text-xl font-semibold">For Suppliers</div>
              </div>
              <div className="space-y-3">
                {supplierSteps.map(({ title, Icon }, i) => (
                  <div key={title} className="rounded-xl border border-border bg-white p-4 flex items-center gap-4">
                    <span className="h-12 w-12 rounded-2xl border border-[#f2ccc1] bg-white flex items-center justify-center text-primary shrink-0">
                      <Icon size={22} />
                    </span>
                    <div className="flex-1 font-semibold text-lg">{title}</div>
                    <span className="text-sm font-semibold text-muted tabular-nums">{i + 1}</span>
                  </div>
                ))}
              </div>
            </div>
            <div id="how-retailers">
              <div className="flex items-center gap-3 mb-5">
                <span className="h-12 w-12 rounded-2xl border border-[#f2ccc1] bg-white flex items-center justify-center text-primary">
                  <ClipboardList size={22} />
                </span>
                <div className="text-xl font-semibold">For Retailers</div>
              </div>
              <div className="space-y-3">
                {retailerSteps.map(({ title, Icon }, i) => (
                  <div key={title} className="rounded-xl border border-border bg-white p-4 flex items-center gap-4">
                    <span className="h-12 w-12 rounded-2xl border border-[#f2ccc1] bg-white flex items-center justify-center text-primary shrink-0">
                      <Icon size={22} />
                    </span>
                    <div className="flex-1 font-semibold text-lg">{title}</div>
                    <span className="text-sm font-semibold text-muted tabular-nums">{i + 1}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" aria-label="SoukCart brand">
        <div className="mx-auto max-w-[1120px] px-4 py-10">
          <div className="relative overflow-hidden rounded-xl bg-[#FBF1E7]">
            <div className="px-6 py-10 lg:absolute lg:inset-0 lg:flex lg:items-center lg:py-0">
              <div className="max-w-[400px]">
                <p className="text-[12px] font-semibold tracking-[0.1em] uppercase text-primary">Ready to grow together?</p>
                <h2 className="text-3xl font-bold mt-2 text-balance">One platform. Endless opportunities.</h2>
                <p className="text-muted mt-3 text-pretty">Join thousands of grocery businesses already growing with SoukCart.</p>
                <Link to="/register" className="inline-block mt-6"><Button className="h-11 px-5">Get Started Today →</Button></Link>
              </div>
            </div>
            <img src="/brand/banner-bottom.jpg" alt="" className="block w-full h-auto" />
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-[1120px] px-4 py-12 grid md:grid-cols-5 gap-8 text-sm">
          <div className="md:col-span-1">
            <Brand markHeight={24} />
            <p className="text-muted mt-3 text-[13px]">B2B marketplace connecting grocery suppliers and retailers.</p>
          </div>
          <div>
            <div className="font-semibold mb-3">Platform</div>
            <ul className="space-y-2 text-muted">
              <li><a href="#how">How It Works</a></li>
              <li><a href="#benefits">Benefits</a></li>
            </ul>
          </div>
          <div>
            <div className="font-semibold mb-3">Company</div>
            <ul className="space-y-2 text-muted">
              <li><a href="mailto:help@soukcart.com">Contact Us</a></li>
            </ul>
          </div>
          <div>
            <div className="font-semibold mb-3">Legal</div>
            <ul className="space-y-2 text-muted">
              <li><Link to="/legal#terms">Terms of Use</Link></li>
              <li><Link to="/legal#privacy">Privacy Policy</Link></li>
              <li><Link to="/legal#refund">Refund Policy</Link></li>
            </ul>
          </div>
          <div>
            <div className="font-semibold mb-2">Subscribe to our newsletter</div>
            <p className="text-muted text-[13px] mb-3">Get updates on new features, offers and more.</p>
            <form onSubmit={subscribe} className="flex gap-2">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                className="flex-1 h-10 rounded-lg border border-border bg-[#f7f8f8] px-3 text-base sm:text-sm"
              />
              <Button type="submit" className="h-10 px-4 whitespace-nowrap" aria-label="Subscribe">Subscribe</Button>
            </form>
            {note ? <p className="text-xs text-muted mt-2">{note}</p> : null}
          </div>
        </div>
        <div className="border-t border-border">
          <div className="mx-auto max-w-[1120px] px-4 h-14 flex items-center justify-between text-[13px] text-muted">
            <span>{'\u00a9 2026 SoukCart. All rights reserved.'}</span>
            <select className="h-8 rounded-md border border-border bg-white px-2 text-[13px]" defaultValue="en" aria-label="Language">
              <option value="en">English</option>
            </select>
          </div>
        </div>
      </footer>
    </div>
  )
}

export function Legal() {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-border">
        <div className="mx-auto max-w-3xl px-4 h-16 flex items-center">
          <Brand />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-12 space-y-10 text-sm leading-relaxed">
        <h1 className="text-3xl font-bold">Legal</h1>
        <section id="terms">
          <h2 className="text-xl font-semibold mb-2">Terms of Use</h2>
          <p className="text-muted">SoukCart is a B2B grocery marketplace. By creating an account you agree to use the platform for legitimate wholesale trade, keep your details accurate, and honour orders you place or accept.</p>
        </section>
        <section id="privacy">
          <h2 className="text-xl font-semibold mb-2">Privacy Policy</h2>
          <p className="text-muted">We store the name, email, shop details, and order history needed to run the marketplace. We do not sell personal data. Contact <a className="text-primary font-medium" href="mailto:help@soukcart.com">help@soukcart.com</a> to request deletion.</p>
        </section>
        <section id="refund">
          <h2 className="text-xl font-semibold mb-2">Refund Policy</h2>
          <p className="text-muted">Cancelled prepaid orders are refunded manually by SoukCart admin. Delivery fees already paid may be refunded when an order is cancelled before shipment.</p>
        </section>
        <Link to="/" className="text-primary font-medium">← Back to home</Link>
      </main>
    </div>
  )
}

export function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 text-center">
      <p className="text-sm text-muted">404</p>
      <h1 className="text-3xl font-bold mt-1">Page not found</h1>
      <p className="text-muted mt-2 max-w-md">That URL does not exist. Head back to the homepage or sign in to your workspace.</p>
      <div className="mt-6 flex gap-3">
        <Link to="/"><Button>Back to home</Button></Link>
        <Link to="/login"><Button variant="secondary">Log in</Button></Link>
      </div>
    </div>
  )
}
