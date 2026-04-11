import { create } from "zustand";

interface AgentsState {
  hungCount: number;
  runningCount: number;
  agentFilter: string;
  setHungCount: (count: number) => void;
  setRunningCount: (count: number) => void;
  setAgentFilter: (filter: string) => void;
}

export const useAgentsStore = create<AgentsState>()((set) => ({
  hungCount: 0,
  runningCount: 0,
  agentFilter: "ALL",
  setHungCount: (count: number) => set({ hungCount: count }),
  setRunningCount: (count: number) => set({ runningCount: count }),
  setAgentFilter: (filter: string) => set({ agentFilter: filter }),
}));
