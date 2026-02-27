#!/usr/bin/env python3
"""
review_plan_loop.py v3.0

Claude Code PostToolUse hook
觸發條件：Write|Edit 工具，且 tool_input.file_path 包含：
  - docs/plans/*.md（新格式，per-plan slug）
  - docs/PLAN.md（legacy 向後相容，slug = "gate-0-review-system"）

功能：
1. 從檔案路徑推斷 plan_slug（e.g. "gate-0-review-system"）
2. 讀取對應 docs/plans/{slug}.md（或 legacy docs/PLAN.md）
3. 對比前一輪快照 → unified diff
4. 呼叫 OpenAI（REVIEW_MODEL）審稿 → docs/reviews/{slug}/review-{ts}-roundNN.md
5. 呼叫 OpenAI（SUMMARY_MODEL）→ docs/reviews/{slug}/roundNN-diff-summary.md
6. 存 docs/reviews/{slug}/roundNN-diff.md（diff + stats）
7. 更新 docs/reviews/{slug}/CHECKLIST.md（stable IDs，跨輪累積）
8. 快照至 .claude/plan_snapshots/{slug}/roundNN.md + latest.md
9. stdout 輸出 JSON decision
   - APPROVED       → decision: block（附 summary 建議，等待人工確認）
   - NEEDS_REVISION → decision: block（提示修正）
   - BLOCKED        → decision: block（嚴重問題）

環境需求：
  pip install openai
  export OPENAI_API_KEY=sk-...
"""

from __future__ import annotations

import sys
import json
import os
import datetime
import difflib
import re
from pathlib import Path


# ── .env fallback 載入（Claude Code hook 不繼承 shell 環境變數）────────────
def _load_dotenv_fallback() -> None:
    """
    從 repo root 的 .env 補齊未設定的環境變數。
    只用 stdlib，不依賴 python-dotenv。
    已在 os.environ 中的變數不覆蓋。
    """
    env_path = Path(__file__).resolve().parent.parent.parent / ".env"
    if not env_path.exists():
        return
    try:
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                key = key.strip()
                # 去除引號（單引號或雙引號）
                val = val.strip()
                if len(val) >= 2 and val[0] == val[-1] and val[0] in ('"', "'"):
                    val = val[1:-1]
                if key and key not in os.environ:
                    os.environ[key] = val
    except Exception:
        pass


_load_dotenv_fallback()

# ── 配置常數（可調整） ───────────────────────────────────────────────────────
MAX_ROUNDS = 8
PLAN_MAX_CHARS = 16000
DIFF_MAX_LINES = 200
REVIEW_MODEL = "gpt-4o"
SUMMARY_MODEL = "gpt-4o-mini"

# ── 路徑定義 ─────────────────────────────────────────────────────────────────
# 本腳本位於 .claude/hooks/，因此 repo root 在上兩層
REPO_ROOT = Path(__file__).resolve().parent.parent.parent

# legacy docs/PLAN.md 對應的 slug
LEGACY_SLUG = "gate-0-review-system"


# ── Plan slug 推斷 ────────────────────────────────────────────────────────────

def get_plan_slug(file_path: str) -> str | None:
    """
    從被修改的檔案路徑提取 plan slug。
    - docs/plans/feature-name.md  → "feature-name"
    - docs/PLAN.md                → LEGACY_SLUG（向後相容）
    - 其他                        → None（不處理）
    """
    # 新格式：docs/plans/*.md
    if "docs/plans/" in file_path and file_path.endswith(".md"):
        remainder = file_path.split("docs/plans/")[-1]
        if "/" not in remainder and remainder:
            return remainder[:-3]  # 去掉 .md

    # Legacy：docs/PLAN.md
    if "docs/PLAN.md" in file_path:
        return LEGACY_SLUG

    return None


