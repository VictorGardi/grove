import { useState } from 'react'
import { GRID_MAX, type Feature, type Project, type Session } from '@shared/types'
import { useSlices } from '../stores/slices'
import { gridShown } from '../gridView'
import { featureStage } from '../featureLabels'
import { shownStatus, statusView } from '../sessionStatus'
import { colorTags } from '../tags'
import { linkedFeature, sessionGroups } from '../tree'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Icon } from './ui/Icon'
import { LinkPicker } from './LinkPicker'
import { ListRow } from './ui/ListRow'
import { Tag, tagClass } from './ui/Tag'
import css from './Sidebar.module.css'

function toggle(set: Set<string>, id: string): Set<string> {
  const next = new Set(set)
  if (!next.delete(id)) next.add(id)
  return next
}

function SessionCard({ s, feature, tag, focused, compact, inGrid, gridOn, gridFull, onToggleGrid, onFocus, onOpenFeature, onToggleCompact, onLink, onKill }: {
  s: Session
  feature: Feature | null // the linked feature, if it exists
  tag: number | null // its parent feature's colour
  focused: boolean // a focused card shows selected; otherwise terminals are muted
  compact: boolean
  inGrid: boolean // a member of the session grid
  gridOn: boolean // the grid is showing: members keep their check visible
  gridFull: boolean // the grid has its nine
  onToggleGrid: () => void
  onFocus: () => void
  onOpenFeature: () => void
  onToggleCompact: () => void
  onLink: () => void
  onKill: () => void
}) {
  const [editing, setEditing] = useState(false)
  const agent = s.kind !== 'terminal'
  const shown = shownStatus(s)
  const done = shown === 'waiting' && s.waitingFor === 'done' // the agent finished and nobody has looked
  const needsYou = shown === 'waiting' && !done

  return (
    <ListRow
      title={s.label}
      corner={
        <Button variant="ghost" size="sm" round icon={inGrid ? 'check' : 'plus'} aria-pressed={inGrid}
          disabled={!inGrid && gridFull}
          aria-label={inGrid ? 'Remove from grid' : 'Add to grid'}
          title={inGrid ? 'Remove from grid' : gridFull ? `The grid holds ${GRID_MAX} sessions` : 'Add to grid'}
          onClick={onToggleGrid} />
      }
      cornerPinned={inGrid && gridOn}
      icon={agent
        ? <Icon name={done ? 'agent-done' : 'agent'} size={13} className={done ? css.iconDone : shown === 'gone' ? css.iconGone : css.iconAgent} />
        : <Icon name="terminal" size={13} className={css.iconTerminal} />}
      badge={needsYou && <Icon name="agent-alert" size={13} className={css.iconAgent} />}
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
      status={statusView(s)}
      tone={focused ? 'selected' : needsYou ? 'waiting' : agent ? 'default' : 'muted'}
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
          {s.lastStatus === 'gone' && s.kind !== 'terminal' && (
            <Button variant="ghost" size="sm" round icon="resume" aria-label="Resume session" title="Resume"
              onClick={() => void window.api.invoke('session:resume', { id: s.id })} />
          )}
          <Button variant="ghost" size="sm" round icon="minus" aria-label={compact ? 'Expand' : 'Compact'}
            title={compact ? 'Expand' : 'Compact'} onClick={onToggleCompact} />
          {s.lastStatus === 'gone'
            ? <Button variant="ghost" size="sm" round icon="x" aria-label="Remove session" title="Remove"
              onClick={() => void window.api.invoke('session:remove', { id: s.id })} />
            : <Button variant="ghost" size="sm" round icon="x" aria-label="Close session" title="Close session" onClick={onKill} />}
        </>
      }
    />
  )
}

