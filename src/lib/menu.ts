// The right-click menu for servers: where it opens and which servers it acts on.
import { create } from 'zustand'

export interface MenuState {
  x: number
  y: number
  addrs: string[]
}

export const useMenu = create<{ menu: MenuState | null }>()(() => ({ menu: null }))

export function openMenu(e: React.MouseEvent, addrs: string[]) {
  e.preventDefault()
  e.stopPropagation()
  useMenu.setState({ menu: { x: e.clientX, y: e.clientY, addrs } })
}

export function closeMenu() {
  useMenu.setState({ menu: null })
}
