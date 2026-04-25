import { useState, useEffect, useCallback } from "react";
import { usePlanStore } from "../../stores/usePlanStore";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import type { PlanAgent } from "@shared/types";
import styles from "./Settings.module.css";

interface AgentModelFormProps {
  workspacePath: string;
  isDisabled: boolean;
}

export function AgentModelForm({
  workspacePath,
  isDisabled,
}: AgentModelFormProps): React.JSX.Element {
  const [planningAgent, setPlanningAgent] = useState<PlanAgent>("opencode");
  const [planningModel, setPlanningModel] = useState<string>("");
  const [executionAgent, setExecutionAgent] = useState<PlanAgent>("opencode");
  const [executionModel, setExecutionModel] = useState<string>("");

  const ensureModels = usePlanStore((s) => s.ensureModels);
  const clearModelsCache = usePlanStore((s) => s.clearModelsCache);
  const planningModelsCacheEntry = usePlanStore(
    (s) => s.modelsCache[`${workspacePath}:${planningAgent}`],
  );
  const executionModelsCacheEntry = usePlanStore(
    (s) => s.modelsCache[`${workspacePath}:${executionAgent}`],
  );

  // Derive loading state and model list directly from cache — no redundant
  // local state that can race with cache updates.
  // undefined = not yet fetched (treat as loading); null = in-flight; array = done
  const planningModelsLoading = !Array.isArray(planningModelsCacheEntry);
  const planningModels = Array.isArray(planningModelsCacheEntry)
    ? planningModelsCacheEntry
    : [];
  const executionModelsLoading = !Array.isArray(executionModelsCacheEntry);
  const executionModels = Array.isArray(executionModelsCacheEntry)
    ? executionModelsCacheEntry
    : [];

  const fetchDefaults = useWorkspaceStore((s) => s.fetchDefaults);
  const updateDefaults = useWorkspaceStore((s) => s.updateDefaults);
  const workspaceDefaults = useWorkspaceStore((s) => s.workspaceDefaults);

  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (workspacePath) {
      void ensureModels(workspacePath, planningAgent);
      void ensureModels(workspacePath, executionAgent);
    }
  }, [workspacePath, planningAgent, executionAgent, ensureModels]);

  useEffect(() => {
    if (!workspacePath) {
      setInitialized(false);
      return;
    }

    // Reset so the defaults effect re-runs with fresh data when workspacePath changes.
    setInitialized(false);
    fetchDefaults(workspacePath).then(
      () => setInitialized(true),
      () => setInitialized(true), // don't leave the form permanently non-initialized on error
    );
  }, [workspacePath, fetchDefaults]);

  useEffect(() => {
    if (!workspacePath || !initialized) return;

    const defaults = workspaceDefaults[workspacePath];
    const pa = defaults?.defaultPlanningAgent ?? "opencode";
    const ea = defaults?.defaultExecutionAgent ?? "opencode";

    setPlanningAgent(pa);
    setExecutionAgent(ea);
    setPlanningModel(defaults?.defaultPlanningModel ?? "");
    setExecutionModel(defaults?.defaultExecutionModel ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath, initialized]);

  const handleRefreshModels = useCallback(
    (type: "planning" | "execution") => {
      if (!workspacePath) return;
      const agent = type === "planning" ? planningAgent : executionAgent;
      clearModelsCache(workspacePath, agent);
      void ensureModels(workspacePath, agent);
    },
    [workspacePath, planningAgent, executionAgent, clearModelsCache, ensureModels],
  );

  const handleAgentChange = async (
    type: "planning" | "execution",
    agent: PlanAgent,
  ): Promise<void> => {
    if (!workspacePath) return;

    if (type === "planning") {
      setPlanningAgent(agent);
      setPlanningModel("");
      void ensureModels(workspacePath, agent);
      await updateDefaults(workspacePath, {
        defaultPlanningAgent: agent,
        defaultPlanningModel: undefined,
        defaultExecutionAgent: executionAgent,
        defaultExecutionModel: executionModel || undefined,
      });
    } else {
      setExecutionAgent(agent);
      setExecutionModel("");
      void ensureModels(workspacePath, agent);
      await updateDefaults(workspacePath, {
        defaultPlanningAgent: planningAgent,
        defaultPlanningModel: planningModel || undefined,
        defaultExecutionAgent: agent,
        defaultExecutionModel: undefined,
      });
    }
  };

  const handlePlanningModelChange = async (model: string): Promise<void> => {
    if (!workspacePath) return;
    setPlanningModel(model);
    await updateDefaults(workspacePath, {
      defaultPlanningAgent: planningAgent,
      defaultPlanningModel: model || undefined,
      defaultExecutionAgent: executionAgent,
      defaultExecutionModel: executionModel || undefined,
    });
  };

  const handleExecutionModelChange = async (model: string): Promise<void> => {
    if (!workspacePath) return;
    setExecutionModel(model);
    await updateDefaults(workspacePath, {
      defaultPlanningAgent: planningAgent,
      defaultPlanningModel: planningModel || undefined,
      defaultExecutionAgent: executionAgent,
      defaultExecutionModel: model || undefined,
    });
  };

  const disabled = isDisabled || !workspacePath;

  return (
    <>
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
            <option value="claude">claude</option>
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
          <button
            className={styles.resetBtn}
            onClick={() => handleRefreshModels("planning")}
            disabled={disabled || planningModelsLoading}
            title="Refresh model list"
          >
            Refresh
          </button>
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
            <option value="claude">claude</option>
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
          <button
            className={styles.resetBtn}
            onClick={() => handleRefreshModels("execution")}
            disabled={disabled || executionModelsLoading}
            title="Refresh model list"
          >
            Refresh
          </button>
        </div>
      </div>
    </>
  );
}
