import { Outlet } from '@tanstack/react-router'
import { TosBanner } from '../components/TosBanner.js'

/**
 * Admin layout with sidebar — renders lazy child routes via Outlet.
 */
export default function AdminLayout() {
  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <TosBanner />
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-64 bg-white border-inset-end border-gray-200 p-4 shrink-0">
          <nav>
            <h2 className="text-lg font-semibold mb-4">Admin</h2>
            <ul className="space-y-2">
              <li><a href="/admin" className="text-blue-600 hover:underline">Dashboard</a></li>
              <li><a href="/admin/users" className="text-blue-600 hover:underline">Users</a></li>
              <li><a href="/admin/storage" className="text-blue-600 hover:underline">Storage</a></li>
              <li><a href="/admin/verification" className="text-blue-600 hover:underline">Verification</a></li>
              <li><a href="/admin/branding" className="text-blue-600 hover:underline">Branding</a></li>
              <li><a href="/admin/geography" className="text-blue-600 hover:underline">Geography</a></li>
              <li><a href="/admin/tos" className="text-blue-600 hover:underline">Terms of Service</a></li>
              <li><a href="/admin/notifications" className="text-blue-600 hover:underline">Notifications</a></li>
              <li className="pt-2 mt-2 border-t border-gray-100">
                <span className="text-xs text-gray-400 uppercase tracking-wide">CRM</span>
              </li>
              <li><a href="/admin/crm" className="text-blue-600 hover:underline">CRM Profiles</a></li>
            </ul>
          </nav>
        </aside>
        {/* Main content */}
        <main className="flex-1 p-8 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}