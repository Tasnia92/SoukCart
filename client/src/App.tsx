import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '@/context/auth'
import {
  LayoutDashboard,
  Package,
  Boxes,
  Warehouse,
  Receipt,
  Users,
  Bell,
  Settings,
  Home,
  RotateCcw,
  Wallet,
  MessageSquareWarning,
  Tags,
  ShieldCheck,
  Truck,
} from 'lucide-react'
import { AuthProvider } from '@/context/AuthContext'
import { CartProvider } from '@/context/CartContext'
import { NotificationProvider } from '@/context/NotificationContext'
import { Protected, PublicOnly, VerifiedSupplier } from '@/components/Protected'
import { homeForRole } from '@/lib/homeForRole'
import { RetailerLayout } from '@/layouts/RetailerLayout'
import { SidebarLayout } from '@/layouts/SidebarLayout'
import { Landing, Legal, NotFound } from '@/pages/Landing'
import { Login, AdminLogin } from '@/pages/Login'
import { Register } from '@/pages/Register'
// Role workspaces are code-split so each role only downloads its own pages.
// Several lazy() calls on one module share a single chunk and a single request.
const loadRetailerProducts = () => import('@/pages/retailer/Products')
const RetailerProducts = lazy(() => loadRetailerProducts().then((m) => ({ default: m.RetailerProducts })))

const loadRetailerProductDetail = () => import('@/pages/retailer/ProductDetail')
const RetailerProductDetail = lazy(() => loadRetailerProductDetail().then((m) => ({ default: m.RetailerProductDetail })))

const loadRetailerCart = () => import('@/pages/retailer/Cart')
const RetailerCart = lazy(() => loadRetailerCart().then((m) => ({ default: m.RetailerCart })))

const loadRetailerOrders = () => import('@/pages/retailer/Orders')
const RetailerOrders = lazy(() => loadRetailerOrders().then((m) => ({ default: m.RetailerOrders })))

const loadRetailerSimplePages = () => import('@/pages/retailer/SimplePages')
const RetailerHelp = lazy(() => loadRetailerSimplePages().then((m) => ({ default: m.RetailerHelp })))
const RetailerNotifications = lazy(() => loadRetailerSimplePages().then((m) => ({ default: m.RetailerNotifications })))
const RetailerSettings = lazy(() => loadRetailerSimplePages().then((m) => ({ default: m.RetailerSettings })))
const RetailerTracking = lazy(() => loadRetailerSimplePages().then((m) => ({ default: m.RetailerTracking })))

const loadSupplierPages = () => import('@/pages/supplier/Pages')
const SupplierDashboard = lazy(() => loadSupplierPages().then((m) => ({ default: m.SupplierDashboard })))
const SupplierEarnings = lazy(() => loadSupplierPages().then((m) => ({ default: m.SupplierEarnings })))
const SupplierInventory = lazy(() => loadSupplierPages().then((m) => ({ default: m.SupplierInventory })))
const SupplierNotifications = lazy(() => loadSupplierPages().then((m) => ({ default: m.SupplierNotifications })))
const SupplierOrders = lazy(() => loadSupplierPages().then((m) => ({ default: m.SupplierOrders })))
const SupplierProductNew = lazy(() => loadSupplierPages().then((m) => ({ default: m.SupplierProductNew })))
const SupplierProductEdit = lazy(() => loadSupplierPages().then((m) => ({ default: m.SupplierProductEdit })))
const SupplierProducts = lazy(() => loadSupplierPages().then((m) => ({ default: m.SupplierProducts })))
const SupplierRetailers = lazy(() => loadSupplierPages().then((m) => ({ default: m.SupplierRetailers })))
const SupplierSettings = lazy(() => loadSupplierPages().then((m) => ({ default: m.SupplierSettings })))
const SupplierVerification = lazy(() => loadSupplierPages().then((m) => ({ default: m.SupplierVerification })))

const loadAdminPages = () => import('@/pages/admin/Pages')
const AdminCategories = lazy(() => loadAdminPages().then((m) => ({ default: m.AdminCategories })))
const AdminDisputes = lazy(() => loadAdminPages().then((m) => ({ default: m.AdminDisputes })))
const AdminHome = lazy(() => loadAdminPages().then((m) => ({ default: m.AdminHome })))
const AdminNotifications = lazy(() => loadAdminPages().then((m) => ({ default: m.AdminNotifications })))
const AdminOrders = lazy(() => loadAdminPages().then((m) => ({ default: m.AdminOrders })))
const AdminPayouts = lazy(() => loadAdminPages().then((m) => ({ default: m.AdminPayouts })))
const AdminProducts = lazy(() => loadAdminPages().then((m) => ({ default: m.AdminProducts })))
const AdminDeliveryFees = lazy(() => loadAdminPages().then((m) => ({ default: m.AdminDeliveryFees })))
const AdminRefunds = lazy(() => loadAdminPages().then((m) => ({ default: m.AdminRefunds })))
const AdminUsers = lazy(() => loadAdminPages().then((m) => ({ default: m.AdminUsers })))
const AdminVerificationDetail = lazy(() => loadAdminPages().then((m) => ({ default: m.AdminVerificationDetail })))
const AdminVerifications = lazy(() => loadAdminPages().then((m) => ({ default: m.AdminVerifications })))

