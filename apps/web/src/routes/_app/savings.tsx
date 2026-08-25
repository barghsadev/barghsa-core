import { createFileRoute } from '@tanstack/react-router'

function SavingsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Savings Plans</h1>
      <p className="text-gray-600">Manage your electricity savings.</p>
    </div>
  )
}

export const Route = createFileRoute('/_app/savings')({
  component: SavingsPage,
})