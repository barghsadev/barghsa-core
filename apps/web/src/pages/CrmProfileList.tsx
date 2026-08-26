/**
 * CRM profile list page — placeholder.
 *
 * This page renders the CRM profile listing. The full profile list view
 * is a separate task; this minimal implementation prevents the
 * "Show all" link from the Admin Dashboard from navigating to a
 * layout route with no child component.
 */
import { useSearch } from '@tanstack/react-router'

export default function CrmProfileList() {
  const search = useSearch({ from: '/admin/crm/' })

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">CRM Profile List</h1>
      <p className="text-gray-500">
        Profile list view is coming soon.
        {search && 'verification' in search && search.verification ? (
          <> Filter: verification = {search.verification}</>
        ) : null}
      </p>
    </div>
  )
}