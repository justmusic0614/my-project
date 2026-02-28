import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

type Status = {
  schema_version?: string;
  version?: string;
  plan_slug: string;
  round: number;
  stage: string;
  verdict: string;
  ui?: { icon: string; color: string; label: string; short: string };
  updated_at?: string;
  failed_personas?: string[];
  imp_matrix?: {
    prev_open_count?: number;
    responded_count?: number;
    not_addressed_count?: number;
  };
  artifacts?: {
    dashboard?: string | null;
    timeline?: string | null;
    reviews_dir?: string;
  };
};

let statusBarItem: vscode.StatusBarItem;
let watcher: fs.FSWatcher | undefined;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function getStatusFilePath(): string | undefined {
  const config = vscode.workspace.getConfiguration('reviewStatus');
  const slug = config.get<string>('planSlug', '').trim();
  if (!slug) return undefined;
  const root = getWorkspaceRoot();
  if (!root) return undefined;
  return path.join(root, 'docs', 'reviews', slug, '.status.json');
}

function resolveArtifact(rel: string | null | undefined): string | undefined {
  if (!rel) return undefined;
  const root = getWorkspaceRoot();
  return root ? path.join(root, rel) : undefined;
}

function readStatus(filePath: string): Status | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as Status;
  } catch {
    return null;
  }
}

function renderStatusBar(s: Status): void {
  const ui = s.ui;
  const icon = ui?.icon ?? '❓';
  const short = ui?.short ?? s.stage;
  const round = String(s.round).padStart(2, '0');
  statusBarItem.text = `${icon} ${s.plan_slug} r${round} ${short} ${s.verdict}`;

  const imp = s.imp_matrix;
  const impLine = imp
    ? `IMP: prev=${imp.prev_open_count ?? 0} ok=${imp.responded_count ?? 0} ⚠=${imp.not_addressed_count ?? 0}`
    : '';
  const fpLine = s.failed_personas?.length
    ? `Failed: ${s.failed_personas.join(', ')}`
    : '';

  statusBarItem.tooltip = [
    `Stage:   ${s.stage}`,
    `Verdict: ${s.verdict}`,
    s.updated_at ? `Updated: ${s.updated_at}` : '',
    impLine,
    fpLine,
  ]
    .filter(Boolean)
    .join('\n');

  const color = ui?.color;
  if (color === 'green') {
    statusBarItem.color = new vscode.ThemeColor('terminal.ansiGreen');
  } else if (color === 'red') {
    statusBarItem.color = new vscode.ThemeColor('terminal.ansiRed');
  } else {
    statusBarItem.color = undefined;
  }
}

function readAndRender(): void {
  const filePath = getStatusFilePath();
  if (!filePath) {
    statusBarItem.text = '$(question) review: set planSlug';
    statusBarItem.tooltip = 'Set reviewStatus.planSlug in VS Code settings';
    statusBarItem.color = undefined;
    return;
  }
  if (!fs.existsSync(filePath)) {
    statusBarItem.text = '$(question) no review status';
    statusBarItem.tooltip = `Waiting for: ${filePath}`;
    statusBarItem.color = undefined;
    return;
  }
  const s = readStatus(filePath);
  if (!s) {
    statusBarItem.text = '$(warning) review status error';
    statusBarItem.tooltip = `Could not parse: ${filePath}`;
    statusBarItem.color = undefined;
    return;
  }
  renderStatusBar(s);
}

function startWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = undefined;
  }
  const filePath = getStatusFilePath();
  if (!filePath) return;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) return;
  try {
    watcher = fs.watch(dir, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(readAndRender, 150);
    });
  } catch {
    // dir may not exist yet — silently ignore
  }
}

export function activate(context: vscode.ExtensionContext): void {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    10
  );
  statusBarItem.command = 'reviewStatus.openDashboard';
  statusBarItem.show();

  readAndRender();
  startWatcher();

  // Restart watcher when config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('reviewStatus')) {
        startWatcher();
        readAndRender();
      }
    })
  );

  // Command: open DASHBOARD.md
  context.subscriptions.push(
    vscode.commands.registerCommand('reviewStatus.openDashboard', () => {
      const filePath = getStatusFilePath();
      if (!filePath || !fs.existsSync(filePath)) {
        vscode.window.showWarningMessage('Review: no .status.json found');
        return;
      }
      const s = readStatus(filePath);
      const abs = resolveArtifact(s?.artifacts?.dashboard);
      if (abs && fs.existsSync(abs)) {
        vscode.commands.executeCommand('vscode.open', vscode.Uri.file(abs));
      } else {
        vscode.window.showWarningMessage('Review: DASHBOARD.md not found');
      }
    })
  );

  // Command: open TIMELINE.md
  context.subscriptions.push(
    vscode.commands.registerCommand('reviewStatus.openTimeline', () => {
      const filePath = getStatusFilePath();
      if (!filePath || !fs.existsSync(filePath)) {
        vscode.window.showWarningMessage('Review: no .status.json found');
        return;
      }
      const s = readStatus(filePath);
      const abs = resolveArtifact(s?.artifacts?.timeline);
      if (abs && fs.existsSync(abs)) {
        vscode.commands.executeCommand('vscode.open', vscode.Uri.file(abs));
      } else {
        vscode.window.showWarningMessage('Review: TIMELINE.md not found yet');
      }
    })
  );

  // Command: reveal reviews folder in Explorer
  context.subscriptions.push(
    vscode.commands.registerCommand('reviewStatus.revealReviewsDir', () => {
      const filePath = getStatusFilePath();
      if (!filePath) {
        vscode.window.showWarningMessage('Review: set reviewStatus.planSlug first');
        return;
      }
      // Try to use reviews_dir from .status.json; fallback to directory of status file
      let dir = path.dirname(filePath);
      if (fs.existsSync(filePath)) {
        const s = readStatus(filePath);
        const abs = resolveArtifact(s?.artifacts?.reviews_dir);
        if (abs && fs.existsSync(abs)) dir = abs;
      }
      vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(dir));
    })
  );

  context.subscriptions.push(statusBarItem);
}

export function deactivate(): void {
  watcher?.close();
}
