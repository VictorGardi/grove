type NavigationListener = (isInPlace: boolean, isMainFrame: boolean) => void

export function installAttachCleanup(
  subscribe: (listener: NavigationListener) => void,
  killAttaches: () => void,
): void {
  subscribe((isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) killAttaches()
  })
}
