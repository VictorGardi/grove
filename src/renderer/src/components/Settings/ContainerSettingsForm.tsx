import { useState, useEffect } from "react";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import type { ContainerRuntime } from "../../../../shared/types";
import styles from "./Settings.module.css";

interface ContainerSettingsFormProps {
  workspacePath: string;
  isDisabled: boolean;
}

export function ContainerSettingsForm({
  workspacePath,
  isDisabled,
}: ContainerSettingsFormProps): React.JSX.Element {
  const [containerEnabled, setContainerEnabled] = useState(false);
  const [containerRuntime, setContainerRuntime] =
    useState<ContainerRuntime>("docker");
  const [containerDefaultImage, setContainerDefaultImage] =
    useState("ubuntu:22.04");
  const [loading, setLoading] = useState(true);

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const updateDefaults = useWorkspaceStore((s) => s.updateDefaults);

  useEffect(() => {
    const ws = workspaces.find((w) => w.path === workspacePath);
    if (ws) {
      setContainerEnabled(ws.containerEnabled ?? false);
      setContainerRuntime(
        (ws.containerRuntime as ContainerRuntime) ?? "docker",
      );
      setContainerDefaultImage(ws.containerDefaultImage ?? "ubuntu:22.04");
    }
    setLoading(false);
  }, [workspacePath, workspaces]);

  const handleEnabledChange = async (enabled: boolean) => {
    setContainerEnabled(enabled);
    await updateDefaults(workspacePath, {
      containerEnabled: enabled,
    } as Parameters<typeof updateDefaults>[1]);
  };

  const handleRuntimeChange = async (runtime: ContainerRuntime) => {
    setContainerRuntime(runtime);
    await updateDefaults(workspacePath, {
      containerRuntime: runtime,
    } as Parameters<typeof updateDefaults>[1]);
  };

  const handleImageChange = async (image: string) => {
    setContainerDefaultImage(image);
    await updateDefaults(workspacePath, {
      containerDefaultImage: image,
    } as Parameters<typeof updateDefaults>[1]);
  };

  if (loading) {
    return <div className={styles.loading}>Loading...</div>;
  }

  return (
    <div className={styles.containerFormGroup}>
      <h3 className={styles.containerFormTitle}>Container Runtime</h3>
      <p className={styles.containerFormDesc}>
        Configure containerized execution for this workspace. Tasks will run
        inside Docker/Podman containers with isolated environments.
      </p>

      <label className={styles.checkboxLabel}>
        <input
          type="checkbox"
          checked={containerEnabled}
          onChange={(e) => handleEnabledChange(e.target.checked)}
          disabled={isDisabled}
        />
        <span>Enable container mode</span>
      </label>

      {containerEnabled && (
        <>
          <label className={styles.selectLabel}>
            <span>Container Runtime</span>
            <select
              value={containerRuntime}
              onChange={(e) =>
                handleRuntimeChange(e.target.value as ContainerRuntime)
              }
              disabled={isDisabled}
            >
              <option value="docker">Docker</option>
              <option value="podman">Podman</option>
            </select>
          </label>

          <label className={styles.inputLabel}>
            <span>Default Image</span>
            <input
              type="text"
              value={containerDefaultImage}
              onChange={(e) => handleImageChange(e.target.value)}
              placeholder="ubuntu:22.04"
              disabled={isDisabled}
            />
          </label>
        </>
      )}
    </div>
  );
}
