import { createFileRoute } from '@tanstack/react-router'

function ElectricityPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Electricity Products</h1>
      <p className="text-gray-600">Browse and select electricity plans.</p>
    </div>
  )
}

export const Route = createFileRoute('/electricity')({
  component: ElectricityPage,
})