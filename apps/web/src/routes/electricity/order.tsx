import { createFileRoute } from '@tanstack/react-router'

function ElectricityOrderPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Place Order</h1>
      <p className="text-gray-600">Complete your electricity purchase.</p>
    </div>
  )
}

export const Route = createFileRoute('/electricity/order')({
  component: ElectricityOrderPage,
})