import { execFile } from "child_process";
import * as path from "path";

/** Map a file extension to an image mime type for use in a data URI. */
export function mimeForPath(fsPath: string): string {
  const ext = path.extname(fsPath).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    case ".ico":
      return "image/x-icon";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

/** Encode raw bytes + a path's mime type into a `data:` URI. */
export function toDataUri(bytes: Uint8Array, fsPath: string): string {
  const base64 = Buffer.from(bytes).toString("base64");
  return `data:${mimeForPath(fsPath)};base64,${base64}`;
}

interface ExecResult {
  code: number | null;
  stdout: Buffer;
  stderr: string;
}

/**
 * Run git, capturing stdout as raw bytes (so binary blobs survive).
 * Never rejects on a non-zero exit — the caller inspects `code`.
 */
function runGit(args: string[], cwd: string): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, encoding: "buffer", maxBuffer: 256 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const code =
          err && typeof (err as any).code === "number" ? (err as any).code : err ? 1 : 0;
        resolve({
          code,
          stdout: stdout ?? Buffer.alloc(0),
          stderr: stderr ? stderr.toString("utf8") : "",
        });
      }
    );
  });
}

export interface GitContext {
  /** Absolute path to the repository root. */
  repoRoot: string;
  /** File path relative to the repo root, using forward slashes. */
  relPath: string;
}

/** Resolve the repo root and repo-relative path for a file, or null if not in a repo. */
export async function resolveGitContext(fsPath: string): Promise<GitContext | null> {
  const dir = path.dirname(fsPath);
  const res = await runGit(["rev-parse", "--show-toplevel"], dir);
  if (res.code !== 0) {
    return null;
  }
  const repoRoot = res.stdout.toString("utf8").trim();
  if (!repoRoot) {
    return null;
  }
  const relPath = path.relative(repoRoot, fsPath).split(path.sep).join("/");
  return { repoRoot, relPath };
}

/** Read the bytes of a file at HEAD, or null if it does not exist there (new/untracked). */
export async function readHeadBytes(ctx: GitContext): Promise<Uint8Array | null> {
  const res = await runGit(["show", `HEAD:${ctx.relPath}`], ctx.repoRoot);
  if (res.code !== 0) {
    return null;
  }
  return new Uint8Array(res.stdout);
}
