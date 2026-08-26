import { createFileRoute } from '@tanstack/react-router'
import { DashboardPage } from '../../pages/DashboardPage.js'

export const Route = createFileRoute('/_app/dashboard')({
  component: DashboardPage,
})