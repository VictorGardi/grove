import { useState } from 'react'
import type { Feature, Session } from '@shared/types'
import { useSlices } from '../stores/slices'
import { sessionsOf } from '../sidebarOrder'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Icon } from './ui/Icon'
import { ListRow } from './ui/ListRow'
import css from './Sidebar.module.css'

function toggle(set: Set<string>, id: string): Set<string> {
  const next = new Set(set)
  if (!next.delete(id)) next.add(id)
  return next
}

function SessionCard({ s, focused, compact, onFocus, onToggleCompact }: {
  s: Session
  focused: boolean
  compact: boolean
  onFocus: () => void
  onToggleCompact: () => void
}) {
  const [editing, setEditing] = useState(false)
  const opencode = s.kind === 'opencode'

  return (
    <ListRow
      title={s.label}
      icon={<Icon name={opencode ? 'opencode' : 'terminal'} size={14} className={opencode ? css.iconOpencode : css.iconTerminal} />}
      status={{ label: s.lastStatus, tone: s.lastStatus }}
      tone={focused ? 'selected' : 'default'}
      compact={compact}
      onClick={onFocus}
      onTitleDoubleClick={() => setEditing(true)}
      editor={editing ? (
        <input
          autoFocus
          className={css.rename}
          defaultValue={s.label}
          onClick={(e) => e.stopPropagation()}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const label = e.currentTarget.value.trim()
              if (label) void window.api.invoke('session:rename', { id: s.id, label })
              setEditing(false)
            } else if (e.key === 'Escape') setEditing(false)
          }}
        />
      ) : undefined}
      actions={
        <>
          {s.lastStatus === 'gone' && (
            <Button variant="ghost" size="sm" round icon="trash" aria-label="Remove session" title="Remove"
              onClick={() => void window.api.invoke('session:remove', { id: s.id })} />
          )}
          <Button variant="ghost" size="sm" round icon="minimize" aria-label={compact ? 'Expand' : 'Compact'}
            title={compact ? 'Expand' : 'Compact'} onClick={onToggleCompact} />
        </>
      }
    />
  )
}

function FeatureRow({ f }: { f: Feature }) {
  const stage = f.stages.find((x) => x.id === f.currentStage)
  return (
    <ListRow
      title={f.title}
      icon={<Icon name="folder" size={14} className={css.iconFeature} />}
      meta={stage ? stage.label : 'Done'}
    />
  )
}

export function Sidebar({ onNew }: { onNew: (projectId?: string) => void }) {
  const { projects, sessions, ui, features, setFocused } = useSlices()
  const [refused, setRefused] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [compact, setCompact] = useState<Set<string>>(new Set())

  async function removeProject(id: string) {
    const res = await window.api.invoke('project:remove', { id })
    setRefused(res.ok ? null : id)
  }

  return (
    <div className={css.sidebar}>
      <div className={css.header}>
        <div className={css.tab}>
          Sessions <Badge>{sessions.length}</Badge>
        </div>
        <Button variant="ghost" size="sm" round icon="folder-plus" aria-label="Add project" title="Add project"
          className={css.add} onClick={() => void window.api.invoke('project:add')} />
      </div>
      <div className={css.list}>
        {projects.length === 0 && <div className={css.hint}>Add a project with the folder ＋ above</div>}
        {projects.map((p) => {
          const isCollapsed = collapsed.has(p.id)
          return (
            <div key={p.id} className={css.project}>
              <div className={css.folder} title={p.path} onClick={() => setCollapsed((c) => toggle(c, p.id))}>
                <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} size={12} />
                <Icon name="folder" size={14} />
                <span className={css.folderName}>{p.name}</span>
                <div className={css.folderActions} onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="sm" round icon="trash" aria-label="Remove project" title="Remove project"
                    className={css.hoverOnly} onClick={() => void removeProject(p.id)} />
                  <Button variant="ghost" size="sm" round icon="plus" aria-label="New session in project" title="New session"
                    onClick={() => onNew(p.id)} />
                </div>
              </div>
              {refused === p.id && <div className={css.refused}>Can't remove: project has running sessions</div>}
              {!isCollapsed && (
                <div className={css.cards}>
                  {features.items.filter((f) => f.projectId === p.id).map((f) => <FeatureRow key={f.slug} f={f} />)}
                  {sessionsOf(p.id, sessions).map((s) => (
                    <SessionCard
                      key={s.id}
                      s={s}
                      focused={s.id === ui.focusedSessionId}
                      compact={compact.has(s.id)}
                      onFocus={() => setFocused(s.id)}
                      onToggleCompact={() => setCompact((c) => toggle(c, s.id))}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
