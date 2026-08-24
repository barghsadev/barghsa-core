import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: HomePage,
})

function HomePage() {
  return (
    <div>
      <h1>Barghsa</h1>
      <p>Iranian electricity market intelligence platform</p>
    </div>
  )
}