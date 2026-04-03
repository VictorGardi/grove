import {
  createHighlighter,
  createJavaScriptRegexEngine,
  type Highlighter,
} from "shiki";
import { groveTheme } from "./shikiTheme";

let highlighterPromise: Promise<Highlighter> | null = null;

/**
 * Lazy-loaded, cached Shiki highlighter singleton.
 * Languages are pre-loaded to avoid per-file loading delays.
 */
export function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      // Use the JavaScript regex engine — avoids loading onig.wasm which can
      // fail silently in Electron's sandboxed renderer process.
      engine: createJavaScriptRegexEngine(),
      themes: [groveTheme],
      langs: [
        "typescript",
        "tsx",
        "javascript",
        "jsx",
        "python",
        "go",
        "rust",
        "sql",
        "yaml",
        "json",
        "jsonc",
        "markdown",
        "bash",
        "dockerfile",
        "css",
        "html",
        "toml",
        "xml",
        "graphql",
        "makefile",
      ],
    });
  }
  return highlighterPromise;
}

/** List of languages the highlighter supports */
export const SUPPORTED_LANGS = new Set([
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "python",
  "go",
  "rust",
  "sql",
  "yaml",
  "json",
  "jsonc",
  "markdown",
  "bash",
  "dockerfile",
  "css",
  "html",
  "toml",
  "xml",
  "graphql",
  "makefile",
  "text",
]);
