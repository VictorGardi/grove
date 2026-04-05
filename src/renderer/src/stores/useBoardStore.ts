import { create } from "zustand";

interface BoardState {
  /** Current search query string */
  searchQuery: string;
  /** Whether the search input is active/visible */
  searchActive: boolean;
  /** Counter incremented to request search input focus */
  searchFocusCounter: number;

  setSearchQuery: (query: string) => void;
  setSearchActive: (active: boolean) => void;
  requestSearchFocus: () => void;
  clearSearch: () => void;
}

export const useBoardStore = create<BoardState>()((set) => ({
  searchQuery: "",
  searchActive: false,
  searchFocusCounter: 0,

  setSearchQuery: (query: string) => set({ searchQuery: query }),
  setSearchActive: (active: boolean) => set({ searchActive: active }),
  requestSearchFocus: () =>
    set((s) => ({
      searchFocusCounter: s.searchFocusCounter + 1,
      searchActive: true,
    })),
  clearSearch: () => set({ searchQuery: "", searchActive: false }),
}));
