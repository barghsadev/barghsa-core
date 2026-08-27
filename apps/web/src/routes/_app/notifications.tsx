import { createFileRoute } from '@tanstack/react-router'
import { NotificationCenterPage } from '../../pages/NotificationCenterPage.js'

export const Route = createFileRoute('/_app/notifications')({
  component: NotificationCenterPage,
})