import { create } from "zustand";

interface SearchState {
  /** Current search query string */
  searchQuery: string;
  /** Whether the search input is active/visible */
  searchActive: boolean;
  /** Counter incremented to request search input focus */
  searchFocusCounter: number;
  /** Focused task ID for keyboard navigation (separate from selectedTaskId) */
  focusedTaskId: string | null;

  setSearchQuery: (query: string) => void;
  setSearchActive: (active: boolean) => void;
  requestSearchFocus: () => void;
  clearSearch: () => void;
  setFocusedTask: (id: string | null) => void;
  clearFocusedTask: () => void;
}

export const useBoardStore = create<SearchState>()((set) => ({
  searchQuery: "",
  searchActive: false,
  searchFocusCounter: 0,
  focusedTaskId: null,

  setSearchQuery: (query: string) => set({ searchQuery: query }),
  setSearchActive: (active: boolean) => set({ searchActive: active }),
  requestSearchFocus: () =>
    set((s) => ({
      searchFocusCounter: s.searchFocusCounter + 1,
      searchActive: true,
    })),
  clearSearch: () =>
    set({ searchQuery: "", searchActive: false, focusedTaskId: null }),
  setFocusedTask: (id: string | null) => set({ focusedTaskId: id }),
  clearFocusedTask: () => set({ focusedTaskId: null }),
}));
