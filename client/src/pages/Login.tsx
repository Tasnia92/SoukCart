import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Mail, Lock, Eye, EyeOff } from 'lucide-react'
import { AuthShell, RoleTabs } from '@/components/AuthShell'
import { Button, Input, Label } from '@/components/ui'
import { useAuth, type AuthUser } from '@/context/AuthContext'

function homeFor(user: AuthUser) {
  if (user.role === 'admin') return '/admin'
  if (user.role === 'supplier') return user.verificationStatus === 'approved' ? '/supplier' : '/supplier/verification'
  return '/retailer/products'
}

export function Login() {
  const { login, logout } = useAuth()
  const navigate = useNavigate()
  const [role, setRole] = useState<'retailer' | 'supplier'>('retailer')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [keep, setKeep] = useState(false)
  const [error, setError] = useState('')
  const [forgot, setForgot] = useState(false)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const user = await login(email, password, keep)
      if (user.role !== role) {
        logout()
        setError(
          user.role === 'admin'
            ? 'Admin accounts sign in from the separate admin login at /admin.'
            : `This account is a ${user.role}. Switch the tab or use the matching account.`,
        )
        setLoading(false)
        return
      }
      navigate(homeFor(user))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const subtitle =
    role === 'retailer'
      ? 'Sign in to your retailer workspace and manage every order from one clear view.'
      : 'Sign in to your supplier workspace to manage catalog, stock, and orders.'

  return (
    <AuthShell>
      <RoleTabs role={role} onChange={setRole} />
      <div className="mt-6">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-primary">Welcome</p>
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-balance mt-1">
          Your business, in sync.
        </h1>
        <p className="text-sm text-muted mt-2">{subtitle}</p>
      </div>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <Label htmlFor="login-email">Email Address</Label>
          <div className="relative">
            <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <Input id="login-email" className="pl-10" placeholder="Enter your email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
        <div>
          <Label htmlFor="login-password">Password</Label>
          <div className="relative">
            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <Input id="login-password" className="pl-10 pr-10" placeholder="Enter your password" type={show ? 'text' : 'password'} required value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" onClick={() => setShow((s) => !s)} aria-label="Toggle password">
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between text-sm">
          <label className="inline-flex items-center gap-2 text-muted">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} className="rounded border-border" />
            Keep me signed in
          </label>
          <button
            type="button"
            className="text-primary font-medium"
            onClick={() => setForgot(true)}
          >
            Forgot password?
          </button>
        </div>
        {forgot ? (
          <p className="text-sm text-muted">
            To reset your password, send an email to{' '}
            <a className="text-primary font-medium" href="mailto:help@soukcart.com">help@soukcart.com</a>.
          </p>
        ) : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button className="w-full h-11" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</Button>
      </form>
      <p className="text-sm text-center mt-4 text-muted">
        New to SoukCart? <Link className="text-primary font-semibold" to="/register">Create an account</Link>
      </p>
      <div className="mt-5 pt-4 border-t border-border text-center text-xs text-muted">
        By continuing, you agree to SoukCart&apos;s <Link to="/legal" className="text-primary font-medium">Terms & Privacy</Link>.
      </div>
    </AuthShell>
  )
}

export function AdminLogin() {
  const { login, logout } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [keep, setKeep] = useState(false)
  const [error, setError] = useState('')
  const [forgot, setForgot] = useState(false)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const user = await login(email, password, keep)
      if (user.role !== 'admin') {
        logout()
        setError('This area is for admin accounts only. Suppliers and retailers sign in from the main login.')
        setLoading(false)
        return
      }
      navigate('/admin')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      headline="Moderate the marketplace."
      body="Review suppliers, orders, refunds, and payouts from one admin workspace."
    >
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-primary">Admin</p>
      <h1 className="text-[28px] font-bold leading-tight tracking-tight text-balance mt-1">Admin sign in</h1>
      <p className="text-sm text-muted mt-2">Only admin accounts can sign in here.</p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <Label htmlFor="admin-email">Admin email</Label>
          <div className="relative">
            <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <Input id="admin-email" className="pl-10" placeholder="Enter your email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
        <div>
          <Label htmlFor="admin-password">Password</Label>
          <div className="relative">
            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <Input id="admin-password" className="pl-10 pr-10" placeholder="Enter your password" type={show ? 'text' : 'password'} required value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" onClick={() => setShow((s) => !s)} aria-label="Toggle password">
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between text-sm">
          <label className="inline-flex items-center gap-2 text-muted">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} className="rounded border-border" />
            Keep me signed in
          </label>
          <button
            type="button"
            className="text-primary font-medium"
            onClick={() => setForgot(true)}
          >
            Forgot password?
          </button>
        </div>
        {forgot ? (
          <p className="text-sm text-muted">
            To reset your password, send an email to{' '}
            <a className="text-primary font-medium" href="mailto:help@soukcart.com">help@soukcart.com</a>.
          </p>
        ) : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button className="w-full h-11" disabled={loading}>{loading ? 'Signing in…' : 'Sign in to admin'}</Button>
      </form>
      <p className="text-sm text-center mt-4 text-muted">
        A supplier or retailer? <Link className="text-primary font-semibold" to="/login">Sign in here</Link>
      </p>
      <div className="mt-5 pt-4 border-t border-border text-center text-xs text-muted">
        By continuing, you agree to SoukCart&apos;s <Link to="/legal" className="text-primary font-medium">Terms & Privacy</Link>.
      </div>
    </AuthShell>
  )
}