def get_paths(plan_slug: str) -> dict:
    """返回 plan 相關的所有路徑（per-plan 隔離）"""
    return {
        "plan_file":      REPO_ROOT / "docs" / "plans" / f"{plan_slug}.md",
        "reviews_dir":    REPO_ROOT / "docs" / "reviews" / plan_slug,
        "snapshots_dir":  REPO_ROOT / ".claude" / "plan_snapshots" / plan_slug,
        "state_path":     REPO_ROOT / ".claude" / "review_states" / f"{plan_slug}.json",
        "checklist_path": REPO_ROOT / "docs" / "reviews" / plan_slug / "CHECKLIST.md",
    }


# ── Hook 輸入處理 ────────────────────────────────────────────────────────────

def get_hook_input() -> dict:
    """從 stdin 讀取 hook JSON 輸入（容錯）"""
    try:
        raw = sys.stdin.read()
        if raw.strip():
            return json.loads(raw)
    except Exception:
        pass
    return {}


def is_target_file(hook_input: dict) -> tuple[bool, str]:
    """
    判斷是否為監控目標。
    返回 (is_target, plan_slug)
    """
    tool_input = hook_input.get("tool_input", {})
    file_path = str(tool_input.get("file_path", ""))
    slug = get_plan_slug(file_path)
    return (slug is not None, slug or "")


# ── 狀態管理 ─────────────────────────────────────────────────────────────────

def load_state(paths: dict) -> dict:
    """載入輪次狀態，不存在時返回初始狀態"""
    state_path = paths["state_path"]
    if state_path.exists():
        try:
            return json.loads(state_path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"round": 0, "status": "PENDING"}


