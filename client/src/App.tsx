import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
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
} from 'lucide-react'
import { AuthProvider } from '@/context/AuthContext'
import { CartProvider } from '@/context/CartContext'
import { NotificationProvider } from '@/context/NotificationContext'
import { Protected, PublicOnly, VerifiedSupplier, homeForRole } from '@/components/Protected'
import { RetailerLayout } from '@/layouts/RetailerLayout'
import { SidebarLayout } from '@/layouts/SidebarLayout'
import { Landing, Legal, NotFound } from '@/pages/Landing'
import { Login, AdminLogin } from '@/pages/Login'
import { Register } from '@/pages/Register'
import { RetailerProducts } from '@/pages/retailer/Products'
import { RetailerProductDetail } from '@/pages/retailer/ProductDetail'
import { RetailerCart } from '@/pages/retailer/Cart'
import { RetailerOrders } from '@/pages/retailer/Orders'
import {
  RetailerHelp,
  RetailerNotifications,
  RetailerSettings,
  RetailerTracking,
} from '@/pages/retailer/SimplePages'
import {
  SupplierDashboard,
  SupplierEarnings,
  SupplierInventory,
  SupplierNotifications,
  SupplierOrders,
  SupplierProductNew,
  SupplierProductEdit,
  SupplierProducts,
  SupplierRetailers,
  SupplierSettings,
  SupplierVerification,
} from '@/pages/supplier/Pages'
import {
  AdminCategories,
  AdminDisputes,
  AdminHome,
  AdminNotifications,
  AdminOrders,
  AdminPayouts,
  AdminProducts,
  AdminRefunds,
  AdminUsers,
  AdminVerificationDetail,
  AdminVerifications,
} from '@/pages/admin/Pages'

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
  { to: '/admin/refunds', label: 'Refund', Icon: RotateCcw },
  { to: '/admin/payouts', label: 'Payouts', Icon: Wallet },
  { to: '/admin/disputes', label: 'Disputes', Icon: MessageSquareWarning },
  { to: '/admin/products', label: 'Products', Icon: Boxes },
  { to: '/admin/categories', label: 'Categories', Icon: Tags },
  { to: '/admin/verifications', label: 'Verifications', Icon: ShieldCheck },
  { to: '/admin/users', label: 'Users', Icon: Users },
  { to: '/admin/notifications', label: 'Notifications', Icon: Bell },
]

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
      bellCount={3}
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
        </BrowserRouter>
      </CartProvider>
      </NotificationProvider>
    </AuthProvider>
  )
}
