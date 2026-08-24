import { Outlet, createFileRoute } from '@tanstack/react-router'

/**
 * Register layout route — renders child routes (register form, OTP verify) inside AuthLayout.
 */
export const Route = createFileRoute('/register')({
  component: RegisterLayout,
})

function RegisterLayout() {
  return <Outlet />
}