# vscode-review-status

VS Code extension that shows `review_plan_loop` status in the status bar.
Reads `.status.json` as the single source of truth (v4.0 schema).

## Install

```bash
cd tools/vscode-review-status
npm install
npm run build
```

Then in VS Code:

- **Run Extension (F5)** — launches an Extension Development Host
- Or package as VSIX: `npx vsce package` and install via "Install from VSIX..."

## Configuration

Open VS Code settings and set:

```json
"reviewStatus.planSlug": "review-loop-l1a"
```

The extension will watch `docs/reviews/<planSlug>/.status.json` for changes.

## Status Bar

Format: `{icon} {plan_slug} r{round} {short} {verdict}`

| Stage | Icon | Color |
|---|---|---|
| RUNNING | ⏳ | yellow |
| PRECHECK_BLOCKED | ⛔ | red |
| GATE_BLOCKED | 🛑 | red |
| COMMITTED / APPROVED | ✅ | green |
| COMMITTED / NEEDS_REVISION | 🟡 | yellow |
| COMMITTED / BLOCKED | 🛑 | red |

Click the status bar item to open DASHBOARD.md.

## Commands

| Command | Description |
|---|---|
| `Review: Open Dashboard` | Open DASHBOARD.md |
| `Review: Open Timeline` | Open TIMELINE.md |
| `Review: Reveal Reviews Folder` | Reveal reviews directory in Finder/Explorer |

Access commands via `Cmd+Shift+P` → type "Review:".

## Requirements

- VS Code ^1.80.0
- Node.js (for building)
- TypeScript 5.x (installed as devDependency)
