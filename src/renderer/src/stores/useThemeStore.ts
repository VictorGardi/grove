import { create } from "zustand";
import {
  applyTheme,
  getStoredTheme,
  THEME_COLORS,
  type ThemeColors,
  type ThemeName,
} from "../styles/loadTheme";

interface ThemeState {
  theme: ThemeName;
  colors: ThemeColors;
  setTheme: (theme: ThemeName) => void;
}

export const useThemeStore = create<ThemeState>()((set) => {
  const initial = getStoredTheme();
  return {
    theme: initial,
    colors: THEME_COLORS[initial],
    setTheme: async (theme: ThemeName) => {
      applyTheme(theme);
      try {
        const result = await window.api.app.setTheme(theme);
        if (!result.ok) {
          console.warn(
            "[useThemeStore] Failed to persist theme to config:",
            result.error,
          );
        }
      } catch (err) {
        console.warn("[useThemeStore] Failed to persist theme to config:", err);
      }
      set({ theme, colors: THEME_COLORS[theme] });
    },
  };
});
