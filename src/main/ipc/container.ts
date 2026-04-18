import { ipcMain } from "electron";
import type { ContainerServiceConfig } from "@shared/types";
import {
  getContainerService,
  initializeContainerService,
  DevcontainerManager,
} from "../../runtime/containerService";

const devcontainerManager = new DevcontainerManager();

let configRef: {
  getWorkspaceConfig: (path: string) => {
    containerEnabled?: boolean;
    containerRuntime?: string;
    containerDefaultImage?: string;
  } | null;
} | null = null;

export function setContainerConfigGetter(getter: typeof configRef): void {
  configRef = getter;
}

export function registerContainerHandlers(): void {
  ipcMain.handle(
    "container:initialize",
    async (_event, workspacePath: string) => {
      try {
        const wsConfig = configRef?.getWorkspaceConfig?.(workspacePath) ?? null;
        const config: ContainerServiceConfig = {
          enabled: wsConfig?.containerEnabled ?? false,
          runtime:
            (wsConfig?.containerRuntime as ContainerServiceConfig["runtime"]) ??
            "docker",
          defaultImage: wsConfig?.containerDefaultImage ?? "ubuntu:22.04",
          autoCleanup: true,
        };
        const ok = await initializeContainerService(config);
        return {
          ok,
          error: ok ? undefined : "Container runtime not available",
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    "container:isEnabled",
    async (_event, _workspacePath: string) => {
      try {
        const service = getContainerService();
        const isEnabled = service.isEnabled();
        return { ok: true, data: isEnabled };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle(
    "container:start",
    async (_event, params: { taskId: string; workspacePath: string }) => {
      try {
        const { taskId, workspacePath } = params;
        const service = getContainerService();

        const wsConfig = configRef?.getWorkspaceConfig?.(workspacePath) ?? null;
        const isContainerMode = wsConfig?.containerEnabled ?? false;

        if (!isContainerMode) {
          return {
            ok: true,
            data: { usedContainer: false, workspacePath },
          };
        }

        const devcontainerConfigRaw =
          await devcontainerManager.parseDevcontainer(workspacePath);

        const result = await service.startContainer({
          taskId,
          workspacePath,
          image: devcontainerConfigRaw?.image,
          devcontainerConfig: devcontainerConfigRaw ?? undefined,
          mountWorkspace: true,
        });

        if (!result.ok) {
          return { ok: false, error: result.error };
        }

        return {
          ok: true,
          data: {
            usedContainer: true,
            workspacePath: result.environment.workspacePath,
            containerName: result.environment.containerName,
            containerId: result.environment.containerId,
          },
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle("container:stop", async (_event, taskId: string) => {
    try {
      const service = getContainerService();
      await service.stopContainer(taskId);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle(
    "container:parseDevcontainer",
    async (_event, workspacePath: string) => {
      try {
        const config =
          await devcontainerManager.parseDevcontainer(workspacePath);
        return { ok: true, data: config };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );
}