const supplierNav = [
  { to: '/supplier', label: 'Dashboard', Icon: LayoutDashboard, end: true },
  { to: '/supplier/orders', label: 'Orders', Icon: Package },
  { to: '/supplier/products', label: 'Products', Icon: Boxes },
  { to: '/supplier/inventory', label: 'Inventory', Icon: Warehouse },
  { to: '/supplier/earnings', label: 'Earnings', Icon: Receipt },
  { to: '/supplier/retailers', label: 'Retailers', Icon: Users },
  { to: '/supplier/notifications', label: 'Notifications', Icon: Bell },
  { to: '/supplier/settings', label: 'Settings', Icon: Settings },
]

const adminNav = [
  { to: '/admin', label: 'Home', Icon: Home, end: true },
  { to: '/admin/orders', label: 'Orders', Icon: Package },
  { to: '/admin/delivery-fees', label: 'Delivery fees', Icon: Truck },
  { to: '/admin/refunds', label: 'Refund', Icon: RotateCcw },
  { to: '/admin/payouts', label: 'Payouts', Icon: Wallet },
  { to: '/admin/disputes', label: 'Disputes', Icon: MessageSquareWarning },
  { to: '/admin/products', label: 'Products', Icon: Boxes },
  { to: '/admin/categories', label: 'Categories', Icon: Tags },
  { to: '/admin/verifications', label: 'Verifications', Icon: ShieldCheck },
  { to: '/admin/users', label: 'Users', Icon: Users },
  { to: '/admin/notifications', label: 'Notifications', Icon: Bell },
]

function PageLoading() {
  return <div className="p-10 text-muted">Loading…</div>
}

/**
 * Gate for everything under /admin. Anonymous visitors see the admin
 * login screen on /admin; only admin accounts get past it. Non-admin
 * signed-in users are sent back to their own workspace.
 */
function AdminArea() {
  const { user, loading } = useAuth()
  if (loading) return <div className="p-10 text-muted">Loading…</div>
  if (!user) return <AdminLogin />
  if (user.role !== 'admin') return <Navigate to={homeForRole(user)} replace />
  return (
    <SidebarLayout
      items={adminNav}
      roleLabel="Admin"
      notificationsTo="/admin/notifications"
      wide
    />
  )
}

export default function App() {
  return (
    <AuthProvider>
      <NotificationProvider>
      <CartProvider>
        <BrowserRouter>
          <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
            <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
            <Route path="/legal" element={<Legal />} />

            <Route
              path="/retailer"
              element={
                <Protected roles={['retailer']}>
                  <RetailerLayout />
                </Protected>
              }
            >
              <Route index element={<Navigate to="products" replace />} />
              <Route path="products" element={<RetailerProducts />} />
              <Route path="products/:id" element={<RetailerProductDetail />} />
              <Route path="cart" element={<RetailerCart />} />
              <Route path="orders" element={<RetailerOrders />} />
              <Route path="tracking" element={<RetailerTracking />} />
              <Route path="help" element={<RetailerHelp />} />
              <Route path="notifications" element={<RetailerNotifications />} />
              <Route path="settings" element={<RetailerSettings />} />
            </Route>

            <Route
              path="/supplier/verification"
              element={
                <Protected roles={['supplier']}>
                  <SupplierVerification />
                </Protected>
              }
            />

            <Route
              path="/supplier"
              element={
                <Protected roles={['supplier']}>
                  <VerifiedSupplier>
                    <SidebarLayout items={supplierNav} roleLabel="Supplier" notificationsTo="/supplier/notifications" />
                  </VerifiedSupplier>
                </Protected>
              }
            >
              <Route index element={<SupplierDashboard />} />
              <Route path="orders" element={<SupplierOrders />} />
              <Route path="products" element={<SupplierProducts />} />
              <Route path="products/new" element={<SupplierProductNew />} />
              <Route path="products/:id/edit" element={<SupplierProductEdit />} />
              <Route path="inventory" element={<SupplierInventory />} />
              <Route path="earnings" element={<SupplierEarnings />} />
              <Route path="retailers" element={<SupplierRetailers />} />
              <Route path="notifications" element={<SupplierNotifications />} />
              <Route path="settings" element={<SupplierSettings />} />
            </Route>

            <Route
              path="/admin"
              element={<AdminArea />}
            >
              <Route index element={<AdminHome />} />
              <Route path="orders" element={<AdminOrders />} />
              <Route path="delivery-fees" element={<AdminDeliveryFees />} />
              <Route path="refunds" element={<AdminRefunds />} />
              <Route path="payouts" element={<AdminPayouts />} />
              <Route path="disputes" element={<AdminDisputes />} />
              <Route path="products" element={<AdminProducts />} />
              <Route path="categories" element={<AdminCategories />} />
              <Route path="verifications" element={<AdminVerifications />} />
              <Route path="verifications/:id" element={<AdminVerificationDetail />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="notifications" element={<AdminNotifications />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </BrowserRouter>
      </CartProvider>
      </NotificationProvider>
    </AuthProvider>
  )
}
