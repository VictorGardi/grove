import { useState } from 'react'
import type { Feature, Project, Session } from '@shared/types'
import { useSlices } from '../stores/slices'
import { featureStage, featureSummary } from '../featureLabels'
import { colorTags } from '../tags'
import { buildTree, linkedFeature, sessionGroups, type TreeNode } from '../tree'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Icon } from './ui/Icon'
import { LinkPicker } from './LinkPicker'
import { ListRow } from './ui/ListRow'
import { cx } from './ui/cx'
import { Tag, tagClass } from './ui/Tag'
import css from './Sidebar.module.css'

function toggle(set: Set<string>, id: string): Set<string> {
  const next = new Set(set)
  if (!next.delete(id)) next.add(id)
  return next
}

function SessionCard({ s, feature, tag, focused, compact, onFocus, onOpenFeature, onToggleCompact, onLink }: {
  s: Session
  feature: Feature | null // the linked feature, if it exists
  tag: number | null // its epic's colour
  focused: boolean // a focused card shows selected; otherwise terminals are muted
  compact: boolean
  onFocus: () => void
  onOpenFeature: () => void
  onToggleCompact: () => void
  onLink: () => void
}) {
  const [editing, setEditing] = useState(false)
  const opencode = s.kind === 'opencode'

  return (
    <ListRow
      title={s.label}
      icon={<Icon name={opencode ? 'opencode' : 'terminal'} size={14} className={opencode ? css.iconOpencode : css.iconTerminal} />}
      meta={(feature || s.branch) && (
        <div className={css.cardInfo}>
          {feature && (
            <div className={css.featureLine}>
              <Tag index={tag}>{feature.title}</Tag>
              <span className={css.featureStage}>{featureStage(feature)}</span>
            </div>
          )}
          {s.branch && (
            <div className={css.branchLine}>
              <Icon name="branch" size={12} />
              <span className={css.branchName}>{s.branch}</span>
            </div>
          )}
        </div>
      )}
      status={{ label: s.lastStatus, tone: s.lastStatus }}
      tone={focused ? 'selected' : opencode ? 'default' : 'muted'}
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
          {feature && (
            <Button variant="ghost" size="sm" round icon="folder" aria-label="Open feature" title="Open feature"
              onClick={onOpenFeature} />
          )}
          <Button variant="ghost" size="sm" round icon="link" aria-label="Link…" title="Link…" onClick={onLink} />
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

function FeatureRow({ node, tag, focused, onFocus, onToggle }: {
  node: FeatureNode
  tag: number | null // set for groups (epics)
  focused: boolean
  onFocus: () => void
  onToggle: () => void
}) {
  const f = node.feature
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
          <Icon name="folder" size={14} className={cx(css.iconFeature, tagClass(tag, 'fg'))} />
        </>
      }
      meta={featureSummary(f)}
      tone={focused ? 'selected' : 'default'}
      onClick={onFocus}
    />
  )
}

