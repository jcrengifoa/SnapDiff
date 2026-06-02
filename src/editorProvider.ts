import * as vscode from "vscode";
import { resolveGitContext, readHeadBytes, toDataUri, mimeForPath } from "./gitImage";

/** Minimal read-only document: we only need the resource URI. */
class GitImageDocument implements vscode.CustomDocument {
  constructor(public readonly uri: vscode.Uri) {}
  dispose(): void {
    /* nothing to clean up */
  }
}

export class SnapDiffEditorProvider
  implements vscode.CustomReadonlyEditorProvider<GitImageDocument>
{
  public static readonly viewType = "snapDiff.compare";

  constructor(private readonly context: vscode.ExtensionContext) {}

  openCustomDocument(uri: vscode.Uri): GitImageDocument {
    return new GitImageDocument(uri);
  }

  async resolveCustomEditor(
    document: GitImageDocument,
    panel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, "media");
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [mediaRoot],
    };
    panel.webview.html = this.getHtml(panel.webview);

    // Build and push the current comparison payload to the webview.
    const sendPayload = async () => {
      const payload = await this.buildPayload(document.uri);
      panel.webview.postMessage({ type: "load", ...payload });
    };

    // Push only the working-tree ("after") image — used on live file changes.
    const sendAfterOnly = async () => {
      try {
        const bytes = await vscode.workspace.fs.readFile(document.uri);
        panel.webview.postMessage({
          type: "after",
          after: toDataUri(bytes, document.uri.fsPath),
        });
      } catch {
        /* file may be momentarily missing during a write; ignore */
      }
    };

    // The webview asks for data once its script is ready (avoids a race).
    const msgSub = panel.webview.onDidReceiveMessage((msg) => {
      if (msg?.type === "ready") {
        void sendPayload();
      }
    });

    // Watch the file on disk so edits reflect live without reopening.
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.joinPath(document.uri, ".."),
        path_basename(document.uri.fsPath)
      )
    );
    watcher.onDidChange(() => void sendAfterOnly());
    watcher.onDidCreate(() => void sendPayload());
    watcher.onDidDelete(() => void sendPayload());

    panel.onDidDispose(() => {
      msgSub.dispose();
      watcher.dispose();
    });
  }

  /** Assemble before (HEAD) + after (disk) versions and editor config. */
  private async buildPayload(uri: vscode.Uri) {
    const cfg = vscode.workspace.getConfiguration("snapDiff");
    const config = {
      startupMode: cfg.get<string>("startupMode", "swipe"),
      diffThreshold: cfg.get<number>("diffThreshold", 16),
      highlightColor: cfg.get<string>("highlightColor", "#ff2d55"),
      onionSpeed: cfg.get<number>("onionSpeed", 1.2),
    };

    let after: string | null = null;
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      after = toDataUri(bytes, uri.fsPath);
    } catch {
      after = null;
    }

    const fileName = path_basename(uri.fsPath);
    const mime = mimeForPath(uri.fsPath);

    const gitCtx = await resolveGitContext(uri.fsPath);
    if (!gitCtx) {
      return {
        config,
        fileName,
        mime,
        before: null,
        after,
        status: "not-in-repo",
      };
    }

    const headBytes = await readHeadBytes(gitCtx);
    if (!headBytes) {
      return {
        config,
        fileName,
        mime,
        before: null,
        after,
        status: "untracked",
      };
    }

    const before = toDataUri(headBytes, uri.fsPath);

    // Cheap change detection: compare byte lengths/content of HEAD vs disk.
    let hasChanges = true;
    try {
      const diskBytes = await vscode.workspace.fs.readFile(uri);
      hasChanges = !buffersEqual(headBytes, diskBytes);
    } catch {
      hasChanges = true;
    }

    return {
      config,
      fileName,
      mime,
      before,
      after,
      status: hasChanges ? "changed" : "unchanged",
    };
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "main.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "styles.css")
    );
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>SnapDiff</title>
</head>
<body>
  <div id="toolbar" class="toolbar" role="toolbar" aria-label="Comparison controls">
    <div class="group modes">
      <button class="mode-btn" data-mode="swipe" title="Swipe">Swipe</button>
      <button class="mode-btn" data-mode="opacity" title="Opacity">Opacity</button>
      <button class="mode-btn" data-mode="onion" title="Onion skin">Onion</button>
      <button class="mode-btn" data-mode="redline" title="Redline difference">Redline</button>
    </div>

    <div class="group" id="slider-group">
      <label id="slider-label" for="slider">Position</label>
      <input id="slider" type="range" min="0" max="100" value="50" />
      <span id="slider-value" class="value">50%</span>
    </div>

    <div class="group hidden" id="onion-group">
      <button id="onion-play" title="Play / pause">▶ Play</button>
      <label for="onion-speed">Speed</label>
      <input id="onion-speed" type="range" min="0.1" max="6" step="0.1" value="1.2" />
    </div>

    <div class="group hidden" id="redline-group">
      <label for="threshold">Threshold</label>
      <input id="threshold" type="range" min="0" max="128" value="16" />
      <span id="threshold-value" class="value">16</span>
      <label class="checkbox"><input id="diff-only" type="checkbox" /> Diff only</label>
      <span id="changed-pct" class="value pct"></span>
    </div>

    <div class="group right">
      <button id="swap" title="Swap before/after">⇄ Swap</button>
      <span class="zoom-controls">
        <button id="zoom-out" title="Zoom out (Ctrl/Cmd + scroll)">−</button>
        <button id="zoom-level" title="Reset to 100%">100%</button>
        <button id="zoom-in" title="Zoom in (Ctrl/Cmd + scroll)">+</button>
      </span>
      <button id="fit" title="Zoom to fit">Fit</button>
    </div>
  </div>

  <div id="status-banner" class="status-banner hidden"></div>

  <div id="viewport" class="viewport">
    <div id="stage" class="stage">
      <img id="img-before" class="layer" alt="before (Original)" />
      <img id="img-after" class="layer" alt="after (Modified)" />
      <canvas id="diff-canvas" class="layer hidden"></canvas>
      <div id="swipe-handle" class="swipe-handle hidden">
        <div class="swipe-line"></div>
        <div class="swipe-grip">⇆</div>
      </div>
      <div id="label-before" class="corner-label left">Original</div>
      <div id="label-after" class="corner-label right">Modified</div>
    </div>
  </div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function path_basename(fsPath: string): string {
  const norm = fsPath.split(/[\\/]/);
  return norm[norm.length - 1] || fsPath;
}

function buffersEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
