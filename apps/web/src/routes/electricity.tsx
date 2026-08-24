import { createFileRoute, Outlet } from '@tanstack/react-router'

/**
 * Electricity layout — renders child routes (order page) via Outlet.
 */
function ElectricityLayout() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-4xl mx-auto p-8">
        <Outlet />
      </div>
    </div>
  )
}

export const Route = createFileRoute('/electricity')({
  component: ElectricityLayout,
})