import * as fs from "fs";
import * as path from "path";
import ignore, { type Ignore } from "ignore";
import type { FileTreeNode, FileReadResult } from "@shared/types";

/** Directories that are always excluded from the file tree */
export const ALWAYS_EXCLUDED = [
  ".git",
  "node_modules",
  ".worktrees",
  ".tasks",
  ".milestones",
  ".decisions",
  ".grove",
];

/** Max file size for reading content (1 MB) */
const MAX_FILE_SIZE = 1_048_576;

/** Extension → Shiki language identifier */
const LANG_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "jsx",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".sql": "sql",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".json": "json",
  ".jsonc": "jsonc",
  ".md": "markdown",
  ".mdx": "markdown",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".css": "css",
  ".scss": "scss",
  ".less": "less",
  ".html": "html",
  ".htm": "html",
  ".toml": "toml",
  ".xml": "xml",
  ".svg": "xml",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".vue": "vue",
  ".svelte": "svelte",
  ".rb": "ruby",
  ".java": "java",
  ".kt": "kotlin",
  ".swift": "swift",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "c",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".php": "php",
  ".lua": "lua",
  ".r": "r",
  ".env": "shell",
};

/** Well-known filenames → language */
const FILENAME_MAP: Record<string, string> = {
  Makefile: "makefile",
  Dockerfile: "dockerfile",
  ".gitignore": "gitignore",
  ".dockerignore": "gitignore",
  ".env": "shell",
  ".env.local": "shell",
  ".env.development": "shell",
  ".env.production": "shell",
  Jenkinsfile: "groovy",
  ".prettierrc": "json",
  ".eslintrc": "json",
  "tsconfig.json": "jsonc",
  "tsconfig.node.json": "jsonc",
  "tsconfig.web.json": "jsonc",
};

/**
 * Detect language from filename/extension for Shiki highlighting
 */
function detectLanguage(filename: string): string {
  // Check filename first (more specific)
  if (FILENAME_MAP[filename]) return FILENAME_MAP[filename];

  const ext = path.extname(filename).toLowerCase();
  return LANG_MAP[ext] || "text";
}

/**
 * Check if a buffer likely contains binary content
 * by looking for null bytes in the first 8KB
 */
function isBinary(buffer: Buffer): boolean {
  const length = Math.min(buffer.length, 8192);
  for (let i = 0; i < length; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/**
 * Build a recursive file tree for the workspace, respecting .gitignore
 */
export async function buildFileTree(
  workspacePath: string,
): Promise<FileTreeNode[]> {
  // Load root .gitignore (v1: root only, nested .gitignore deferred)
  const ig = ignore();
  const gitignorePath = path.join(workspacePath, ".gitignore");
  try {
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, "utf-8");
      ig.add(content);
    }
  } catch {
    // ignore read errors on .gitignore
  }

  // Add always-excluded dirs to the ignore list
  for (const dir of ALWAYS_EXCLUDED) {
    ig.add(dir);
  }

  return walkDirectory(workspacePath, workspacePath, ig);
}

/**
 * Recursively walk a directory and build the tree
 */
async function walkDirectory(
  rootPath: string,
  dirPath: string,
  ig: Ignore,
): Promise<FileTreeNode[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch {
    // Permission error or other read failure — skip this directory
    return [];
  }

  const dirs: FileTreeNode[] = [];
  const files: FileTreeNode[] = [];

  for (const entry of entries) {
    // Skip symlinks entirely (avoid cycles and path traversal)
    if (entry.isSymbolicLink()) continue;

    const relativePath = path.relative(
      rootPath,
      path.join(dirPath, entry.name),
    );

    // Check gitignore — use '/' suffix for directories
    const ignoreTestPath = entry.isDirectory()
      ? relativePath + "/"
      : relativePath;
    if (ig.ignores(ignoreTestPath)) continue;

    if (entry.isDirectory()) {
      const children = await walkDirectory(
        rootPath,
        path.join(dirPath, entry.name),
        ig,
      );
      dirs.push({
        name: entry.name,
        path: relativePath,
        type: "directory",
        children,
      });
    } else if (entry.isFile()) {
      files.push({
        name: entry.name,
        path: relativePath,
        type: "file",
      });
    }
  }

  // Sort: directories first, then files; alphabetical within each group (case-insensitive)
  const sortFn = (a: FileTreeNode, b: FileTreeNode): number =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  dirs.sort(sortFn);
  files.sort(sortFn);

  return [...dirs, ...files];
}

/**
 * Read a file from the workspace with security validation
 */
export async function readFileContent(
  workspacePath: string,
  relativePath: string,
): Promise<FileReadResult> {
  // Path traversal protection
  const resolved = path.resolve(workspacePath, relativePath);
  if (
    !resolved.startsWith(workspacePath + path.sep) &&
    resolved !== workspacePath
  ) {
    throw new Error("Path traversal denied");
  }

  // Check file size before reading
  const stat = await fs.promises.stat(resolved);
  if (stat.size > MAX_FILE_SIZE) {
    return { tooLarge: true, size: stat.size };
  }

  // Read as buffer first for binary detection
  const buffer = await fs.promises.readFile(resolved);

  if (isBinary(buffer)) {
    return { binary: true };
  }

  const content = buffer.toString("utf-8");
  const language = detectLanguage(path.basename(resolved));
  const lineCount = content.split("\n").length;

  return { content, language, lineCount };
}
