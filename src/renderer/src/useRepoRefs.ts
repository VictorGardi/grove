import { useEffect, useRef, useState } from 'react'
import type { Project } from '@shared/types'
import { repoOf, type RefsByRepo } from './launchRows'

// What each repo is on and would fork from. One fetch per repo, ever: "asked" lives in a ref
// rather than in the state, so a response cannot re-trigger the fetch and keep the rows
// rebuilding under a pointer that is mid-click.
export function useRepoRefs(projects: Project[]): RefsByRepo {
  const [refs, setRefs] = useState<RefsByRepo>({})
  const asked = useRef(new Set<string>())
  useEffect(() => {
    for (const p of projects) {
      const id = repoOf(p)
      if (asked.current.has(id)) continue
      asked.current.add(id)
      void window.api.invoke('repo:refs', { projectId: id }).then((res) => {
        if (res.ok) setRefs((r) => ({ ...r, [id]: res.data }))
      })
    }
  }, [projects])
  return refs
}
