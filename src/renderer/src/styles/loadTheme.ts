/**
 * Theme loader — all theme data and switching logic lives here.
 * CSS variables are applied by toggling `data-theme` on <html>.
 */

export const THEMES = [
  "default",
  "catppuccin-mocha",
  "catppuccin-latte",
] as const;
export type ThemeName = (typeof THEMES)[number];

export const THEME_LABELS: Record<ThemeName, string> = {
  default: "Default (Dark)",
  "catppuccin-mocha": "Catppuccin Mocha",
  "catppuccin-latte": "Catppuccin Latte",
};

/** Colors exposed to JS consumers (terminal, IPC, etc.) */
export interface ThemeColors {
  bgBase: string;
  bgSurface: string;
  accent: string;
  textPrimary: string;
  textSecondary: string;
  textLo: string;
  border: string;
  /** xterm.js 16-color ANSI palette */
  xterm: {
    background: string;
    foreground: string;
    cursor: string;
    cursorAccent: string;
    selectionBackground: string;
    selectionForeground: string;
    black: string;
    red: string;
    green: string;
    yellow: string;
    blue: string;
    magenta: string;
    cyan: string;
    white: string;
    brightBlack: string;
    brightRed: string;
    brightGreen: string;
    brightYellow: string;
    brightBlue: string;
    brightMagenta: string;
    brightCyan: string;
    brightWhite: string;
  };
  /** Name of the Shiki theme to use for syntax highlighting */
  shikiTheme: string;
  /** Windows titlebar overlay bg color */
  titleBarColor: string;
  /** Windows titlebar overlay symbol color */
  titleBarSymbolColor: string;
}

export const THEME_COLORS: Record<ThemeName, ThemeColors> = {
  default: {
    bgBase: "#0b0b0d",
    bgSurface: "#101012",
    accent: "#7b68ee",
    textPrimary: "#e2e2e6",
    textSecondary: "#8b8b96",
    textLo: "#44444e",
    border: "#242430",
    xterm: {
      background: "#0b0b0d",
      foreground: "#e2e2e6",
      cursor: "#7b68ee",
      cursorAccent: "#0b0b0d",
      selectionBackground: "rgba(123, 104, 238, 0.3)",
      selectionForeground: "#e2e2e6",
      black: "#0b0b0d",
      red: "#e05c5c",
      green: "#3ecf8e",
      yellow: "#e8a44a",
      blue: "#5ba3f5",
      magenta: "#7b68ee",
      cyan: "#56d4dd",
      white: "#e2e2e6",
      brightBlack: "#44444e",
      brightRed: "#e05c5c",
      brightGreen: "#3ecf8e",
      brightYellow: "#e8a44a",
      brightBlue: "#5ba3f5",
      brightMagenta: "#7b68ee",
      brightCyan: "#56d4dd",
      brightWhite: "#ffffff",
    },
    shikiTheme: "grove-dark",
    titleBarColor: "#0b0b0d",
    titleBarSymbolColor: "#8b8b96",
  },

  "catppuccin-mocha": {
    bgBase: "#1e1e2e",
    bgSurface: "#181825",
    accent: "#cba6f7",
    textPrimary: "#cdd6f4",
    textSecondary: "#bac2de",
    textLo: "#6c7086",
    border: "#45475a",
    xterm: {
      background: "#1e1e2e",
      foreground: "#cdd6f4",
      cursor: "#cba6f7",
      cursorAccent: "#1e1e2e",
      selectionBackground: "rgba(203, 166, 247, 0.3)",
      selectionForeground: "#cdd6f4",
      black: "#45475a",
      red: "#f38ba8",
      green: "#a6e3a1",
      yellow: "#f9e2af",
      blue: "#89b4fa",
      magenta: "#cba6f7",
      cyan: "#89dceb",
      white: "#bac2de",
      brightBlack: "#585b70",
      brightRed: "#f38ba8",
      brightGreen: "#a6e3a1",
      brightYellow: "#f9e2af",
      brightBlue: "#89b4fa",
      brightMagenta: "#cba6f7",
      brightCyan: "#89dceb",
      brightWhite: "#a6adc8",
    },
    shikiTheme: "grove-catppuccin-mocha",
    titleBarColor: "#1e1e2e",
    titleBarSymbolColor: "#bac2de",
  },

  "catppuccin-latte": {
    bgBase: "#eff1f5",
    bgSurface: "#e6e9ef",
    accent: "#8839ef",
    textPrimary: "#4c4f69",
    textSecondary: "#6c6f85",
    textLo: "#9ca0b0",
    border: "#acb0be",
    xterm: {
      background: "#eff1f5",
      foreground: "#4c4f69",
      cursor: "#8839ef",
      cursorAccent: "#eff1f5",
      selectionBackground: "rgba(136, 57, 239, 0.2)",
      selectionForeground: "#4c4f69",
      black: "#5c5f77",
      red: "#d20f39",
      green: "#40a02b",
      yellow: "#df8e1d",
      blue: "#1e66f5",
      magenta: "#8839ef",
      cyan: "#04a5e5",
      white: "#acb0be",
      brightBlack: "#6c6f85",
      brightRed: "#d20f39",
      brightGreen: "#40a02b",
      brightYellow: "#df8e1d",
      brightBlue: "#1e66f5",
      brightMagenta: "#8839ef",
      brightCyan: "#04a5e5",
      brightWhite: "#bcc0cc",
    },
    shikiTheme: "grove-catppuccin-latte",
    titleBarColor: "#eff1f5",
    titleBarSymbolColor: "#6c6f85",
  },
};

const STORAGE_KEY = "grove:theme";

export function isValidTheme(value: string | null): value is ThemeName {
  return THEMES.includes(value as ThemeName);
}

export function getStoredTheme(): ThemeName {
  const saved = localStorage.getItem(STORAGE_KEY);
  return isValidTheme(saved) ? saved : "default";
}

/**
 * Apply a theme by setting data-theme on <html> and persisting to localStorage.
 * Does NOT update the Zustand store — call useThemeStore.setTheme() instead
 * when changing themes from React components.
 */
export function applyTheme(theme: ThemeName): void {
  if (theme === "default") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
  localStorage.setItem(STORAGE_KEY, theme);
}

/**
 * Load the persisted theme at startup (called from main.tsx before React mounts).
 */
export function loadTheme(): void {
  applyTheme(getStoredTheme());
}
