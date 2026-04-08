import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import type { TemplateDto } from '../types/template'
import { Button } from '../components/ui/button'

async function fetchTemplates(): Promise<TemplateDto[]> {
  const res = await fetch('/api/templates')
  if (!res.ok) throw new Error('Failed to load templates')
  return res.json()
}

export function TemplateListPage() {
  const queryClient = useQueryClient()

  const { data: templates = [], isLoading, error } = useQuery<TemplateDto[]>({
    queryKey: ['templates'],
    queryFn: fetchTemplates,
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/templates/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete template')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  })

  function handleDelete(id: number, name: string) {
    if (window.confirm(`Delete template "${name}"?`)) {
      deleteMutation.mutate(id)
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Templates</h1>
        <Link to="/templates/new">
          <Button>New Template</Button>
        </Link>
      </div>

      {isLoading && <p className="text-slate-500">Loading…</p>}
      {error && <p className="text-red-600">Failed to load templates.</p>}

      {!isLoading && templates.length === 0 && (
        <p className="text-slate-500">No templates yet.</p>
      )}

      {templates.length > 0 && (
        <div className="space-y-2">
          {templates.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3"
            >
              <div className="min-w-0">
                <p className="font-medium text-slate-800">{t.name}</p>
                <p className="text-sm text-slate-500 truncate">{t.subject}</p>
              </div>
              <div className="ml-4 flex gap-2 shrink-0">
                <Link to={`/templates/${t.id}`}>
                  <Button variant="outline" size="sm">Edit</Button>
                </Link>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDelete(t.id, t.name)}
                  className="text-red-600 hover:text-red-700"
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
