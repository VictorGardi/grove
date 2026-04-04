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
    setTheme: (theme: ThemeName) => {
      applyTheme(theme);
      set({ theme, colors: THEME_COLORS[theme] });
    },
  };
});