def save_state(state: dict, paths: dict) -> None:
    """儲存輪次狀態"""
    state_path = paths["state_path"]
    state_path.write_text(
        json.dumps(state, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )


# ── Diff 生成 ────────────────────────────────────────────────────────────────

def generate_diff(old_content: str, new_content: str) -> tuple:
    """
    生成 unified diff
    返回 (diff_text: str, stats: dict)
    """
    old_lines = old_content.splitlines(keepends=True)
    new_lines = new_content.splitlines(keepends=True)

    diff_lines = list(difflib.unified_diff(
        old_lines,
        new_lines,
        fromfile="PLAN.md (前一輪快照)",
        tofile="PLAN.md (本輪)",
        lineterm=""
    ))

    added = sum(1 for ln in diff_lines if ln.startswith("+") and not ln.startswith("+++"))
    removed = sum(1 for ln in diff_lines if ln.startswith("-") and not ln.startswith("---"))
    stats = {"added": added, "removed": removed, "total_lines": len(diff_lines)}

    # 截斷過長 diff
    truncated = False
    if len(diff_lines) > DIFF_MAX_LINES:
        diff_lines = diff_lines[:DIFF_MAX_LINES]
        diff_lines.append(f"\n... [TRUNCATED: 超過 {DIFF_MAX_LINES} 行，省略餘下內容] ...")
        truncated = True
    stats["truncated"] = truncated

    return "".join(diff_lines), stats


# ── OpenAI 呼叫 ──────────────────────────────────────────────────────────────

def call_openai_review(plan_content: str, diff_text: str, round_num: int) -> str:
    """呼叫 OpenAI 進行 PLAN.md 審稿，返回 review 原文"""
    try:
        from openai import OpenAI
    except ImportError:
        return "ERROR: openai 套件未安裝，請執行 pip install openai"

    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        return "ERROR: OPENAI_API_KEY 未設定，請 export OPENAI_API_KEY=sk-..."

    client = OpenAI(api_key=api_key)

    # 截斷過長的 PLAN.md
    truncated_plan = plan_content
    if len(plan_content) > PLAN_MAX_CHARS:
        truncated_plan = plan_content[:PLAN_MAX_CHARS] + "\n\n... [TRUNCATED] ..."

    is_first_round = not diff_text.strip()
    diff_section = "(第一輪，無前一輪快照)" if is_first_round else diff_text

    prompt = f"""你是資深工程師審稿人（Round {round_num:02d}）。
審核以下 PLAN.md，判斷是否達到「可實作」標準。

必須逐一檢查以下 6 點：
1. 目標：是否明確、可量化（非模糊動詞如「優化」「改善」）
2. 範圍/非目標：是否清楚界定邊界
3. 里程碑：是否有具體可驗證的產出物（非純時間點）
4. 風險：是否有概率×影響評估，並列出緩解措施
5. 驗收標準：是否可測試（有明確通過/失敗條件）
6. Decision Log：是否記錄了本輪的決策理由

本輪 diff（相比前一輪快照的變化）：
```
{diff_section}
```

PLAN.md 完整內容：
---
{truncated_plan}
---

**嚴格遵守以下輸出格式**：

VERDICT: APPROVED | NEEDS_REVISION | BLOCKED

問題清單（每項必須標 [IMP-NNN]，NNN 三位數從 001 開始，跨輪 stable）：
⚠️ [IMP-001] <問題描述（一行）>
⚠️ [IMP-002] <問題描述（一行）>

建議修正：
<具體建議，條列式>

注意：
- 若本輪無問題，問題清單可為空，但 VERDICT 必須是 APPROVED
- [IMP-NNN] ID 若在前輪已出現，沿用相同 ID
- BLOCKED 用於嚴重缺失（無目標、無驗收標準等根本性問題）
"""

    try:
        response = client.chat.completions.create(
            model=REVIEW_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=2000,
            temperature=0.2
        )
        return response.choices[0].message.content or ""
    except Exception as e:
        return f"ERROR: OpenAI API 呼叫失敗 — {e}"


def call_openai_summary(diff_text: str, review_content: str, round_num: int) -> str:
    """呼叫 OpenAI 生成 PR review 摘要"""
    try:
        from openai import OpenAI
    except ImportError:
        return "ERROR: openai 套件未安裝"

    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        return "ERROR: OPENAI_API_KEY 未設定"

    client = OpenAI(api_key=api_key)

    is_first_round = not diff_text.strip()
    diff_section = "(第一輪，無 diff)" if is_first_round else diff_text

    prompt = f"""根據以下 Round {round_num:02d} 的 diff 和 review，生成 PR review 摘要（繁體中文）。

嚴格遵守以下格式輸出：

## ✅ 本輪改進項目
（列出相比前一輪有改善的具體點；第一輪可寫「初始建立」）

## ⚠️ 下一輪必解卡點
（列出 NEEDS_REVISION / BLOCKED 的必修項，用 [IMP-NNN] 標記）
（每項必須寫清楚：為什麼是卡點，修好後才能繼續的原因）

## 下一輪行動建議
（條列 2~4 條具體行動）

---

Diff（Round {round_num:02d} 相比前一輪）：
```
{diff_section}
```

Review 原文：
{review_content}
"""

    try:
        response = client.chat.completions.create(
            model=SUMMARY_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1000,
            temperature=0.3
        )
        return response.choices[0].message.content or ""
    except Exception as e:
        return f"ERROR: OpenAI API 呼叫失敗 — {e}"


# ── VERDICT 與 IMP 解析 ──────────────────────────────────────────────────────

def parse_verdict(review_content: str) -> str:
    """從 review 內容中解析 VERDICT，預設保守返回 NEEDS_REVISION"""
    match = re.search(r"VERDICT:\s*(APPROVED|NEEDS_REVISION|BLOCKED)", review_content)
    if match:
        return match.group(1)
    # 若 review 本身是 ERROR，視為 NEEDS_REVISION（不阻擋工作，只警告）
    if review_content.startswith("ERROR:"):
        return "NEEDS_REVISION"
    return "NEEDS_REVISION"


def parse_imp_ids(review_content: str) -> list:
    """
    從 review 內容中解析 [IMP-NNN] 條目
    返回 list of (id_str, desc_str)，如 [("IMP-001", "缺少驗收標準")]
    """
    pattern = r"[⚠️\*•\-]*\s*\[IMP-(\d{3})\]\s*(.+?)(?=\n|$)"
    matches = re.findall(pattern, review_content)
    return [(f"IMP-{num}", desc.strip()) for num, desc in matches]


# ── CHECKLIST 管理 ───────────────────────────────────────────────────────────

def update_checklist(round_num: int, verdict: str, imp_items: list, paths: dict) -> None:
    """
    更新 CHECKLIST.md（累積，stable IDs）
    - 新 ID：直接新增
    - 已有 ID：只更新輪次（不覆蓋手動標記的 status）
    - APPROVED 且問題清單空：把所有 [ ] 標為 ✅
    """
    checklist_path = paths["checklist_path"]
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

    # 讀取現有 CHECKLIST（解析表格行）
    existing_items = {}  # {id_str: {desc, status, round, evidence}}
    if checklist_path.exists():
        for line in checklist_path.read_text(encoding="utf-8").splitlines():
            m = re.match(
                r"\|\s*(IMP-\d{3})\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|",
                line
            )
            if m:
                imp_id = m.group(1).strip()
                existing_items[imp_id] = {
                    "desc": m.group(2).strip(),
                    "status": m.group(3).strip(),
                    "round": m.group(4).strip(),
                    "evidence": m.group(5).strip(),
                }

    # 合併新條目
    for imp_id, desc in imp_items:
        if imp_id not in existing_items:
            existing_items[imp_id] = {
                "desc": desc,
                "status": "[ ]",
                "round": f"R{round_num:02d}",
                "evidence": "-",
            }
        else:
            # 只更新輪次，不覆蓋 status
            existing_items[imp_id]["round"] = f"R{round_num:02d}"

    # APPROVED 且本輪無新問題 → 把既有 [ ] 標為 ✅
    if verdict == "APPROVED" and not imp_items:
        for imp_id in existing_items:
            if existing_items[imp_id]["status"] == "[ ]":
                existing_items[imp_id]["status"] = "✅"

    # 重建 CHECKLIST.md
    sorted_items = sorted(existing_items.items(), key=lambda x: x[0])

    header = (
        f"# Implementation Checklist\n\n"
        f"> 最後更新：{now} | 當前輪次：Round {round_num:02d} | VERDICT：{verdict}\n"
        f"> stable IDs 跨輪保留，status 每輪更新\n"
        f"> 格式：[ ] = 待處理 | ✅ = 已完成 | ⚠️ = 部分完成\n\n"
        f"| ID | 項目 | Status | 輪次 | Evidence |\n"
        f"|----|------|--------|------|----------|\n"
    )

    rows = ""
    for imp_id, item in sorted_items:
        desc_short = item["desc"][:60]
        rows += f"| {imp_id} | {desc_short} | {item['status']} | {item['round']} | {item['evidence']} |\n"

    if not rows:
        rows = "| - | （本輪無發現問題） | - | - | - |\n"

    footer = (
        "\n---\n\n"
        "## 說明\n\n"
        "- **ID**：`IMP-NNN`（由 OpenAI review 解析，跨輪 stable）\n"
        "- **Status**：由腳本自動更新（APPROVED 時標 ✅）\n"
        "- **Evidence**：指向文件章節或測試結果\n"
        "- **輪次**：最後一次被更新的輪次\n"
    )

    checklist_path.write_text(header + rows + footer, encoding="utf-8")


# ── 文件輸出 ─────────────────────────────────────────────────────────────────

def write_review_file(
    round_num: int, now_ts: str, review_content: str, plan_len: int, paths: dict
) -> Path:
    """寫入 review-{ts}-roundNN.md"""
    reviews_dir = paths["reviews_dir"]
    path = reviews_dir / f"review-{now_ts}-round{round_num:02d}.md"
    path.write_text(
        f"# OpenAI Review — Round {round_num:02d}\n\n"
        f"> 時間：{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
        f"> 模型：{REVIEW_MODEL}\n"
        f"> PLAN.md 字元數：{plan_len}\n\n"
        f"---\n\n"
        f"{review_content}\n",
        encoding="utf-8"
    )
    return path


def write_diff_file(
    round_num: int, diff_text: str, diff_stats: dict, paths: dict
) -> Path:
    """寫入 roundNN-diff.md"""
    reviews_dir = paths["reviews_dir"]
    path = reviews_dir / f"round{round_num:02d}-diff.md"
    diff_body = diff_text if diff_text.strip() else "(第一輪，無前一輪快照)"
    path.write_text(
        f"# Diff — Round {round_num:02d} vs Round {(round_num - 1):02d}\n\n"
        f"> 生成時間：{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n"
        f"## 統計\n\n"
        f"- 新增：+{diff_stats['added']} 行\n"
        f"- 刪除：-{diff_stats['removed']} 行\n"
        f"- 總 diff 行數：{diff_stats['total_lines']}\n"
        f"{'- ⚠️ 已截斷至 ' + str(DIFF_MAX_LINES) + ' 行' if diff_stats.get('truncated') else ''}\n\n"
        f"## Unified Diff\n\n"
        f"```diff\n{diff_body}\n```\n",
        encoding="utf-8"
    )
    return path


def write_summary_file(
    round_num: int, verdict: str, summary_content: str, paths: dict
) -> Path:
    """寫入 roundNN-diff-summary.md"""
    reviews_dir = paths["reviews_dir"]
    path = reviews_dir / f"round{round_num:02d}-diff-summary.md"
    path.write_text(
        f"# Diff Summary — Round {round_num:02d}\n\n"
        f"> 生成時間：{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
        f"> VERDICT：{verdict}\n\n"
        f"---\n\n"
        f"{summary_content}\n",
        encoding="utf-8"
    )
    return path


# ── Decision 輸出 ────────────────────────────────────────────────────────────

def output_decision(
    verdict: str,
    round_num: int,
    review_content: str,
    summary_content: str = "",
    plan_slug: str = "",
) -> None:
    """
    輸出 JSON decision 給 Claude Code
    - APPROVED       → decision: block（附 summary 建議，等待人工確認「開始實作」）
    - NEEDS_REVISION → decision: block（提示修正）
    - BLOCKED        → decision: block（嚴重問題）
    """
    plan_label = f" [{plan_slug}]" if plan_slug else ""

    if verdict == "APPROVED":
        suggestion = summary_content.strip() if summary_content else review_content[-500:]
        decision = {
            "decision": "block",
            "reason": (
                f"[Round {round_num:02d}]{plan_label} ✅ APPROVED — PLAN 品質合格\n\n"
                f"{'='*40}\n"
                f"審稿建議（僅供參考，不強制改動）：\n"
                f"{'='*40}\n"
                f"{suggestion}\n\n"
                f"{'='*40}\n"
                f"請告訴我「開始實作」，Claude 將繼續執行。"
            ),
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": (
                    f"[Round {round_num:02d}]{plan_label} VERDICT=APPROVED, "
                    "waiting for human confirmation"
                )
            }
        }
    else:
        # 提取問題清單（VERDICT 後的內容，最多 800 字）
        after_verdict = re.sub(
            r"^.*?VERDICT:.*?\n", "", review_content, count=1, flags=re.DOTALL
        )[:800]

        decision = {
            "decision": "block",
            "reason": (
                f"[Round {round_num:02d}]{plan_label} VERDICT: {verdict}\n\n"
                f"PLAN 需要修正後才能繼續。\n\n"
                f"{after_verdict}"
            ),
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": (
                    "請依上方問題清單修正 PLAN，"
                    "儲存後系統將自動進入下一輪審稿。"
                    f"（當前輪次：{round_num}/{MAX_ROUNDS}）"
                )
            }
        }

    print(json.dumps(decision, ensure_ascii=False))


