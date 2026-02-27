#!/usr/bin/env python3
from __future__ import annotations

import os
import re
import sys
import time
import argparse
from pathlib import Path
from datetime import datetime

PLANS_DIR = Path("docs/plans")
REVIEWS_BASE = Path("docs/reviews")
STATES_DIR = Path(".claude/review_states")
SNAPSHOTS_BASE = Path(".claude/plan_snapshots")

POLL_SEC = 0.8
SUMMARY_TAIL_LINES = 18
STALL_WARN_SEC = 20


def clear_screen():
    print("\033[2J\033[H", end="")


def fmt_ts(ts: float) -> str:
    if ts <= 0:
        return "—"
    return datetime.fromtimestamp(ts).strftime("%H:%M:%S")


def fmt_dur(sec: float) -> str:
    if sec < 0:
        sec = 0
    m = int(sec // 60)
    s = int(sec % 60)
    return f"{m:02d}:{s:02d}"


def safe_mtime(p: Path) -> float:
    try:
        return p.stat().st_mtime
    except Exception:
        return 0.0


def latest_file(directory: Path, glob_pat: str) -> Path | None:
    if not directory.exists():
        return None
    files = [p for p in directory.glob(glob_pat) if p.is_file()]
    if not files:
        return None
    files.sort(key=lambda p: safe_mtime(p), reverse=True)
    return files[0]


def parse_round_from_name(name: str) -> int | None:
    m = re.search(r"round(\d+)", name)
    return int(m.group(1)) if m else None


def latest_for_round(kind: str, round_no: int, reviews_dir: Path) -> Path | None:
    if not reviews_dir.exists() or round_no <= 0:
        return None
    if kind == "review":
        pats = [f"review-*-round{round_no:02d}.md", f"review-*-round{round_no}.md"]
    elif kind == "summary":
        pats = [f"round{round_no:02d}-diff-summary.md", f"round{round_no}-diff-summary.md"]
    elif kind == "diff":
        pats = [f"round{round_no:02d}-diff.md", f"round{round_no}-diff.md"]
    else:
        return None

    candidates = []
    for pat in pats:
        candidates.extend([p for p in reviews_dir.glob(pat) if p.is_file()])
    if not candidates:
        return None
    candidates.sort(key=lambda p: safe_mtime(p), reverse=True)
    return candidates[0]


def read_text_tail(p: Path, n: int) -> str:
    try:
        lines = p.read_text(encoding="utf-8", errors="replace").splitlines()
        return "\n".join(lines[-n:])
    except Exception as e:
        return f"(tail failed: {type(e).__name__}: {e})"


def parse_verdict_from_review(review_path: Path) -> str:
    try:
        txt = review_path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return "UNKNOWN"
    m = re.search(r"^VERDICT:\s*([A-Z_]+)", txt, flags=re.MULTILINE)
    return m.group(1) if m else "UNKNOWN"


def infer_current_round(state_path: Path, reviews_dir: Path) -> int:
    """
    優先讀 .claude/review_states/{slug}.json，
    fallback 從 reviews_dir 下的檔名推斷。
    """
    if state_path.exists():
        try:
            import json
            obj = json.loads(state_path.read_text(encoding="utf-8", errors="replace"))
            r = obj.get("round")
            if isinstance(r, int) and r >= 0:
                return r
        except Exception:
            pass

    candidates = []
    for pat in ["review-*-round*.md", "round*-diff-summary.md", "round*-diff.md"]:
        p = latest_file(reviews_dir, pat)
        if p:
            rn = parse_round_from_name(p.name)
            if rn is not None:
                candidates.append(rn)
    return max(candidates) if candidates else 0


def step_status(step_mtime: float, base_mtime: float) -> str:
    if step_mtime <= 0:
        return "WAIT"
    if step_mtime >= base_mtime:
        return "DONE"
    return "STALE"


def icon(status: str) -> str:
    if status == "DONE":
        return "[✓]"
    if status == "STALE":
        return "[!]"
    return "[ ]"


def discover_plans() -> list[str]:
    """列出 docs/plans/ 下所有 .md 的 stem（即 plan slug）"""
    if not PLANS_DIR.exists():
        return []
    return sorted(p.stem for p in PLANS_DIR.glob("*.md") if p.is_file())


def select_plan(arg_plan: str | None) -> str | None:
    """
    決定要監控哪個 plan slug：
    1. 若指定 --plan，直接用
    2. 若 docs/plans/ 只有一個，自動選
    3. 多個時列出選單讓用戶選擇
    """
    slugs = discover_plans()

    if arg_plan:
        if arg_plan not in slugs and PLANS_DIR.exists():
            # 允許 slug 不在 docs/plans/（例如 legacy PLAN.md）
            pass
        return arg_plan

    if not slugs:
        # 沒有 docs/plans/，fallback legacy
        return "gate-0-review-system"

    if len(slugs) == 1:
        return slugs[0]

    # 互動式選單
    print("┌─────────────────────────────────────────────┐")
    print("│ 請選擇要監控的 Plan：                        │")
    print("├─────────────────────────────────────────────┤")
    for i, slug in enumerate(slugs, 1):
        print(f"│  {i}) {slug:<41}│")
    print("└─────────────────────────────────────────────┘")

    while True:
        try:
            choice = input(f"輸入編號 [1-{len(slugs)}]: ").strip()
            idx = int(choice) - 1
            if 0 <= idx < len(slugs):
                return slugs[idx]
        except (ValueError, EOFError, KeyboardInterrupt):
            pass
        print(f"請輸入 1 到 {len(slugs)} 之間的數字")


def main():
    parser = argparse.ArgumentParser(description="Review Watch Dashboard v3")
    parser.add_argument("--plan", "-p", help="Plan slug（e.g. gate-0-review-system）")
    args = parser.parse_args()

    plan_slug = select_plan(args.plan)
    if not plan_slug:
        print("找不到任何 plan，請先建立 docs/plans/*.md")
        sys.exit(1)

    reviews_dir = REVIEWS_BASE / plan_slug
    state_path = STATES_DIR / f"{plan_slug}.json"
    snapshots_dir = SNAPSHOTS_BASE / plan_slug
    plan_file = PLANS_DIR / f"{plan_slug}.md"

    # legacy fallback
    if not plan_file.exists():
        plan_file = Path("docs/PLAN.md")

    last_progress_ts = time.time()
    last_seen = {
        "plan": 0.0,
        "review": 0.0,
        "diff": 0.0,
        "summary": 0.0,
        "checklist": 0.0,
        "snap": 0.0
    }

    while True:
        now = time.time()
        cur_round = infer_current_round(state_path, reviews_dir)

        plan_m = safe_mtime(plan_file)
        checklist_p = reviews_dir / "CHECKLIST.md"
        checklist_m = safe_mtime(checklist_p)

        review_p = latest_for_round("review", cur_round, reviews_dir)
        diff_p = latest_for_round("diff", cur_round, reviews_dir)
        summary_p = latest_for_round("summary", cur_round, reviews_dir)

        review_m = safe_mtime(review_p) if review_p else 0.0
        diff_m = safe_mtime(diff_p) if diff_p else 0.0
        summary_m = safe_mtime(summary_p) if summary_p else 0.0

        snap_p = snapshots_dir / f"round{cur_round:02d}.md"
        snap_m = safe_mtime(snap_p)

        verdict = parse_verdict_from_review(review_p) if review_p else "—"

        # Base time: when PLAN last changed (round start signal)
        base = plan_m if plan_m > 0 else min(
            [t for t in [review_m, diff_m, summary_m] if t > 0], default=0.0
        )

        s_review = step_status(review_m, base)
        s_diff = step_status(diff_m, base)
        s_summary = step_status(summary_m, base)

        if checklist_m <= 0:
            s_check = "WAIT"
        else:
            if summary_m > 0 and checklist_m < summary_m:
                s_check = "STALE"
            else:
                s_check = "DONE"

        s_snap = step_status(snap_m, base) if cur_round > 0 else ("DONE" if snap_m > 0 else "WAIT")

        # Track progress
        progress_points = {
            "plan": plan_m,
            "review": review_m,
            "diff": diff_m,
            "summary": summary_m,
            "checklist": checklist_m,
            "snap": snap_m
        }
        newest = max(progress_points.values()) if progress_points else 0.0
        if newest > max(last_seen.values()):
            last_progress_ts = now
            last_seen = progress_points

        stalled_for = now - last_progress_ts
        stall_warn = stalled_for >= STALL_WARN_SEC

        clear_screen()

        header_now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        slug_display = plan_slug[:20] if len(plan_slug) > 20 else plan_slug
        print("┌──────────────────────────────────────────────────────────────┐")
        print(f"│ Review Dashboard v3.0   {header_now:<19}          │")
        print(f"│ Plan: {slug_display:<56}│")
        print("├──────────────────────────────────────────────────────────────┤")
        print(f"│ Current Round: {cur_round:02d}    Verdict: {verdict:<14}  {'⚠️ STALLED' if stall_warn else '':<10}│")
        print(f"│ PLAN mtime: {fmt_ts(plan_m):<8}  Last activity: {fmt_ts(newest):<8}  Stalled: {fmt_dur(stalled_for):<5}      │")
        print("├──────────────────────────────────────────────────────────────┤")
        print("│ Round Steps                                                  │")
        plan_ok = "DONE" if plan_m > 0 else "WAIT"
        print(f"│  {icon(plan_ok)} 1) PLAN updated/exist        @ {fmt_ts(plan_m):<8}                 │")
        print(f"│  {icon(s_review)} 2) OpenAI review saved       @ {fmt_ts(review_m):<8}   {review_p.name if review_p else '—':<18}│")
        print(f"│  {icon(s_diff)} 3) Diff saved                  @ {fmt_ts(diff_m):<8}   {diff_p.name if diff_p else '—':<18}│")
        print(f"│  {icon(s_summary)} 4) Summary saved            @ {fmt_ts(summary_m):<8}   {summary_p.name if summary_p else '—':<18}│")
        print(f"│  {icon(s_check)} 5) Checklist updated          @ {fmt_ts(checklist_m):<8}   CHECKLIST.md        │")
        print(f"│  {icon(s_snap)} 6) Snapshot saved              @ {fmt_ts(snap_m):<8}   {snap_p.name if snap_p.exists() else '—':<18}│")
        print("├──────────────────────────────────────────────────────────────┤")
        print("│ Latest PR summary (tail)                                     │")
        if summary_p and summary_p.exists():
            tail_txt = read_text_tail(summary_p, SUMMARY_TAIL_LINES)
            tail_lines = tail_txt.splitlines()[-SUMMARY_TAIL_LINES:]
            for ln in tail_lines:
                ln = ln.replace("\t", "  ")
                if len(ln) > 60:
                    ln = ln[:60] + "…"
                print(f"│  {ln:<60}│")
        else:
            print("│  (no summary yet)                                            │")

        print("└──────────────────────────────────────────────────────────────┘")

        print("\nHints:")
        print(f"- Edit docs/plans/{plan_slug}.md to start a round.")
        print("- If stalled, check: OPENAI_API_KEY, openai package, hook config, stderr logs.")
        print(f"- Artifacts live in docs/reviews/{plan_slug}/ and .claude/plan_snapshots/{plan_slug}/")
        print(f"- Switch plan: python3 tools/review_watch_dashboard.py --plan <slug>")
        all_plans = discover_plans()
        if len(all_plans) > 1:
            others = [s for s in all_plans if s != plan_slug]
            print(f"- Other plans: {', '.join(others)}")

        time.sleep(POLL_SEC)


if __name__ == "__main__":
    main()
