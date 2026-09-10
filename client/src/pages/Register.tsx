import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Mail, Lock, User, Eye, EyeOff } from 'lucide-react'
import { AuthShell, RoleTabs } from '@/components/AuthShell'
import { Button, Input, Label } from '@/components/ui'
import { useAuth } from '@/context/AuthContext'

export function Register() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [role, setRole] = useState<'retailer' | 'supplier'>(params.get('role') === 'supplier' ? 'supplier' : 'retailer')
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' })
  const [show, setShow] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [terms, setTerms] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (form.password !== form.confirm) {
      setError('Passwords do not match')
      return
    }
    if (!terms) {
      setError('Please accept Terms & Privacy')
      return
    }
    setLoading(true)
    setError('')
    try {
      const user = await register({ name: form.name, email: form.email, password: form.password, role })
      navigate(user.role === 'supplier' ? '/supplier/verification' : '/retailer/products')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell>
      <RoleTabs role={role} onChange={setRole} />
      <div className="mt-6">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-primary">Get started</p>
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-balance mt-1">Create an account.</h1>
        <p className="text-sm text-muted mt-2">
          {role === 'retailer' ? 'Buy for your shop from verified suppliers.' : 'Sell on SoukCart and reach more retailers.'}
        </p>
      </div>
      <form onSubmit={onSubmit} className="mt-6 space-y-3">
        <div>
          <Label htmlFor="register-name">Full name</Label>
          <div className="relative">
            <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <Input id="register-name" className="pl-10" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Enter your full name" />
          </div>
        </div>
        <div>
          <Label htmlFor="register-email">Email Address</Label>
          <div className="relative">
            <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <Input id="register-email" className="pl-10" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Enter your email" />
          </div>
        </div>
        <div>
          <Label htmlFor="register-password">Password</Label>
          <div className="relative">
            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <Input id="register-password" className="pl-10 pr-10" type={show ? 'text' : 'password'} required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Create a password" />
            <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" onClick={() => setShow((s) => !s)} aria-label="Toggle password">
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        <div>
          <Label htmlFor="register-confirm">Confirm password</Label>
          <div className="relative">
            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <Input id="register-confirm" className="pl-10 pr-10" type={showConfirm ? 'text' : 'password'} required value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} placeholder="Confirm your password" />
            <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" onClick={() => setShowConfirm((s) => !s)} aria-label="Toggle confirm password">
              {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        <label className="inline-flex items-start gap-2 text-sm text-muted">
          <input type="checkbox" className="mt-1" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
          <span>I agree to SoukCart&apos;s <Link to="/legal" className="text-primary font-medium">Terms & Privacy</Link>.</span>
        </label>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button className="w-full h-11" disabled={loading}>{loading ? 'Creating…' : 'Create account'}</Button>
      </form>
      <p className="text-sm text-center mt-4 text-muted">
        Already have an account? <Link className="text-primary font-semibold" to="/login">Sign in</Link>
      </p>
    </AuthShell>
  )
}
