import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { GRID_MAX, type Feature, type Project, type Session } from '@shared/types'
import { useSlices } from '../stores/slices'
import { gridShown } from '../gridView'
import { longestWaiting, shownStatus, statusTone, statusView } from '../sessionStatus'
import { selectRange } from '../selection'
import { GROUP_BY_OPTIONS, SORT_OPTIONS, listGroups, visibleSessions, type ListGroup } from '../sessionList'
import { colorTags } from '../tags'
import { linkedFeature } from '../tree'
import { workflowStatusOf } from '../workflowStatus'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { ContextMenu } from './ui/ContextMenu'
import { cx } from './ui/cx'
import { Icon } from './ui/Icon'
import { LinkPicker } from './LinkPicker'
import { ListRow } from './ui/ListRow'
import { tagClass } from './ui/Tag'
import { WorkflowStatusButton, Glyph } from './ui/WorkflowStatusPicker'
import css from './Sidebar.module.css'

function toggle(set: Set<string>, id: string): Set<string> {
  const next = new Set(set)
  if (!next.delete(id)) next.add(id)
  return next
}

function SessionCard({ s, feature, focused, picked, compact, inGrid, gridOn, gridFull, onToggleGrid, onFocus, onOpenFeature, onToggleCompact, onLink, onRemove, onContextMenu }: {
  s: Session
  feature: Feature | null // the linked feature, if it exists
  focused: boolean // a focused card shows selected
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
      icon={<WorkflowStatusButton session={s} />}
      meta={s.branch && (
        <div className={css.cardInfo}>
          <div className={css.branchLine}>
            <Icon name="branch" size={12} />
            <span className={css.branchName}>{s.branch}</span>
          </div>
        </div>
      )}
      status={{ ...statusView(s), tone: statusTone(s) }}
      tone={focused ? 'selected' : needsYou ? 'waiting' : 'default'}
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

// The heading for a group with no project behind it (grouped by workflow status, or by none):
// the status's own glyph, the label, the count. Clicking it collapses the group, as on a folder.
function GroupHeading({ group, onToggle }: { group: ListGroup; onToggle: () => void }) {
  const view = group.status ? workflowStatusOf(group.status) : null
  return (
    <div className={css.folder} title={group.label} onClick={onToggle}>
      {view && <Glyph view={view} size={13} className={cx(css.groupGlyph, css[`tone-${view.tone}`])} />}
      <span className={css.folderName}>{group.label}</span>
      {group.sessions.length > 0 && <Badge tone="muted">{group.sessions.length}</Badge>}
    </div>
  )
}

// A titled group of rows in the options panel. `role="group"` is what a menu may contain
// besides menuitems, and `aria-labelledby` names it from the heading that is already on screen.
function OptionSection({ headingId, label, children }: { headingId: string; label: string; children: ReactNode }) {
  return (
    <div className={css.visibilitySection} role="group" aria-labelledby={headingId}>
      <div id={headingId} className={css.visibilitySectionHeading}>{label}</div>
      {children}
    </div>
  )
}

// One choice in a single-select section: a radio row, checked on the right.
function OptionRow({ label, checked, onSelect }: { label: string; checked: boolean; onSelect: () => void }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={checked}
      className={css.visibilityItem} onClick={onSelect}>
      <span className={css.visibilityName}>{label}</span>
      <span className={css.visibilityCheck}>{checked && <Icon name="check" size={13} />}</span>
    </button>
  )
}

export function Sidebar({ onNew }: { onNew: (projectId?: string) => void }) {
  const { projects, sessions, ui, features, setFocused, toggleCollapsed, toggleProjectVisibility, focusFeature, openProject, setSidebarTab, setGroupBy, setSessionSort, toggleGrid, toggleGridMember, waitingSince } = useSlices()
  const waitingCount = sessions.filter((x) => shownStatus(x) === 'waiting').length
  const [refused, setRefused] = useState<string | null>(null)
  const [compact, setCompact] = useState<Set<string>>(new Set())
  const [linking, setLinking] = useState<Session | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set()) // shift-click multi-selection
  const [anchor, setAnchor] = useState<string | null>(null) // where a shift-click range starts
  const [menu, setMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null)
  const hidden = ui.hiddenProjects ?? []
  const [optionsOpen, setOptionsOpen] = useState(false)
  const optionsRef = useRef<HTMLDivElement>(null) // the button and its panel, for the outside click
  const panelRef = useRef<HTMLDivElement>(null) // the panel itself, which takes the position
  const anchorAt = useRef<{ left: number; bottom: number } | null>(null) // the button rect, captured on open
  const optionsId = useId()
  const sidebarId = `${optionsId}-sidebar`
  const groupById = `${optionsId}-group-by`
  const sortId = `${optionsId}-sort`
  const tags = colorTags(projects, features.items)

  // the session list, grouped and sorted as the panel says (the Projects tab doesn't draw it)
  const groups = ui.sidebarTab === 'sessions' ? listGroups(projects, sessions, ui) : []

  // Close the options panel on outside click
  useEffect(() => {
    if (!optionsOpen) return
    const onDown = (e: globalThis.MouseEvent) => {
      if (optionsRef.current && !optionsRef.current.contains(e.target as Node)) setOptionsOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [optionsOpen])

  // Place the panel from the button rect it was opened from, as CSS variables
  useEffect(() => {
    const el = panelRef.current
    const at = anchorAt.current
    if (!optionsOpen || !el || !at) return
    el.style.setProperty('--x', `${at.left}px`)
    el.style.setProperty('--y', `${at.bottom}px`)
  }, [optionsOpen])

  async function removeProject(id: string) {
    const res = await window.api.invoke('project:remove', { id })
    setRefused(res.ok ? null : id)
  }

  // the cards on screen, top to bottom: what a shift-click range runs over. Collapsed groups are
  // left out, so a range can't reach sessions that aren't on screen to be deleted.
  const order = ui.sidebarTab === 'sessions' ? visibleSessions(groups).map((x) => x.id) : []

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

  // a project's heading when there is a project; a status or plain one when there isn't
  const groupHeading = (g: ListGroup) =>
    g.project ? projectHeader(g.project, g.key, g.sessions.length)
      : <GroupHeading group={g} onToggle={() => toggleCollapsed(g.key)} />

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
          ? groups.map((g) => (
            <div key={g.key} className={css.project}>
              {groupHeading(g)}
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
        <div className={css.visibilityWrapper} ref={optionsRef}>
          <Button
            variant="ghost"
            size="sm"
            icon="sliders"
            aria-pressed={hidden.length > 0}
            aria-expanded={optionsOpen}
            aria-haspopup="menu"
            title={hidden.length > 0 ? `Session list options (${hidden.length} project hidden)` : 'Session list options'}
            onClick={(e) => {
              const next = !optionsOpen
              if (next) {
                const r = e.currentTarget.getBoundingClientRect()
                anchorAt.current = { left: Math.max(8, r.right - 240), bottom: window.innerHeight - r.top + 6 }
              }
              setOptionsOpen(next)
            }}
            className={hidden.length > 0 ? css.visibilityActive : ''} />
          {optionsOpen && (
            <div ref={panelRef} className={css.visibilityPopover} role="menu" aria-label="Session list options"
              onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOptionsOpen(false) } }}>
              <div className={css.visibilitySections}>
                <OptionSection headingId={sidebarId} label="Sidebar options">
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
                </OptionSection>
                <OptionSection headingId={groupById} label="Group by">
                  {GROUP_BY_OPTIONS.map((o) => (
                    <OptionRow key={o.value} label={o.label} checked={ui.groupBy === o.value}
                      onSelect={() => setGroupBy(o.value)} />
                  ))}
                </OptionSection>
                <OptionSection headingId={sortId} label="Sort">
                  {SORT_OPTIONS.map((o) => (
                    <OptionRow key={o.value} label={o.label} checked={ui.sessionSort === o.value}
                      onSelect={() => setSessionSort(o.value)} />
                  ))}
                </OptionSection>
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
