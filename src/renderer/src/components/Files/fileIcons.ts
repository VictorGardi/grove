/** Extension → short icon label */
const EXT_ICONS: Record<string, string> = {
  ".ts": "TS",
  ".tsx": "TX",
  ".js": "JS",
  ".jsx": "JX",
  ".mjs": "JS",
  ".cjs": "JS",
  ".json": "{}",
  ".jsonc": "{}",
  ".md": "MD",
  ".mdx": "MD",
  ".css": "CS",
  ".scss": "SC",
  ".less": "LS",
  ".html": "<>",
  ".htm": "<>",
  ".py": "PY",
  ".go": "GO",
  ".rs": "RS",
  ".sql": "SQ",
  ".yml": "YM",
  ".yaml": "YM",
  ".sh": "$_",
  ".bash": "$_",
  ".zsh": "$_",
  ".toml": "TM",
  ".xml": "XM",
  ".svg": "SV",
  ".graphql": "GQ",
  ".gql": "GQ",
  ".vue": "VU",
  ".svelte": "SV",
  ".rb": "RB",
  ".java": "JA",
  ".kt": "KT",
  ".swift": "SW",
  ".c": " C",
  ".cpp": "C+",
  ".h": " H",
  ".hpp": "H+",
  ".cs": "C#",
  ".php": "PH",
  ".lua": "LU",
  ".r": " R",
  ".env": "EN",
  ".lock": "LK",
  ".log": "LG",
  ".txt": "TX",
  ".csv": "CV",
  ".png": "IM",
  ".jpg": "IM",
  ".jpeg": "IM",
  ".gif": "IM",
  ".ico": "IM",
  ".woff": "FN",
  ".woff2": "FN",
  ".ttf": "FN",
  ".eot": "FN",
};

/** Well-known filenames → icon label */
const FILENAME_ICONS: Record<string, string> = {
  Makefile: "MK",
  Dockerfile: "DK",
  LICENSE: "LI",
  ".gitignore": "GI",
  ".dockerignore": "DI",
  ".env": "EN",
  ".env.local": "EN",
  ".prettierrc": "PR",
  ".eslintrc": "EL",
  "package.json": "PJ",
  "tsconfig.json": "TS",
  "vite.config.ts": "VI",
  "README.md": "RM",
};

/**
 * Get the file extension from a filename (e.g., "foo.ts" → ".ts")
 */
function getExt(filename: string): string {
  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx <= 0) return ""; // no extension or dotfile
  return filename.slice(dotIdx).toLowerCase();
}

/**
 * Get a short icon label for a filename
 */
export function getFileIcon(filename: string): string {
  if (FILENAME_ICONS[filename]) return FILENAME_ICONS[filename];
  const ext = getExt(filename);
  return EXT_ICONS[ext] || "  ";
}
