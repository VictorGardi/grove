import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { GRID_MAX, type Feature, type Project, type Session } from '@shared/types'
import { useSlices } from '../stores/slices'
import { gridShown } from '../gridView'
import { longestWaiting, shownStatus, statusView } from '../sessionStatus'
import { selectRange } from '../selection'
import { colorTags } from '../tags'
import { linkedFeature, sessionGroups } from '../tree'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { ContextMenu } from './ui/ContextMenu'
import { Icon } from './ui/Icon'
import { LinkPicker } from './LinkPicker'
import { ListRow } from './ui/ListRow'
import { tagClass } from './ui/Tag'
import css from './Sidebar.module.css'

function toggle(set: Set<string>, id: string): Set<string> {
  const next = new Set(set)
  if (!next.delete(id)) next.add(id)
  return next
}

function SessionCard({ s, feature, focused, picked, compact, inGrid, gridOn, gridFull, onToggleGrid, onFocus, onOpenFeature, onToggleCompact, onLink, onRemove, onContextMenu }: {
  s: Session
  feature: Feature | null // the linked feature, if it exists
  focused: boolean // a focused card shows selected; otherwise terminals are muted
  picked: boolean // in the shift-click multi-selection
  compact: boolean
  inGrid: boolean // a member of the session grid
  gridOn: boolean // the grid is showing: members keep their check visible
  gridFull: boolean // the grid has its nine
  onToggleGrid: () => void
  onFocus: (e: MouseEvent) => void
  onOpenFeature: () => void
  onToggleCompact: () => void
  onLink: () => void
  onRemove: () => void
  onContextMenu: (e: MouseEvent) => void
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
      meta={s.branch && (
        <div className={css.cardInfo}>
          <div className={css.branchLine}>
            <Icon name="branch" size={12} />
            <span className={css.branchName}>{s.branch}</span>
          </div>
        </div>
      )}
      status={statusView(s)}
      tone={focused ? 'selected' : needsYou ? 'waiting' : agent ? 'default' : 'muted'}
      picked={picked}
      compact={compact}
      onClick={onFocus}
      onContextMenu={onContextMenu}
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
          <Button variant="ghost" size="sm" round icon="x" aria-label="Remove session" title="Remove session" onClick={onRemove} />
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

function ProjectHeader({ project: p, tag, count, refused, onToggle, onRemove, onNew }: {
  project: Project
  tag: number | null
  count: number // sessions under this project, shown even while collapsed
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
        {count > 0 && <Badge tone="muted">{count}</Badge>}
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
  const { projects, sessions, ui, features, setFocused, toggleCollapsed, toggleProjectVisibility, focusFeature, openProject, setSidebarTab, toggleGrid, toggleGridMember, toggleSidebar, waitingSince } = useSlices()
  const waitingCount = sessions.filter((x) => shownStatus(x) === 'waiting').length
  const [refused, setRefused] = useState<string | null>(null)
  const [compact, setCompact] = useState<Set<string>>(new Set())
  const [linking, setLinking] = useState<Session | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set()) // shift-click multi-selection
  const [anchor, setAnchor] = useState<string | null>(null) // where a shift-click range starts
  const [menu, setMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null)
  const hidden = ui.hiddenProjects ?? []
  const [visibilityOpen, setVisibilityOpen] = useState(false)
  const [popPos, setPopPos] = useState<{ left: number; bottom: number }>({ left: 0, bottom: 0 })
  const visibilityRef = useRef<HTMLDivElement>(null)
  const tags = colorTags(projects, features.items)

  // Close visibility popover on outside click
  useEffect(() => {
    if (!visibilityOpen) return
    const onDown = (e: globalThis.MouseEvent) => {
      if (visibilityRef.current && !visibilityRef.current.contains(e.target as Node)) setVisibilityOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [visibilityOpen])

  async function removeProject(id: string) {
    const res = await window.api.invoke('project:remove', { id })
    setRefused(res.ok ? null : id)
  }

  // the cards on screen, top to bottom: what a shift-click range runs over
  const order = ui.sidebarTab === 'sessions' ? sessionGroups(projects, sessions, ui).flatMap((g) => (g.collapsed ? [] : g.sessions.map((x) => x.id))) : []

  function clickCard(id: string, e: MouseEvent) {
    if (e.shiftKey) {
      setPicked(selectRange(order, anchor ?? ui.focusedSessionId, id))
      return
    }
    setPicked(new Set())
    setAnchor(id)
    setFocused(id)
  }

  function openMenu(id: string, e: MouseEvent) {
    e.preventDefault()
    // right-clicking inside the selection acts on all of it; outside, on that card alone
    const ids = picked.has(id) ? order.filter((x) => picked.has(x)) : [id]
    if (!picked.has(id)) { setPicked(new Set()); setAnchor(id) }
    setMenu({ x: e.clientX, y: e.clientY, ids })
  }

  const removeSessions = (ids: string[]) => {
    setPicked(new Set())
    for (const id of ids) void window.api.invoke('session:remove', { id })
  }

  const sessionCard = (s: Session) => {
    const f = linkedFeature(s, features.items)
    return (
      <SessionCard
        key={s.id}
        s={s}
        feature={f}
        focused={s.id === ui.focusedSessionId}
        picked={picked.has(s.id)}
        compact={compact.has(s.id)}
        inGrid={ui.grid.members.includes(s.id)}
        gridOn={gridShown(ui)}
        gridFull={ui.grid.members.length >= GRID_MAX}
        onToggleGrid={() => toggleGridMember(s.id)}
        onFocus={(e) => clickCard(s.id, e)}
        onOpenFeature={() => f && focusFeature({ projectId: f.projectId, slug: f.slug })}
        onToggleCompact={() => setCompact((c) => toggle(c, s.id))}
        onLink={() => setLinking(s)}
        onRemove={() => removeSessions([s.id])}
        onContextMenu={(e) => openMenu(s.id, e)}
      />
    )
  }

  const projectHeader = (p: Project, key: string, count: number) => (
    <ProjectHeader project={p} tag={tags.project(p.id)} count={count} refused={refused === p.id}
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
        <Button variant="ghost" size="sm" round icon="sidebar" aria-label="Collapse sidebar" title="Collapse sidebar (⌘B)"
          onClick={toggleSidebar} />
      </div>
      <div className={css.list}>
        {projects.length === 0 && <div className={css.hint}>Add a project with the folder ＋ above</div>}
        {ui.sidebarTab === 'sessions'
          ? sessionGroups(projects, sessions, ui).map((g) => (
            <div key={g.key} className={css.project}>
              {projectHeader(g.project, g.key, g.sessions.length)}
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
        {waitingCount > 0 && (
          <Button size="sm" className={css.waiting} title="Focus the session that has waited longest"
            onClick={() => { const w = longestWaiting(sessions, waitingSince); if (w) setFocused(w.id) }}>
            {waitingCount} waiting
          </Button>
        )}
        <div className={css.visibilityWrapper} ref={visibilityRef}>
          <Button
            variant="ghost"
            size="sm"
            icon={hidden.length > 0 ? 'eye-off' : 'eye'}
            aria-pressed={hidden.length > 0}
            aria-expanded={visibilityOpen}
            aria-haspopup="menu"
            title={hidden.length > 0 ? `Project visibility (${hidden.length} hidden)` : 'Project visibility'}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              setPopPos({ left: Math.max(8, r.right - 240), bottom: window.innerHeight - r.top + 6 })
              setVisibilityOpen(!visibilityOpen)
            }}
            className={hidden.length > 0 ? css.visibilityActive : ''} />
          {visibilityOpen && (
            <div className={css.visibilityPopover} style={popPos} role="menu" aria-label="Project visibility"
              onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setVisibilityOpen(false) } }}>
              <div className={css.visibilityList}>
                {projects.map((p) => {
                  const total = sessions.filter((x) => x.projectId === p.id).length
                  const shown = !hidden.includes(p.id)
                  return (
                    <button key={p.id} type="button" role="menuitemcheckbox" aria-checked={shown}
                      className={shown ? css.visibilityItem : css.visibilityItemOff}
                      onClick={() => toggleProjectVisibility(p.id)}>
                      <Icon name="folder" size={13} className={tagClass(tags.project(p.id), 'fg')} />
                      <span className={css.visibilityName}>{p.name}</span>
                      {total > 0 && <span className={css.visibilityCount}>{total}</span>}
                      <span className={css.visibilityCheck}>{shown && <Icon name="check" size={13} />}</span>
                    </button>
                  )
                })}
              </div>
              <div className={css.visibilityFooter}>
                <button type="button" className={css.visibilityAction} disabled={hidden.length === 0}
                  onClick={() => void window.api.invoke('ui:set', { hiddenProjects: [] })}>Show all</button>
                <button type="button" className={css.visibilityAction} disabled={hidden.length === projects.length}
                  onClick={() => void window.api.invoke('ui:set', { hiddenProjects: projects.map((p) => p.id) })}>Hide all</button>
              </div>
            </div>
          )}
        </div>
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}
          items={[{ label: menu.ids.length === 1 ? 'Remove session' : `Remove ${menu.ids.length} sessions`, icon: 'trash', danger: true, onSelect: () => removeSessions(menu.ids) }]} />
      )}
      {linking && <LinkPicker session={linking} onClose={() => setLinking(null)} />}
    </div>
  )
}
