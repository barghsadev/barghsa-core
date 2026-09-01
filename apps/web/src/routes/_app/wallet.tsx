import { createFileRoute } from '@tanstack/react-router'
import { WalletPage } from '../../pages/WalletPage.js'

export const Route = createFileRoute('/_app/wallet')({
  component: WalletPage,
})
