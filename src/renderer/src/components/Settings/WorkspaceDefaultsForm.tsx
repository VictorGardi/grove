import { useState, useEffect, useRef } from "react";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import { usePlanStore } from "../../stores/usePlanStore";
import type { PlanAgent } from "@shared/types";
import styles from "./Settings.module.css";

interface WorkspaceDefaultsFormProps {
  isDisabled?: boolean;
}

export function WorkspaceDefaultsForm({
  isDisabled = false,
}: WorkspaceDefaultsFormProps): React.JSX.Element {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const workspaceDefaults = useWorkspaceStore((s) => s.workspaceDefaults);
  const fetchDefaults = useWorkspaceStore((s) => s.fetchDefaults);
  const updateDefaults = useWorkspaceStore((s) => s.updateDefaults);

  const [selectedPath, setSelectedPath] = useState<string>("");
  const [planningAgent, setPlanningAgent] = useState<PlanAgent>("opencode");
  const [planningModel, setPlanningModel] = useState<string>("");
  const [executionAgent, setExecutionAgent] = useState<PlanAgent>("opencode");
  const [executionModel, setExecutionModel] = useState<string>("");

  const [planningModels, setPlanningModels] = useState<string[]>([]);
  const [executionModels, setExecutionModels] = useState<string[]>([]);
  const [planningModelsLoading, setPlanningModelsLoading] = useState(false);
  const [executionModelsLoading, setExecutionModelsLoading] = useState(false);

  const [warning, setWarning] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  const ensureModels = usePlanStore((s) => s.ensureModels);
  const planningModelsCacheEntry = usePlanStore(
    (s) => s.modelsCache[`${selectedPath}:${planningAgent}`],
  );
  const executionModelsCacheEntry = usePlanStore(
    (s) => s.modelsCache[`${selectedPath}:${executionAgent}`],
  );

  // Keep a ref so the sync effect can read the current defaults without
  // having workspaceDefaults as a dependency (which would re-trigger the
  // effect on every save and cause an infinite loop).
  const workspaceDefaultsRef = useRef(workspaceDefaults);
  workspaceDefaultsRef.current = workspaceDefaults;

  // Ensure models are cached when workspace/agent changes
  useEffect(() => {
    if (selectedPath && initialized) {
      void ensureModels(selectedPath, planningAgent);
      void ensureModels(selectedPath, executionAgent);
    }
  }, [selectedPath, planningAgent, executionAgent, initialized, ensureModels]);

  // Sync planning models from cache
  useEffect(() => {
    if (Array.isArray(planningModelsCacheEntry)) {
      setPlanningModels(planningModelsCacheEntry);
      setPlanningModelsLoading(false);
    } else if (planningModelsCacheEntry === null) {
      setPlanningModelsLoading(true);
    }
  }, [planningModelsCacheEntry]);

  // Sync execution models from cache
  useEffect(() => {
    if (Array.isArray(executionModelsCacheEntry)) {
      setExecutionModels(executionModelsCacheEntry);
      setExecutionModelsLoading(false);
    } else if (executionModelsCacheEntry === null) {
      setExecutionModelsLoading(true);
    }
  }, [executionModelsCacheEntry]);

  // Effect 1: validate workspace and fetch defaults when selection changes.
  useEffect(() => {
    if (!selectedPath) {
      setWarning(null);
      setInitialized(false);
      return;
    }

    const ws = workspaces.find((w) => w.path === selectedPath);
    if (!ws) {
      setWarning("Workspace not found in config. It may have been removed.");
      setPlanningAgent("opencode");
      setPlanningModel("");
      setExecutionAgent("opencode");
      setExecutionModel("");
      setPlanningModels([]);
      setExecutionModels([]);
      setInitialized(false);
      return;
    }

    setWarning(null);
    fetchDefaults(selectedPath).then(() => setInitialized(true));
  }, [selectedPath, workspaces, fetchDefaults]);

  // Effect 2: sync local state from store once the workspace is initialized.
  // workspaceDefaults is intentionally NOT a dependency here — including it
  // would cause a save loop: updateDefaults → workspaceDefaults changes →
  // this effect fires → setState → save handler → updateDefaults → repeat.
  useEffect(() => {
    if (!selectedPath || !initialized) return;

    const defaults = workspaceDefaultsRef.current[selectedPath];
    const pa = defaults?.defaultPlanningAgent ?? "opencode";
    const ea = defaults?.defaultExecutionAgent ?? "opencode";

    setPlanningAgent(pa);
    setExecutionAgent(ea);
    setPlanningModel(defaults?.defaultPlanningModel ?? "");
    setExecutionModel(defaults?.defaultExecutionModel ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPath, initialized]); // workspaceDefaults intentionally excluded

  // Save directly in handlers using the new value rather than relying on a
  // useEffect that watches state — that pattern races against React batching
  // and re-creates the loop described above.
  const handleAgentChange = async (
    type: "planning" | "execution",
    agent: PlanAgent,
  ) => {
    if (!selectedPath) return;

    if (type === "planning") {
      setPlanningAgent(agent);
      setPlanningModel("");
      void ensureModels(selectedPath, agent);
      await updateDefaults(selectedPath, {
        defaultPlanningAgent: agent,
        defaultPlanningModel: undefined,
        defaultExecutionAgent: executionAgent,
        defaultExecutionModel: executionModel || undefined,
      });
    } else {
      setExecutionAgent(agent);
      setExecutionModel("");
      void ensureModels(selectedPath, agent);
      await updateDefaults(selectedPath, {
        defaultPlanningAgent: planningAgent,
        defaultPlanningModel: planningModel || undefined,
        defaultExecutionAgent: agent,
        defaultExecutionModel: undefined,
      });
    }
  };

  const handlePlanningModelChange = async (model: string) => {
    if (!selectedPath) return;
    setPlanningModel(model);
    await updateDefaults(selectedPath, {
      defaultPlanningAgent: planningAgent,
      defaultPlanningModel: model || undefined,
      defaultExecutionAgent: executionAgent,
      defaultExecutionModel: executionModel || undefined,
    });
  };

  const handleExecutionModelChange = async (model: string) => {
    if (!selectedPath) return;
    setExecutionModel(model);
    await updateDefaults(selectedPath, {
      defaultPlanningAgent: planningAgent,
      defaultPlanningModel: planningModel || undefined,
      defaultExecutionAgent: executionAgent,
      defaultExecutionModel: model || undefined,
    });
  };

  const disabled = isDisabled || !selectedPath;

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Workspace Defaults</h2>
      <p className={styles.sectionDesc}>
        Configure default agent and model for each workspace. These will be used
        when starting a new planning or execution session.
      </p>

      <select
        className={styles.workspaceSelect}
        value={selectedPath}
        onChange={(e) => setSelectedPath(e.target.value)}
        disabled={isDisabled}
      >
        <option value="">Select workspace...</option>
        {workspaces.map((ws) => (
          <option key={ws.path} value={ws.path}>
            {ws.name}
          </option>
        ))}
      </select>

      {warning && <div className={styles.warning}>{warning}</div>}

      <div className={styles.defaultsGroup}>
        <h3 className={styles.defaultsGroupTitle}>Planning Defaults</h3>

        <div className={styles.defaultsRow}>
          <span className={styles.defaultsLabel}>Agent</span>
          <select
            className={styles.defaultsSelect}
            value={planningAgent}
            onChange={(e) =>
              handleAgentChange("planning", e.target.value as PlanAgent)
            }
            disabled={disabled}
          >
            <option value="opencode">opencode</option>
            <option value="copilot">copilot</option>
          </select>
        </div>

        <div className={styles.defaultsRow}>
          <span className={styles.defaultsLabel}>Model</span>
          <select
            className={styles.defaultsSelect}
            value={planningModel}
            onChange={(e) => handlePlanningModelChange(e.target.value)}
            disabled={disabled || planningModelsLoading}
          >
            <option value="">Default</option>
            {planningModelsLoading && (
              <option value="" disabled>
                Loading...
              </option>
            )}
            {planningModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={styles.defaultsGroup}>
        <h3 className={styles.defaultsGroupTitle}>Execution Defaults</h3>

        <div className={styles.defaultsRow}>
          <span className={styles.defaultsLabel}>Agent</span>
          <select
            className={styles.defaultsSelect}
            value={executionAgent}
            onChange={(e) =>
              handleAgentChange("execution", e.target.value as PlanAgent)
            }
            disabled={disabled}
          >
            <option value="opencode">opencode</option>
            <option value="copilot">copilot</option>
          </select>
        </div>

        <div className={styles.defaultsRow}>
          <span className={styles.defaultsLabel}>Model</span>
          <select
            className={styles.defaultsSelect}
            value={executionModel}
            onChange={(e) => handleExecutionModelChange(e.target.value)}
            disabled={disabled || executionModelsLoading}
          >
            <option value="">Default</option>
            {executionModelsLoading && (
              <option value="" disabled>
                Loading...
              </option>
            )}
            {executionModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>
    </section>
  );
}