# ── 主程式 ───────────────────────────────────────────────────────────────────

def main() -> None:
    # 讀取 hook 輸入
    hook_input = get_hook_input()

    # 過濾：只處理監控目標（docs/plans/*.md 或 docs/PLAN.md）
    is_target, plan_slug = is_target_file(hook_input)
    if not is_target:
        sys.exit(0)

    # 取得 per-plan 路徑
    paths = get_paths(plan_slug)

    # 確保目錄存在
    paths["reviews_dir"].mkdir(parents=True, exist_ok=True)
    paths["snapshots_dir"].mkdir(parents=True, exist_ok=True)
    paths["state_path"].parent.mkdir(parents=True, exist_ok=True)

    # plan_file：優先讀取 docs/plans/{slug}.md，fallback docs/PLAN.md（legacy）
    plan_file = paths["plan_file"]
    if not plan_file.exists():
        plan_file = REPO_ROOT / "docs" / "PLAN.md"
    if not plan_file.exists():
        sys.stderr.write(f"review_plan_loop: plan file for '{plan_slug}' 不存在，跳過\n")
        sys.exit(0)

    # 前置檢查：openai 套件 + API key，缺一則 graceful skip（不消耗 round 計數）
    try:
        import openai as _openai_check  # noqa: F401
    except ImportError:
        sys.stderr.write("review_plan_loop: openai 套件未安裝，跳過審稿（pip install openai）\n")
        sys.exit(0)

    if not os.environ.get("OPENAI_API_KEY", ""):
        sys.stderr.write("review_plan_loop: OPENAI_API_KEY 未設定，跳過審稿\n")
        sys.exit(0)

    # 載入狀態
    state = load_state(paths)

    # 檢查是否超過 MAX_ROUNDS
    if state["round"] >= MAX_ROUNDS:
        sys.stderr.write(
            f"review_plan_loop: [{plan_slug}] 已達最大輪次 {MAX_ROUNDS}，停止自動審稿\n"
        )
        sys.exit(0)

    # 新一輪（通過所有前置檢查後才遞增）
    state["round"] += 1
    round_num = state["round"]
    now_ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")

    sys.stderr.write(f"review_plan_loop v3.0: [{plan_slug}] 開始 Round {round_num:02d}...\n")

    # 讀取當前 PLAN
    current_plan = plan_file.read_text(encoding="utf-8")

    # 讀取前一輪快照
    snapshots_dir = paths["snapshots_dir"]
    prev_snapshot_path = snapshots_dir / f"round{(round_num - 1):02d}.md"
    prev_content = ""
    if prev_snapshot_path.exists():
        prev_content = prev_snapshot_path.read_text(encoding="utf-8")

    # 生成 diff
    diff_text, diff_stats = generate_diff(prev_content, current_plan)

    # 呼叫 OpenAI 審稿
    review_content = call_openai_review(current_plan, diff_text, round_num)

    # 解析 VERDICT 和 IMP 條目
    verdict = parse_verdict(review_content)
    imp_items = parse_imp_ids(review_content)

    # 呼叫 OpenAI 生成摘要
    summary_content = call_openai_summary(diff_text, review_content, round_num)

    # 寫入文件
    review_path = write_review_file(round_num, now_ts, review_content, len(current_plan), paths)
    diff_path = write_diff_file(round_num, diff_text, diff_stats, paths)
    summary_path = write_summary_file(round_num, verdict, summary_content, paths)

    # 更新 CHECKLIST.md
    update_checklist(round_num, verdict, imp_items, paths)

    # 快照（round 編號 + latest 指標）
    snapshot_path = snapshots_dir / f"round{round_num:02d}.md"
    snapshot_path.write_text(current_plan, encoding="utf-8")
    latest_path = snapshots_dir / "latest.md"
    latest_path.write_text(current_plan, encoding="utf-8")

    # 更新狀態
    state["status"] = verdict
    state["last_round_ts"] = now_ts
    state["last_round_files"] = {
        "review": str(review_path.relative_to(REPO_ROOT)),
        "diff": str(diff_path.relative_to(REPO_ROOT)),
        "summary": str(summary_path.relative_to(REPO_ROOT)),
    }
    save_state(state, paths)

    sys.stderr.write(
        f"review_plan_loop: [{plan_slug}] Round {round_num:02d} 完成 — VERDICT={verdict}\n"
        f"  review  → {review_path.relative_to(REPO_ROOT)}\n"
        f"  diff    → {diff_path.relative_to(REPO_ROOT)}\n"
        f"  summary → {summary_path.relative_to(REPO_ROOT)}\n"
    )

    # 輸出 JSON decision
    output_decision(verdict, round_num, review_content, summary_content, plan_slug)
    sys.exit(0)


if __name__ == "__main__":
    main()
