import { createFileRoute } from '@tanstack/react-router'

function WalletPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Wallet</h1>
      <p className="text-gray-600">Top up your account balance.</p>
    </div>
  )
}

export const Route = createFileRoute('/wallet')({
  component: WalletPage,
})