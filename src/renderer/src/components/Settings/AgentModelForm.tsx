import { useState, useEffect } from "react";
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

  const [planningModels, setPlanningModels] = useState<string[]>([]);
  const [executionModels, setExecutionModels] = useState<string[]>([]);
  const [planningModelsLoading, setPlanningModelsLoading] = useState(false);
  const [executionModelsLoading, setExecutionModelsLoading] = useState(false);

  const ensureModels = usePlanStore((s) => s.ensureModels);
  const planningModelsCacheEntry = usePlanStore(
    (s) => s.modelsCache[`${workspacePath}:${planningAgent}`],
  );
  const executionModelsCacheEntry = usePlanStore(
    (s) => s.modelsCache[`${workspacePath}:${executionAgent}`],
  );

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
    if (Array.isArray(planningModelsCacheEntry)) {
      setPlanningModels(planningModelsCacheEntry);
      setPlanningModelsLoading(false);
    } else if (planningModelsCacheEntry === null) {
      setPlanningModelsLoading(true);
    }
  }, [planningModelsCacheEntry]);

  useEffect(() => {
    setPlanningModels([]);
    setPlanningModelsLoading(true);
  }, [planningAgent]);

  useEffect(() => {
    setExecutionModels([]);
    setExecutionModelsLoading(true);
  }, [executionAgent]);

  useEffect(() => {
    if (Array.isArray(executionModelsCacheEntry)) {
      setExecutionModels(executionModelsCacheEntry);
      setExecutionModelsLoading(false);
    } else if (executionModelsCacheEntry === null) {
      setExecutionModelsLoading(true);
    }
  }, [executionModelsCacheEntry]);

  useEffect(() => {
    if (!workspacePath) {
      setInitialized(false);
      return;
    }

    fetchDefaults(workspacePath).then(() => setInitialized(true));
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
        </div>
      </div>
    </>
  );
}