// Projects tab: one row per project; clicking opens its page (ADR 0018).
function ProjectRow({ project: p, tag, live, waiting, focused, refused, onOpen, onRemove, onNew }: {
  project: Project
  tag: number | null
  live: number // running sessions
  waiting: number
  focused: boolean
  refused: boolean
  onOpen: () => void
  onRemove: () => void
  onNew: () => void
}) {
  return (
    <>
      <ListRow
        title={p.name}
        icon={<Icon name="folder" size={13} className={tagClass(tag, 'fg')} />}
        meta={
          <div className={css.projectMeta}>
            <span>{live} live</span>
            {waiting > 0 && <Badge tone="waiting">{waiting} waiting</Badge>}
          </div>
        }
        tone={focused ? 'selected' : 'default'}
        onClick={onOpen}
        actions={
          <>
            <Button variant="ghost" size="sm" round icon="plus" aria-label="New session in project" title="New session"
              onClick={onNew} />
            <Button variant="ghost" size="sm" round icon="trash" aria-label="Remove project" title="Remove project"
              onClick={onRemove} />
          </>
        }
      />
      {refused && <div className={css.refused}>Can't remove: project has running sessions</div>}
    </>
  )
}

function ProjectHeader({ project: p, tag, refused, onToggle, onRemove, onNew }: {
  project: Project
  tag: number | null
  refused: boolean
  onToggle: () => void
  onRemove: () => void
  onNew: () => void
}) {
  return (
    <>
      <div className={css.folder} title={p.path} onClick={onToggle}>
        <Icon name="folder" size={16} className={tagClass(tag, 'fg')} />
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

export function Sidebar({ onNew, onKill }: { onNew: (projectId?: string) => void; onKill: (s: Session) => void }) {
  const { projects, sessions, ui, features, setFocused, toggleCollapsed, focusFeature, openProject, setSidebarTab, toggleGrid, toggleGridMember } = useSlices()
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
        inGrid={ui.grid.members.includes(s.id)}
        gridOn={gridShown(ui)}
        gridFull={ui.grid.members.length >= GRID_MAX}
        onToggleGrid={() => toggleGridMember(s.id)}
        onFocus={() => setFocused(s.id)}
        onOpenFeature={() => f && focusFeature({ projectId: f.projectId, slug: f.slug })}
        onToggleCompact={() => setCompact((c) => toggle(c, s.id))}
        onLink={() => setLinking(s)}
        onKill={() => onKill(s)}
      />
    )
  }

  const projectHeader = (p: Project, key: string) => (
    <ProjectHeader project={p} tag={tags.project(p.id)} refused={refused === p.id}
      onToggle={() => toggleCollapsed(key)} onRemove={() => void removeProject(p.id)} onNew={() => onNew(p.id)} />
  )

  const tabs = [
    { id: 'sessions' as const, label: 'Sessions', badge: <Badge>{sessions.length}</Badge> },
    { id: 'projects' as const, label: 'Projects', badge: null },
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
              {projectHeader(g.project, g.key)}
              {!g.collapsed && <div className={css.cards}>{g.sessions.map(sessionCard)}</div>}
            </div>
          ))
          : projects.map((p) => (
            <ProjectRow key={p.id} project={p} tag={tags.project(p.id)}
              live={sessions.filter((x) => x.projectId === p.id && x.lastStatus === 'running').length}
              waiting={sessions.filter((x) => x.projectId === p.id && shownStatus(x) === 'waiting').length}
              focused={ui.focusedProject === p.id} refused={refused === p.id}
              onOpen={() => openProject(p.id)} onRemove={() => void removeProject(p.id)} onNew={() => onNew(p.id)} />
          ))}
      </div>
      <div className={css.bottomBar}>
        <Button variant="ghost" size="sm" icon="grid" aria-pressed={gridShown(ui)} disabled={ui.grid.members.length === 0}
          title={ui.grid.members.length === 0 ? 'Add sessions to the grid with the + on a card' : 'Session grid (⌘G)'}
          onClick={toggleGrid}>
          Grid {ui.grid.members.length > 0 && ui.grid.members.length}
        </Button>
      </div>
      {linking && <LinkPicker session={linking} onClose={() => setLinking(null)} />}
    </div>
  )
}
