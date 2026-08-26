/**
 * Admin dashboard page — heavy module, lazy-loaded.
 */
import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ShieldCheck } from 'lucide-react'

interface PendingVerificationProfile {
  id: string
  profileType: 'INDIVIDUAL' | 'LEGAL'
  firstName: string | null
  lastName: string | null
  legalName: string | null
  createdAt: string
}

interface PendingVerificationData {
  count: number
  profiles: PendingVerificationProfile[]
}

export default function AdminDashboard() {
  const [data, setData] = useState<PendingVerificationData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isError, setIsError] = useState(false)

  useEffect(() => {
    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null

    const fetchData = async () => {
      try {
        const res = await fetch('/api/crm/dashboard/pending-verification')
        if (!res.ok) throw new Error('Failed to fetch')
        const json = await res.json() as PendingVerificationData
        if (!cancelled) {
          setData(json)
          setIsLoading(false)
          setIsError(false)
        }
      } catch {
        if (!cancelled) {
          setIsLoading(false)
          setIsError(true)
        }
      }
    }

    fetchData()
    intervalId = setInterval(fetchData, 30_000)

    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
    }
  }, [])

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Admin Dashboard</h1>
      <p className="text-gray-600 mb-6">Platform administration and monitoring.</p>

      {/* Pending verification widget */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 max-w-sm">
        <div className="flex items-center gap-3 mb-3">
          {/* Icon */}
          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            {isLoading ? (
              <div className="h-6 w-12 bg-gray-200 animate-pulse rounded" />
            ) : isError ? (
              <p className="text-sm text-red-500">Failed to load</p>
            ) : (
              <>
                <p className="text-2xl font-bold text-gray-900">{data?.count ?? 0}</p>
                <p className="text-sm text-gray-500">Profiles awaiting verification</p>
              </>
            )}
          </div>
        </div>
        <Link
          to="/admin/crm"
          search={{ verification: 'PENDING' }}
          className="text-sm text-blue-600 hover:text-blue-800 hover:underline font-medium"
        >
          Show all →
        </Link>
      </div>
    </div>
  )
}