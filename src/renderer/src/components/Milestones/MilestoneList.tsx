import { useMemo, useState } from "react";
import { useDataStore } from "../../stores/useDataStore";
import { createMilestone } from "../../actions/milestoneActions";
import { MilestoneRow } from "./MilestoneRow";
import styles from "./MilestoneList.module.css";

type StatusFilter = "all" | "open" | "closed";

export function MilestoneList(): React.JSX.Element {
  const milestones = useDataStore((s) => s.milestones);
  const selectedId = useDataStore((s) => s.selectedMilestoneId);
  const setSelected = useDataStore((s) => s.setSelectedMilestone);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Sort: open first, then closed. Within group, newest first.
  const sorted = useMemo(() => {
    let list = milestones;
    if (statusFilter !== "all") {
      list = milestones.filter((m) => m.status === statusFilter);
    }
    return [...list].sort((a, b) => {
      if (a.status !== b.status) return a.status === "open" ? -1 : 1;
      return (b.created || "").localeCompare(a.created || "");
    });
  }, [milestones, statusFilter]);

  function handleNewMilestone(): void {
    createMilestone("New milestone");
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>Milestones</h2>
        <button className={styles.newBtn} onClick={handleNewMilestone}>
          + New
        </button>
      </div>
      <div className={styles.filterBar}>
        <select
          className={styles.filterSelect}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
        >
          <option value="all">All</option>
          <option value="open">Open only</option>
          <option value="closed">Closed only</option>
        </select>
      </div>
      <div className={styles.list}>
        {sorted.map((m) => (
          <MilestoneRow
            key={m.id}
            milestone={m}
            isSelected={m.id === selectedId}
            onClick={() => setSelected(m.id === selectedId ? null : m.id)}
          />
        ))}
        {sorted.length === 0 && (
          <div className={styles.empty}>
            <div className={styles.emptyTitle}>No milestones yet</div>
            <div className={styles.emptyHint}>
              Create a milestone to group related tasks
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
