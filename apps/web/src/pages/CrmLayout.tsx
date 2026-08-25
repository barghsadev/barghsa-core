import { Outlet } from '@tanstack/react-router'

/**
 * CRM section layout — renders child CRM pages (profile detail, etc.)
 * within the admin layout shell.
 */
export default function CrmLayout() {
  return (
    <div>
      <Outlet />
    </div>
  )
}