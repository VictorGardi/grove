import { create } from "zustand";

interface ShortcutsModalState {
  open: boolean;
  openModal: () => void;
  closeModal: () => void;
  toggleModal: () => void;
}

export const useShortcutsModalStore = create<ShortcutsModalState>()((set) => ({
  open: false,
  openModal: () => set({ open: true }),
  closeModal: () => set({ open: false }),
  toggleModal: () => set((s) => ({ open: !s.open })),
}));
