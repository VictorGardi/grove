import { useEffect, useId, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import { GRID_MAX, type Feature, type Project, type Session } from '@shared/types'
import { useSlices } from '../stores/slices'
import { gridShown } from '../gridView'
import { kidsKey } from '@shared/groups'
import { canParent, hasChildren } from '@shared/sessionGroups'
import { longestWaiting, mostUrgent, shownStatus, statusTone, statusView } from '../sessionStatus'
import { selectRange } from '../selection'
import { GROUP_BY_OPTIONS, SORT_OPTIONS, canDrop, dropSession, groupSize, kidsGroup, listGroups, visibleSessions, type DropAt, type ListGroup } from '../sessionList'
import { repoGroups, repoRows } from '../repoGroups'
import { colorTags } from '../tags'
import { linkedFeature } from '../tree'
import { workflowStatusOf } from '../workflowStatus'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { ContextMenu } from './ui/ContextMenu'
import { cx } from './ui/cx'
import { Icon } from './ui/Icon'
import { LinkPicker } from './LinkPicker'
import { ParentPicker } from './ParentPicker'
import { ListRow } from './ui/ListRow'
import { BranchMark } from './BranchMark'
import { StatusDot } from './ui/StatusDot'
import { tagClass } from './ui/Tag'
import { WorkflowStatusButton, Glyph } from './ui/WorkflowStatusPicker'
import css from './Sidebar.module.css'

function SessionCard({ s, feature, worktree, focused, picked, compact, inGrid, gridOn, gridFull, onToggleGrid, onFocus, onOpenFeature, onToggleCompact, onLink, onRemove, onContextMenu, kids }: {
  s: Session
  feature: Feature | null // the linked feature, if it exists
  focused: boolean // a focused card shows selected
  picked: boolean // in the shift-click multi-selection
  compact: boolean
  worktree?: Project // set when the session runs in a git worktree
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
  kids?: { list: Session[]; collapsed: boolean; holdsFocus: boolean; onToggle: () => void } // set on a parent: its children, for the toggle and the roll-up; holdsFocus when a hidden child is the focused session
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
      tab={kids && kids.list.length > 0 && (
        <button type="button" className={cx(css.kidsToggle, kids.holdsFocus && css.kidsToggleHolding)} aria-expanded={!kids.collapsed}
          title={kids.collapsed ? 'Show children' : 'Hide children'}
          onClick={(e) => { e.stopPropagation(); kids.onToggle() }}>
          {/* collapsed, the most urgent child shows through: a waiting child is never hidden */}
          {kids.collapsed && (() => { const u = mostUrgent(kids.list); return u && <StatusDot tone={statusTone(u)} /> })()}
          <Icon name={kids.collapsed ? 'chevron-right' : 'chevron-down'} size={10} />
          {kids.list.length}
        </button>
      )}
      icon={<WorkflowStatusButton session={s} />}
      meta={s.branch && (
        <div className={css.cardInfo}>
          <div className={css.branchLine}>
            <BranchMark pr={s.pr} />
            <span className={css.branchName}>{s.branch}</span>
          </div>
        </div>
      )}
      mark={worktree && { icon: <Icon name="worktree" size={14} />, label: `Worktree: ${worktree.path}` }}
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
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  return (
    <>
      <div className={cx(css.folder, menuAt && css.folderMenuOpen)} title={p.path} onClick={onToggle}>
        <Icon name="folder" size={16} className={tagClass(tag, 'fg')} />
        <span className={css.folderName}>{p.name}</span>
        <div className={css.folderEnd} onClick={(e) => e.stopPropagation()}>
          {count > 0 && <span className={css.folderCount}><Badge tone="muted">{count}</Badge></span>}
          <Button variant="ghost" size="sm" round icon="more-vertical" aria-label="Project options" aria-haspopup="menu"
            className={css.folderMore}
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenuAt({ x: r.right, y: r.bottom + 4 }) }} />
        </div>
      </div>
      {menuAt && (
        <ContextMenu x={menuAt.x - 150} y={menuAt.y} onClose={() => setMenuAt(null)}
          items={[
            { label: 'Add session', icon: 'plus', onSelect: onNew },
            { label: 'Remove project', icon: 'trash', danger: true, onSelect: onRemove },
          ]} />
      )}
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

export function Sidebar({ onNew, onNote, onRemove }: { onNew: (projectId?: string) => void; onNote: (s: Session) => void; onRemove: (ids: string[]) => void }) {
  const { projects, sessions, ui, features, setFocused, toggleCollapsed, toggleCompact, toggleProjectVisibility, toggleHideDone, focusFeature, openProject, setSidebarTab, setGroupBy, setSessionSort, toggleGrid, toggleGridMember, waitingSince } = useSlices()
  const waitingCount = sessions.filter((x) => shownStatus(x) === 'waiting').length
  const [refused, setRefused] = useState<string | null>(null)
  const compact = new Set(ui.compact ?? [])
  const [linking, setLinking] = useState<Session | null>(null)
  const [parenting, setParenting] = useState<Session | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set()) // shift-click multi-selection
  const [anchor, setAnchor] = useState<string | null>(null) // where a shift-click range starts
  const [menu, setMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null)
  const hidden = ui.hiddenProjects ?? []
  const noteTarget = menu?.ids.length === 1 ? sessions.find((x) => x.id === menu.ids[0]) : undefined // a note belongs to one session
  // what the options panel shows and hides: one row per repo, its worktrees counted in, since
  // the repo is the unit rather than the checkout
  const rows = repoRows(projects, sessions)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const optionsRef = useRef<HTMLDivElement>(null) // the button and its panel, for the outside click
  const panelRef = useRef<HTMLDivElement>(null) // the panel itself, which takes the position
  const anchorAt = useRef<{ left: number; bottom: number } | null>(null) // the button rect, captured on open
  const optionsId = useId()
  const sidebarId = `${optionsId}-sidebar`
  const groupById = `${optionsId}-group-by`
  const sortId = `${optionsId}-sort`
  const statusId = `${optionsId}-status`
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
    onRemove(ids)
  }

  // Drag to reorder (ADR 0041), on only while the sort is custom. Only the grabbed card moves: the
  // shift-click selection is not part of a drag. `over` is where the indicator line is drawn.
  const draggable = ui.sessionSort === 'custom'
  const [drag, setDrag] = useState<{ id: string; from: ListGroup } | null>(null)
  const [over, setOver] = useState<{ group: ListGroup; at: DropAt | null } | null>(null)
  const endDrag = () => { setDrag(null); setOver(null) }

  // where in `g` the pointer is: beside the card under it, or at the end of the group
  function aimAt(g: ListGroup, e: DragEvent, target?: Session) {
    if (!drag || !canDrop(ui.groupBy, drag.from, g)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (target) {
      const r = e.currentTarget.getBoundingClientRect()
      setOver({ group: g, at: { target: target.id, after: e.clientY > r.top + r.height / 2 } })
    } else {
      const last = g.sessions[g.sessions.length - 1]
      setOver({ group: g, at: last ? { target: last.id, after: true } : null })
    }
  }

  function dropHere(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    const moved = drag && sessions.find((x) => x.id === drag.id)
    const result = drag && over && moved ? dropSession(ui.groupBy, sessions, ui.sessionOrder, moved, drag.from, over.group, over.at) : null
    endDrag()
    if (!result || !moved) return
    if (result.status) void window.api.invoke('session:workflowStatus', { id: moved.id, status: result.status })
    void window.api.invoke('ui:set', { sessionOrder: result.order })
  }

  // one draggable card; `grp` is the list it reorders within (a parent's children are a list of their own)
  const slot = (s: Session, grp: ListGroup, kids?: Session[]) => {
    const line = over?.group.key === grp.key && over.at?.target === s.id && drag?.id !== s.id
      ? over.at.after ? css.dropAfter : css.dropBefore : undefined
    return (
      <div key={s.id} className={cx(css.slot, drag?.id === s.id && css.slotDragging, line)}
        draggable={draggable}
        onDragStart={draggable ? (e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', s.id)
          setDrag({ id: s.id, from: grp })
        } : undefined}
        onDragEnd={draggable ? endDrag : undefined}
        onDragOver={draggable ? (e) => aimAt(grp, e, s) : undefined}
        onDrop={draggable ? dropHere : undefined}>
        {sessionCard(s, kids)}
      </div>
    )
  }

  const cardList = (g: ListGroup) => (
    <div className={cx(css.cards, drag && css.cardsDragging)}
      onDragOver={draggable ? (e) => aimAt(g, e) : undefined} onDrop={draggable ? dropHere : undefined}>
      {g.sessions.map((s) => {
        const list = g.nest.kids.get(s.id) ?? []
        const kg = kidsGroup(g, s)
        return (
          <div key={s.id} className={css.cards}>
            {slot(s, g, list)}
            {list.length > 0 && !kg.collapsed && (
              <div className={cx(css.cards, css.kids, drag && css.cardsDragging)}
                onDragOver={draggable ? (e) => aimAt(kg, e) : undefined} onDrop={draggable ? dropHere : undefined}>
                {list.map((k) => slot(k, kg))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )

  const sessionCard = (s: Session, kids?: Session[]) => {
    const f = linkedFeature(s, features.items)
    return (
      <SessionCard
        key={s.id}
        s={s}
        feature={f}
        worktree={projects.find((p) => p.id === s.projectId && p.worktreeOf)}
        focused={s.id === ui.focusedSessionId}
        picked={picked.has(s.id)}
        compact={compact.has(s.id)}
        inGrid={ui.grid.members.includes(s.id)}
        gridOn={gridShown(ui)}
        gridFull={ui.grid.members.length >= GRID_MAX}
        onToggleGrid={() => toggleGridMember(s.id)}
        onFocus={(e) => clickCard(s.id, e)}
        onOpenFeature={() => f && focusFeature({ projectId: f.projectId, slug: f.slug })}
        onToggleCompact={() => toggleCompact(s.id)}
        onLink={() => setLinking(s)}
        onRemove={() => removeSessions([s.id])}
        onContextMenu={(e) => openMenu(s.id, e)}
        kids={kids && { list: kids, collapsed: ui.collapsed.includes(kidsKey(s.id)), holdsFocus: ui.collapsed.includes(kidsKey(s.id)) && kids.some((k) => k.id === ui.focusedSessionId), onToggle: () => toggleCollapsed(kidsKey(s.id)) }}
      />
    )
  }

  const projectHeader = (p: Project, count: number, g: ListGroup) => (
    <ProjectHeader project={p} tag={tags.project(p.id)} count={count} refused={refused === p.id}
      onToggle={() => toggleCollapsed(g.key)} onRemove={() => void removeProject(p.id)} onNew={() => onNew(p.id)} />
  )

  // a project's heading when there is a project; a status or plain one when there isn't
  const groupHeading = (g: ListGroup) =>
    g.project ? projectHeader(g.project, groupSize(g), g)
      : <GroupHeading group={g} onToggle={() => toggleCollapsed(g.key)} />

  // One group: its heading, then its rows. A worktree's sessions sit among the repo's own (ADR 0037).
  const groupBlock = (g: ListGroup) => (
    <div key={g.key} className={css.project}>
      {groupHeading(g)}
      {!g.collapsed && cardList(g)}
    </div>
  )

  const projectRow = (p: Project) => (
    <ProjectRow key={p.id} project={p} tag={tags.project(p.id)}
      live={sessions.filter((x) => x.projectId === p.id && x.lastStatus === 'running').length}
      waiting={sessions.filter((x) => x.projectId === p.id && shownStatus(x) === 'waiting').length}
      focused={ui.focusedProject === p.id} refused={refused === p.id}
      onOpen={() => openProject(p.id)} onRemove={() => void removeProject(p.id)} onNew={() => onNew(p.id)} />
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
          ? groups.map(groupBlock)
          // the Projects tab lists repos only; a worktree is reached through its sessions
          : repoGroups(projects).map(({ project }) => projectRow(project))}
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
            aria-pressed={hidden.length > 0 || !!ui.hideDone}
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
            className={hidden.length > 0 || ui.hideDone ? css.visibilityActive : ''} />
          {optionsOpen && (
            <div ref={panelRef} className={css.visibilityPopover} role="menu" aria-label="Session list options"
              onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setOptionsOpen(false) } }}>
              <div className={css.visibilitySections}>
                <OptionSection headingId={sidebarId} label="Sidebar options">
                  <div className={css.visibilityList}>
                    {rows.map(({ project, sessions: total }) => {
                      const shown = !hidden.includes(project.id)
                      return (
                        <button key={project.id} type="button" role="menuitemcheckbox" aria-checked={shown}
                          className={shown ? css.visibilityItem : css.visibilityItemOff}
                          onClick={() => toggleProjectVisibility(project.id)}>
                          <Icon name="folder" size={13} className={tagClass(tags.project(project.id), 'fg')} />
                          <span className={css.visibilityName}>{project.name}</span>
                          {total > 0 && <span className={css.visibilityCount}>{total}</span>}
                          <span className={css.visibilityCheck}>{shown && <Icon name="check" size={13} />}</span>
                        </button>
                      )
                    })}
                  </div>
                  <div className={css.visibilityFooter}>
                    <button type="button" className={css.visibilityAction} disabled={hidden.length === 0}
                      onClick={() => void window.api.invoke('ui:set', { hiddenProjects: [] })}>Show all</button>
                    <button type="button" className={css.visibilityAction} disabled={rows.every((r) => hidden.includes(r.project.id))}
                      onClick={() => void window.api.invoke('ui:set', { hiddenProjects: rows.map((r) => r.project.id) })}>Hide all</button>
                  </div>
                </OptionSection>
                <OptionSection headingId={statusId} label="Workflow status">
                  <button type="button" role="menuitemcheckbox" aria-checked={!ui.hideDone}
                    className={ui.hideDone ? css.visibilityItemOff : css.visibilityItem} onClick={toggleHideDone}>
                    <span className={css.visibilityName}>Show done sessions</span>
                    <span className={css.visibilityCheck}>{!ui.hideDone && <Icon name="check" size={13} />}</span>
                  </button>
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
          items={[
            ...(noteTarget ? [{ label: 'Note', icon: 'note' as const, onSelect: () => onNote(noteTarget) }] : []),
            // a session that leads a group cannot become a child (groups are one level deep)
            ...(noteTarget && !hasChildren(sessions, noteTarget.id) && sessions.some((x) => canParent(sessions, noteTarget.id, x))
              ? [{ label: 'Set parent…', icon: 'link' as const, onSelect: () => setParenting(noteTarget) }] : []),
            ...(noteTarget?.parentId ? [{ label: 'Clear parent', icon: 'minus' as const, onSelect: () => void window.api.invoke('session:setParent', { id: noteTarget.id, parent: null }) }] : []),
            { label: menu.ids.length === 1 ? 'Remove session' : `Remove ${menu.ids.length} sessions`, icon: 'trash' as const, danger: true, onSelect: () => removeSessions(menu.ids) },
          ]} />
      )}
      {linking && <LinkPicker session={linking} onClose={() => setLinking(null)} />}
      {parenting && <ParentPicker session={parenting} onClose={() => setParenting(null)} />}
    </div>
  )
}
