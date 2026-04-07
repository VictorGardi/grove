import { useState, useEffect, useRef } from "react";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import styles from "./Settings.module.css";
import { WorkspaceCardGrid } from "./WorkspaceCardGrid";
import { AgentModelForm } from "./AgentModelForm";
import { WorkspacePromptsForm } from "./WorkspacePromptsForm";

interface WorkspaceDefaultsFormProps {
  isDisabled?: boolean;
}

export function WorkspaceDefaultsForm({
  isDisabled = false,
}: WorkspaceDefaultsFormProps): React.JSX.Element {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspacePath = useWorkspaceStore((s) => s.activeWorkspacePath);
  const workspaceDefaults = useWorkspaceStore((s) => s.workspaceDefaults);

  const [selectedPath, setSelectedPath] = useState<string>("");
  const [warning, setWarning] = useState<string | null>(null);

  const workspaceDefaultsRef = useRef(workspaceDefaults);

  useEffect(() => {
    workspaceDefaultsRef.current = workspaceDefaults;
  }, [workspaceDefaults]);

  // Initialize selectedPath from active workspace on mount
  useEffect(() => {
    if (activeWorkspacePath && workspaces.length > 0) {
      const ws = workspaces.find((w) => w.path === activeWorkspacePath);
      if (ws) {
        setSelectedPath(activeWorkspacePath); // eslint-disable-line react-hooks/set-state-in-effect
      } else {
        setSelectedPath(workspaces[0]?.path ?? ""); // eslint-disable-line react-hooks/set-state-in-effect
      }
    } else if (workspaces.length > 0) {
      setSelectedPath(workspaces[0].path); // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [activeWorkspacePath, workspaces]);

  // Handle stale selection: if selected workspace is removed, reset
  useEffect(() => {
    if (selectedPath && !workspaces.find((w) => w.path === selectedPath)) {
      setSelectedPath(workspaces[0]?.path ?? ""); // eslint-disable-line react-hooks/set-state-in-effect
      setWarning(null); // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [workspaces, selectedPath]);

  // Validate workspace when selection changes
  useEffect(() => {
    if (!selectedPath) {
      setWarning(null); // eslint-disable-line react-hooks/set-state-in-effect
      return;
    }

    const ws = workspaces.find((w) => w.path === selectedPath);
    if (!ws) {
      setWarning("Workspace not found in config. It may have been removed."); // eslint-disable-line react-hooks/set-state-in-effect
      return;
    }

    if (!ws.exists) {
      setWarning("This workspace no longer exists on disk."); // eslint-disable-line react-hooks/set-state-in-effect
    } else {
      setWarning(null); // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, [selectedPath, workspaces]);

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Workspace Defaults</h2>
      <p className={styles.sectionDesc}>
        Configure default agent and model for each workspace. These will be used
        when starting a new planning or execution session.
      </p>

      <WorkspaceCardGrid
        selectedPath={selectedPath}
        onSelect={setSelectedPath}
      />

      {warning && <div className={styles.warning}>{warning}</div>}

      {selectedPath && (
        <>
          <AgentModelForm
            workspacePath={selectedPath}
            isDisabled={isDisabled}
          />
          <WorkspacePromptsForm
            workspacePath={selectedPath}
            isDisabled={isDisabled}
          />
        </>
      )}
    </section>
  );
}
