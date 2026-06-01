import * as vscode from "vscode";
import { SnapDiffEditorProvider } from "./editorProvider";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new SnapDiffEditorProvider(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      SnapDiffEditorProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: true,
      }
    )
  );

  // Open an image in the diff editor. Invoked from the title-bar button,
  // the Explorer/SCM context menus (which pass a Uri or SCM resource state),
  // or the command palette (which passes nothing — we read the active tab).
  context.subscriptions.push(
    vscode.commands.registerCommand("snapDiff.compareActive", async (arg?: unknown) => {
      const uri = coerceUri(arg) ?? activeResourceUri();
      if (!uri) {
        vscode.window.showInformationMessage(
          "SnapDiff: open or select an image file to compare."
        );
        return;
      }
      await vscode.commands.executeCommand(
        "vscode.openWith",
        uri,
        SnapDiffEditorProvider.viewType
      );
    })
  );
}

export function deactivate(): void {
  /* nothing to clean up */
}

/**
 * Turn a command argument into a Uri. Menu commands pass either a Uri
 * (Explorer/editor title) or an SCM resource state (Source Control), whose
 * `.resourceUri` is the working-tree file we want.
 */
function coerceUri(arg: unknown): vscode.Uri | undefined {
  if (arg instanceof vscode.Uri) {
    return arg;
  }
  const maybe = arg as { resourceUri?: vscode.Uri } | undefined;
  if (maybe?.resourceUri instanceof vscode.Uri) {
    return maybe.resourceUri;
  }
  return undefined;
}

/**
 * Best-effort lookup of the image URI behind the active editor tab.
 * Handles plain editors, our custom editor, and diff editors (built-in image
 * diff from Source Control) — preferring the modified (working-tree) side.
 */
function activeResourceUri(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup?.activeTab?.input as
    | { uri?: vscode.Uri; modified?: vscode.Uri; original?: vscode.Uri }
    | undefined;
  if (input?.uri instanceof vscode.Uri) {
    return input.uri;
  }
  if (input?.modified instanceof vscode.Uri) {
    return input.modified;
  }
  if (input?.original instanceof vscode.Uri) {
    return input.original;
  }
  return vscode.window.activeTextEditor?.document.uri;
}
