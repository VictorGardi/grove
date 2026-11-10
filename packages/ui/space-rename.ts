export function bindSpaceRename(list: HTMLElement, rename: (spaceId: string) => void): void {
  list.addEventListener('click', (event) => {
    if (event.detail !== 2 || !(event.target instanceof Element)) return
    const name = event.target.closest('.space-name')
    const button = name?.closest<HTMLButtonElement>('.space')
    const spaceId = button?.dataset.spaceId
    if (!spaceId) return
    event.preventDefault()
    rename(spaceId)
  })
}
