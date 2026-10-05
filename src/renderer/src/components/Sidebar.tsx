import { useState } from 'react'
import type { Session } from '@shared/types'
import { useSlices } from '../stores/slices'
import { buildTree, type TreeNode } from '../tree'
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

type FeatureNode = Extract<TreeNode, { type: 'feature' }>

function FeatureRow({ node, onToggle }: { node: FeatureNode; onToggle: () => void }) {
  const f = node.feature
  const stage = f.stages.find((x) => x.id === f.currentStage)
  return (
    <ListRow
      title={f.title}
      icon={
        <>
          {node.children.length > 0 && (
            <button className={css.chevron} aria-label={node.collapsed ? 'Expand' : 'Collapse'}
              onClick={(e) => { e.stopPropagation(); onToggle() }}>
              <Icon name={node.collapsed ? 'chevron-right' : 'chevron-down'} size={12} />
            </button>
          )}
          <Icon name="folder" size={14} className={css.iconFeature} />
        </>
      }
      meta={stage ? stage.label : 'Done'}
    />
  )
}

export function Sidebar({ onNew }: { onNew: (projectId?: string) => void }) {
  const { projects, sessions, ui, features, setFocused, toggleCollapsed } = useSlices()
  const [refused, setRefused] = useState<string | null>(null)
  const [compact, setCompact] = useState<Set<string>>(new Set())
  const tree = buildTree(projects, features.items, sessions, ui)

  async function removeProject(id: string) {
    const res = await window.api.invoke('project:remove', { id })
    setRefused(res.ok ? null : id)
  }

  // Feature and session nodes; a feature's children follow it, indented.
  function renderNode(n: TreeNode) {
    if (n.type === 'session') {
      const s = n.session
      return (
        <SessionCard
          key={n.key}
          s={s}
          focused={s.id === ui.focusedSessionId}
          compact={compact.has(s.id)}
          onFocus={() => setFocused(s.id)}
          onToggleCompact={() => setCompact((c) => toggle(c, s.id))}
        />
      )
    }
    if (n.type === 'project') return null
    return (
      <div key={n.key} className={css.cards}>
        <FeatureRow node={n} onToggle={() => toggleCollapsed(n.key)} />
        {!n.collapsed && n.children.length > 0 && <div className={css.children}>{n.children.map(renderNode)}</div>}
      </div>
    )
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
        {tree.map((n) => {
          if (n.type !== 'project') return null
          const p = n.project
          return (
            <div key={n.key} className={css.project}>
              <div className={css.folder} title={p.path} onClick={() => toggleCollapsed(n.key)}>
                <Icon name={n.collapsed ? 'chevron-right' : 'chevron-down'} size={12} />
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
              {!n.collapsed && <div className={css.cards}>{n.children.map(renderNode)}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