function ProjectHeader({ project: p, collapsed, tag, refused, onToggle, onRemove, onNew }: {
  project: Project
  collapsed: boolean
  tag: number | null
  refused: boolean
  onToggle: () => void
  onRemove: () => void
  onNew: () => void
}) {
  return (
    <>
      <div className={css.folder} title={p.path} onClick={onToggle}>
        <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={12} />
        <Icon name="folder" size={14} className={tagClass(tag, 'fg')} />
        <span className={css.folderName}>{p.name}</span>
        <div className={css.folderActions} onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" round icon="trash" aria-label="Remove project" title="Remove project"
            className={css.hoverOnly} onClick={onRemove} />
          <Button variant="ghost" size="sm" round icon="plus" aria-label="New session in project" title="New session"
            onClick={onNew} />
        </div>
      </div>
      {refused && <div className={css.refused}>Can't remove: project has running sessions</div>}
    </>
  )
}

export function Sidebar({ onNew }: { onNew: (projectId?: string) => void }) {
  const { projects, sessions, ui, features, setFocused, toggleCollapsed, focusFeature, setSidebarTab } = useSlices()
  const [refused, setRefused] = useState<string | null>(null)
  const [compact, setCompact] = useState<Set<string>>(new Set())
  const [linking, setLinking] = useState<Session | null>(null)
  const tags = colorTags(projects, features.items)

  async function removeProject(id: string) {
    const res = await window.api.invoke('project:remove', { id })
    setRefused(res.ok ? null : id)
  }

  const sessionCard = (s: Session) => {
    const f = linkedFeature(s, features.items)
    return (
      <SessionCard
        key={s.id}
        s={s}
        feature={f}
        tag={f && tags.group(f.projectId, f.group ? f.slug : f.parent)}
        focused={s.id === ui.focusedSessionId}
        compact={compact.has(s.id)}
        onFocus={() => setFocused(s.id)}
        onOpenFeature={() => f && focusFeature({ projectId: f.projectId, slug: f.slug })}
        onToggleCompact={() => setCompact((c) => toggle(c, s.id))}
        onLink={() => setLinking(s)}
      />
    )
  }

  const projectHeader = (p: Project, key: string, collapsed: boolean) => (
    <ProjectHeader project={p} collapsed={collapsed} tag={tags.project(p.id)} refused={refused === p.id}
      onToggle={() => toggleCollapsed(key)} onRemove={() => void removeProject(p.id)} onNew={() => onNew(p.id)} />
  )

  // Features tab: a feature's children follow it, indented.
  function renderNode(n: TreeNode) {
    if (n.type === 'project') return null
    const tag = n.feature.group ? tags.group(n.feature.projectId, n.feature.slug) : null
    return (
      <div key={n.key} className={css.cards}>
        <FeatureRow
          node={n}
          tag={tag}
          focused={ui.focusedFeature?.projectId === n.feature.projectId && ui.focusedFeature.slug === n.feature.slug}
          onFocus={() => focusFeature({ projectId: n.feature.projectId, slug: n.feature.slug })}
          onToggle={() => toggleCollapsed(n.key)}
        />
        {!n.collapsed && n.children.length > 0 && (
          <div className={cx(css.children, tagClass(tag, 'rail'))}>{n.children.map(renderNode)}</div>
        )}
      </div>
    )
  }

  const tabs = [
    { id: 'sessions' as const, label: 'Sessions', badge: <Badge>{sessions.length}</Badge> },
    { id: 'features' as const, label: 'Features', badge: null },
  ]

  return (
    <div className={css.sidebar}>
      <div className={css.header}>
        {tabs.map((tab) => (
          <button key={tab.id} type="button" className={ui.sidebarTab === tab.id ? css.tab : css.tabInactive}
            aria-pressed={ui.sidebarTab === tab.id} onClick={() => setSidebarTab(tab.id)}>
            {tab.label} {tab.badge}
          </button>
        ))}
        <Button variant="ghost" size="sm" round icon="folder-plus" aria-label="Add project" title="Add project"
          className={css.add} onClick={() => void window.api.invoke('project:add')} />
      </div>
      <div className={css.list}>
        {projects.length === 0 && <div className={css.hint}>Add a project with the folder ＋ above</div>}
        {ui.sidebarTab === 'sessions'
          ? sessionGroups(projects, sessions, ui).map((g) => (
            <div key={g.key} className={css.project}>
              {projectHeader(g.project, g.key, g.collapsed)}
              {!g.collapsed && <div className={css.cards}>{g.sessions.map(sessionCard)}</div>}
            </div>
          ))
          : buildTree(projects, features.items, ui).map((n) => n.type === 'project' && (
            <div key={n.key} className={css.project}>
              {projectHeader(n.project, n.key, n.collapsed)}
              {!n.collapsed && <div className={css.cards}>{n.children.map(renderNode)}</div>}
            </div>
          ))}
      </div>
      {linking && <LinkPicker session={linking} onClose={() => setLinking(null)} />}
    </div>
  )
}
