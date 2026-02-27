#!/usr/bin/env python3
from __future__ import annotations

import os
import re
import time
from pathlib import Path
from datetime import datetime

PLAN = Path("docs/PLAN.md")
REVIEWS = Path("docs/reviews")
STATE = Path(".claude/review_state.json")

POLL_SEC = 0.8
SUMMARY_TAIL_LINES = 18
STALL_WARN_SEC = 20  # 超過這秒數沒有新進展就警示


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


def latest_file(glob_pat: str) -> Path | None:
    if not REVIEWS.exists():
        return None
    files = [p for p in REVIEWS.glob(glob_pat) if p.is_file()]
    if not files:
        return None
    files.sort(key=lambda p: safe_mtime(p), reverse=True)
    return files[0]


def parse_round_from_name(name: str) -> int | None:
    # supports ...round03... and ...round3...
    m = re.search(r"round(\d+)", name)
    return int(m.group(1)) if m else None


def latest_for_round(kind: str, round_no: int) -> Path | None:
    if not REVIEWS.exists() or round_no <= 0:
        return None
    if kind == "review":
        # review-YYYY...-roundNN.md
        pats = [f"review-*-round{round_no:02d}.md", f"review-*-round{round_no}.md"]
    elif kind == "summary":
        pats = [f"round{round_no:02d}-diff-summary.md", f"round{round_no}-diff-summary.md"]
    elif kind == "diff":
        pats = [f"round{round_no:02d}-diff.md", f"round{round_no}-diff.md"]
    else:
        return None

    candidates = []
    for pat in pats:
        candidates.extend([p for p in REVIEWS.glob(pat) if p.is_file()])
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


def infer_current_round() -> int:
    """
    Prefer .claude/review_state.json if it exists and contains 'round',
    else infer from latest review/summary/diff filenames.
    """
    # Try state file
    if STATE.exists():
        try:
            import json
            obj = json.loads(STATE.read_text(encoding="utf-8", errors="replace"))
            r = obj.get("round")
            if isinstance(r, int) and r >= 0:
                return r
        except Exception:
            pass

    # Infer from file names
    candidates = []
    for pat in ["review-*-round*.md", "round*-diff-summary.md", "round*-diff.md"]:
        p = latest_file(pat)
        if p:
            rn = parse_round_from_name(p.name)
            if rn is not None:
                candidates.append(rn)
    return max(candidates) if candidates else 0


def step_status(step_mtime: float, base_mtime: float) -> str:
    """
    Returns one of: DONE, WAIT, STALE
    """
    if step_mtime <= 0:
        return "WAIT"
    if step_mtime >= base_mtime:
        return "DONE"
    return "STALE"


def icon(status: str) -> str:
    # DONE / WAIT / STALE
    if status == "DONE":
        return "[✓]"
    if status == "STALE":
        return "[!]"
    return "[ ]"


def main():
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
        cur_round = infer_current_round()

        plan_m = safe_mtime(PLAN)
        checklist_p = REVIEWS / "CHECKLIST.md"
        checklist_m = safe_mtime(checklist_p)

        review_p = latest_for_round("review", cur_round)
        diff_p = latest_for_round("diff", cur_round)
        summary_p = latest_for_round("summary", cur_round)

        review_m = safe_mtime(review_p) if review_p else 0.0
        diff_m = safe_mtime(diff_p) if diff_p else 0.0
        summary_m = safe_mtime(summary_p) if summary_p else 0.0

        snap_p = Path(f".claude/plan_snapshots/round{cur_round:02d}.md")
        snap_m = safe_mtime(snap_p)

        verdict = parse_verdict_from_review(review_p) if review_p else "—"

        # Base time: when PLAN last changed (round start signal)
        base = plan_m if plan_m > 0 else min([t for t in [review_m, diff_m, summary_m] if t > 0], default=0.0)

        s_review = step_status(review_m, base)
        s_diff = step_status(diff_m, base)
        s_summary = step_status(summary_m, base)

        # Checklist should be updated after summary in v2.3.3 (ideal).
        # If checklist exists but older than summary, mark STALE.
        if checklist_m <= 0:
            s_check = "WAIT"
        else:
            if summary_m > 0 and checklist_m < summary_m:
                s_check = "STALE"
            else:
                s_check = "DONE"

        # Snapshot for this round
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
        print("┌──────────────────────────────────────────────────────────────┐")
        print(f"│ Review Dashboard — PLAN ↔ OpenAI (v2.3.3)   {header_now:<19}│")
        print("├──────────────────────────────────────────────────────────────┤")
        print(f"│ Current Round: {cur_round:02d}    Verdict: {verdict:<14}  {'⚠️ STALLED' if stall_warn else '':<10}│")
        print(f"│ PLAN mtime: {fmt_ts(plan_m):<8}  Last activity: {fmt_ts(newest):<8}  Stalled: {fmt_dur(stalled_for):<5}      │")
        print("├──────────────────────────────────────────────────────────────┤")
        print("│ Round Steps                                                  │")
        # Step 1: PLAN updated exists
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
                # pad/truncate to fit box width
                ln = ln.replace("\t", "  ")
                if len(ln) > 60:
                    ln = ln[:60] + "…"
                print(f"│  {ln:<60}│")
        else:
            print("│  (no summary yet)                                            │")

        print("└──────────────────────────────────────────────────────────────┘")

        # Small hint footer (outside box)
        print("\nHints:")
        print("- Edit docs/PLAN.md to start a round.")
        print("- If stalled, check: OPENAI_API_KEY, openai package, hook config, stderr logs.")
        print("- Artifacts live in docs/reviews/ and .claude/plan_snapshots/")

        time.sleep(POLL_SEC)


if __name__ == "__main__":
    main()
