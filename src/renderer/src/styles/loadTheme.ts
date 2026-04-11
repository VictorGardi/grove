/**
 * Theme loader — all theme data and switching logic lives here.
 * CSS variables are applied by toggling `data-theme` on <html>.
 */

export const THEMES = [
  "catppuccin-mocha",
  "catppuccin-latte",
  "tokyo-night",
  "evergreen",
] as const;
export type ThemeName = (typeof THEMES)[number];

export const THEME_LABELS: Record<ThemeName, string> = {
  "catppuccin-mocha": "Catppuccin Mocha",
  "catppuccin-latte": "Catppuccin Latte",
  "tokyo-night": "Tokyo Night",
  evergreen: "Evergreen",
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

  "tokyo-night": {
    bgBase: "#1a1b26",
    bgSurface: "#16161e",
    accent: "#7aa2f7",
    textPrimary: "#c0caf5",
    textSecondary: "#a9b1d6",
    textLo: "#565f89",
    border: "#292e42",
    xterm: {
      background: "#1a1b26",
      foreground: "#c0caf5",
      cursor: "#7aa2f7",
      cursorAccent: "#1a1b26",
      selectionBackground: "rgba(122, 162, 247, 0.3)",
      selectionForeground: "#c0caf5",
      black: "#292e42",
      red: "#f7768e",
      green: "#9ece6a",
      yellow: "#e0af68",
      blue: "#7aa2f7",
      magenta: "#bb9af7",
      cyan: "#7dcfff",
      white: "#a9b1d6",
      brightBlack: "#414868",
      brightRed: "#f7768e",
      brightGreen: "#9ece6a",
      brightYellow: "#e0af68",
      brightBlue: "#7aa2f7",
      brightMagenta: "#bb9af7",
      brightCyan: "#7dcfff",
      brightWhite: "#c0caf5",
    },
    shikiTheme: "grove-tokyo-night",
    titleBarColor: "#1a1b26",
    titleBarSymbolColor: "#a9b1d6",
  },

  evergreen: {
    bgBase: "#2d353b",
    bgSurface: "#232a2e",
    accent: "#a7c080",
    textPrimary: "#d3c6aa",
    textSecondary: "#9da9a0",
    textLo: "#7a8478",
    border: "#343f44",
    xterm: {
      background: "#2d353b",
      foreground: "#d3c6aa",
      cursor: "#a7c080",
      cursorAccent: "#2d353b",
      selectionBackground: "rgba(167, 192, 128, 0.3)",
      selectionForeground: "#d3c6aa",
      black: "#343f44",
      red: "#e67e80",
      green: "#a7c080",
      yellow: "#dbbc7f",
      blue: "#7fbbb3",
      magenta: "#d699b6",
      cyan: "#83c092",
      white: "#9da9a0",
      brightBlack: "#475258",
      brightRed: "#e67e80",
      brightGreen: "#a7c080",
      brightYellow: "#dbbc7f",
      brightBlue: "#7fbbb3",
      brightMagenta: "#d699b6",
      brightCyan: "#83c092",
      brightWhite: "#d3c6aa",
    },
    shikiTheme: "grove-evergreen",
    titleBarColor: "#2d353b",
    titleBarSymbolColor: "#9da9a0",
  },
};

const STORAGE_KEY = "grove:theme";

export function isValidTheme(value: string | null): value is ThemeName {
  return THEMES.includes(value as ThemeName);
}

export function getStoredTheme(): ThemeName {
  const saved = localStorage.getItem(STORAGE_KEY);
  return isValidTheme(saved) ? saved : "catppuccin-mocha";
}

/**
 * Load theme from config.json via IPC. Returns the theme or falls back to localStorage.
 */
export async function loadThemeFromConfig(): Promise<ThemeName> {
  try {
    const result = await window.api.app.getTheme();
    if (result.ok && isValidTheme(result.data)) {
      return result.data;
    }
  } catch (err) {
    console.warn("[loadTheme] Failed to load theme from config:", err);
  }
  return getStoredTheme();
}

/**
 * Apply a theme by setting data-theme on <html> and persisting to localStorage.
 * Does NOT update the Zustand store — call useThemeStore.setTheme() instead
 * when changing themes from React components.
 */
export function applyTheme(theme: ThemeName): void {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(STORAGE_KEY, theme);
}

/**
 * Load the persisted theme at startup (called from main.tsx before React mounts).
 */
export function loadTheme(): void {
  applyTheme(getStoredTheme());
}
