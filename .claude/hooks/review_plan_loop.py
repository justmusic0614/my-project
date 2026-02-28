#!/usr/bin/env python3
"""
review_plan_loop.py v3.1

Claude Code PostToolUse hook
觸發條件：Write|Edit 工具，且 tool_input.file_path 包含：
  - docs/plans/*.md（新格式，per-plan slug）
  - docs/PLAN.md（legacy 向後相容，slug = "gate-0-review-system"）

功能：
1. 從檔案路徑推斷 plan_slug（e.g. "gate-0-review-system"）
2. Pre-flight Suite（零 API）：結構/語言/複雜度/依賴/過期/測試覆蓋
3. 讀取對應 docs/plans/{slug}.md（或 legacy docs/PLAN.md）
4. 對比前一輪快照 → unified diff
5. 呼叫 OpenAI（REVIEW_MODEL）審稿 → docs/reviews/{slug}/review-{ts}-roundNN.md
6. 呼叫 OpenAI（SUMMARY_MODEL）→ docs/reviews/{slug}/roundNN-diff-summary.md
7. 存 docs/reviews/{slug}/roundNN-diff.md（diff + stats）
8. 更新 docs/reviews/{slug}/CHECKLIST.md（stable IDs，跨輪累積）
9. 快照至 .claude/plan_snapshots/{slug}/roundNN.md + latest.md
10. 計時各步驟 → state.json 儲存 + stderr 輸出（L3-B Timing Profiler）
11. stdout 輸出 JSON decision
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
import time
import datetime
import difflib
import re
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor


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

# Reviewer Personas（L1-B + v3.7 skeptic）
REVIEWER_PERSONAS = {
    "engineer": "你是資深工程師審稿人，重點檢查實作可行性、里程碑具體性、驗收標準可測試性。",
    "security": "你是資安審稿人，重點檢查認證/授權設計、資料保護、注入攻擊面、敏感資料處理。",
    "devops":   "你是 DevOps 審稿人，重點檢查部署方式、回滾計劃、監控指標、服務依賴與 SLA。",
    "pm":       "你是產品經理審稿人，重點檢查用戶影響、商業風險、範圍蔓延、優先級合理性。",
    "skeptic": (
        "你是「SKEPTIC reviewer」，你的工作不是稱讚，而是找出會讓實作失敗/延期/不可驗收的缺口。\n"
        "你特別要抓：\n"
        "- 里程碑是否可驗收（deliverables + Done criteria）\n"
        "- failure modes / rollback / observability（缺任何一項都要提 IMP）\n"
        "- 測試矩陣（至少：happy path、邊界、故障注入/異常）\n"
        "- 介面契約/資料契約是否具體（inputs/outputs/schema）\n"
        "- 任何模糊動詞（優化/改善/提升）未配指標\n"
        "你可以接受 PLAN 可實作，但仍必須提出至少 3 條具體 IMP。"
    ),
}

# Pre-flight Suite 常數（L0）
REQUIRED_SECTIONS = ["## 目標", "## 驗收標準", "## Decision Log"]
FUZZY_VERBS = ["優化", "改善", "提升", "改進", "加強", "完善", "增強"]
PREFLIGHT_EXPIRY_DAYS = 90
COMPLEXITY_GROWTH_THRESHOLD = 0.30  # 超過 30% 成長 → 警告

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


# ── Pre-flight Suite（L0，零 API 前置把關）────────────────────────────────────

def preflight_structure_linter(plan_content: str) -> list[str]:
    """0-A: 檢查必要章節是否存在（阻擋性）"""
    missing = [sec for sec in REQUIRED_SECTIONS if sec not in plan_content]
    return [f"缺少必要章節：{sec}" for sec in missing]


def preflight_language_linter(plan_content: str) -> list[str]:
    """0-B: 偵測目標章節中不帶量化條件的模糊動詞（警告性）"""
    # 提取目標章節（從 ## 目標 到下一個 ## 之前）
    m = re.search(r"## 目標\n(.*?)(?=\n## |\Z)", plan_content, re.DOTALL)
    if not m:
        return []

    target_section = m.group(1)
    warnings = []
    for line in target_section.splitlines():
        for verb in FUZZY_VERBS:
            if verb in line:
                # 同一行是否含量化條件（數字、%、可測指標單位）
                has_metric = bool(
                    re.search(r"\d|%|個|倍|ms\b|秒|分鐘|小時|KB|MB|GB", line)
                )
                if not has_metric:
                    warnings.append(
                        f"目標章節含模糊動詞「{verb}」（無量化條件）："
                        f"{line.strip()[:50]}"
                    )
                    break  # 同一行只報一次
    return warnings


def _calc_complexity(plan_content: str) -> int:
    """計算計劃複雜度指數（里程碑 × 10 + 風險行 × 3 + 字數 / 100）"""
    milestone_count = len(re.findall(r"(?m)^#{1,3}\s+M\d", plan_content))
    if milestone_count == 0:
        # fallback：含「里程碑」或「Milestone」的行
        milestone_count = len(re.findall(r"(?m)^.*(里程碑|Milestone)", plan_content))
    risk_lines = len(re.findall(r"(?m)^.*(風險|[Rr]isk)", plan_content))
    word_count = len(plan_content) // 100
    return milestone_count * 10 + risk_lines * 3 + word_count


def preflight_complexity_budget(plan_content: str, state: dict) -> list[str]:
    """0-C: 相比前輪複雜度成長 > 30% 時警示（警告性）"""
    current = _calc_complexity(plan_content)
    prev = state.get("last_complexity", 0)
    state["last_complexity"] = current  # 更新，稍後 save_state 持久化

    if prev <= 0:
        return []  # 第一輪，無比較基準

    growth = (current - prev) / prev
    if growth > COMPLEXITY_GROWTH_THRESHOLD:
        return [
            f"計劃複雜度成長 {growth:.0%}（{prev} → {current}），"
            f"超過 {COMPLEXITY_GROWTH_THRESHOLD:.0%} 閾值，請確認是否 scope creep"
        ]
    return []


def preflight_dependency_tracking(plan_content: str) -> list[str]:
    """0-D: frontmatter depends_on 的依賴 plan 未 APPROVED 則 block（阻擋性）"""
    # 提取 YAML frontmatter（--- 區塊），用 re 解析，不引入 PyYAML
    m = re.match(r"^---\n(.*?)\n---", plan_content, re.DOTALL)
    if not m:
        return []  # 無 frontmatter，跳過

    frontmatter = m.group(1)
    dep_match = re.search(r"depends_on:\s*\[([^\]]*)\]", frontmatter)
    if not dep_match:
        return []  # 無依賴聲明

    slugs = [
        s.strip().strip("\"'")
        for s in dep_match.group(1).split(",")
        if s.strip()
    ]

    errors = []
    for slug in slugs:
        state_file = REPO_ROOT / ".claude" / "review_states" / f"{slug}.json"
        if not state_file.exists():
            errors.append(f"依賴計劃 '{slug}' 尚未建立（state.json 不存在）")
            continue
        try:
            dep_state = json.loads(state_file.read_text(encoding="utf-8"))
            if dep_state.get("status") != "APPROVED":
                errors.append(
                    f"依賴計劃 '{slug}' 尚未 APPROVED"
                    f"（當前：{dep_state.get('status', 'UNKNOWN')}）"
                )
        except Exception:
            errors.append(f"依賴計劃 '{slug}' state.json 讀取失敗")

    return errors


def parse_reviewers(plan_content: str) -> list:
    """
    解析 PLAN frontmatter 中的 reviewers 欄位（L1-B）。
    格式：reviewers: [engineer, security, devops]
    無 frontmatter 或無 reviewers 欄位時返回 ["engineer", "skeptic"]。
    v3.7：skeptic 永遠強制注入（不受 frontmatter 控制）。
    """
    m = re.match(r"^---\n(.*?)\n---", plan_content, re.DOTALL)
    if not m:
        return ["engineer", "skeptic"]
    frontmatter = m.group(1)
    rev_match = re.search(r"reviewers:\s*\[([^\]]*)\]", frontmatter)
    if not rev_match:
        return ["engineer", "skeptic"]
    slugs = [s.strip().strip("\"'") for s in rev_match.group(1).split(",") if s.strip()]
    valid = [s for s in slugs if s in REVIEWER_PERSONAS]
    reviewers = valid if valid else ["engineer"]
    if "skeptic" not in reviewers:
        reviewers.append("skeptic")
    return reviewers


def preflight_expiry_alert(state: dict) -> list[str]:
    """0-E: PLAN 超過 N 天未重審（警告性，不阻擋）"""
    approved_at = state.get("approved_at", "")
    if not approved_at:
        return []
    try:
        approved_dt = datetime.datetime.fromisoformat(approved_at)
        days = (datetime.datetime.now() - approved_dt).days
        if days > PREFLIGHT_EXPIRY_DAYS:
            return [
                f"PLAN 已 {days} 天未重審"
                f"（APPROVED @ {approved_dt.strftime('%Y-%m-%d')}）"
            ]
    except Exception:
        pass
    return []


def preflight_test_coverage_hint(plan_content: str) -> list[str]:
    """0-F: 驗收標準關鍵字 vs 測試描述匹配（警告性，不阻擋）"""
    m = re.search(r"## 驗收標準\n(.*?)(?=\n## |\Z)", plan_content, re.DOTALL)
    if not m:
        return []

    criteria_text = m.group(1)
    keywords: set[str] = set()
    for line in criteria_text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        # 取中文詞組（2-8 字）或英文單字（4 字以上）
        words = re.findall(r"[\u4e00-\u9fff]{2,8}|\b[A-Za-z]{4,}\b", line)
        keywords.update(words[:3])  # 每行最多 3 個關鍵字

    if not keywords:
        return []

    test_dir = REPO_ROOT / "src" / "test"
    if not test_dir.exists():
        return []

    test_descs: list[str] = []
    for test_file in test_dir.rglob("*.test.js"):
        try:
            content = test_file.read_text(encoding="utf-8", errors="replace")
            descs = re.findall(r'(?:describe|it)\s*\(\s*["\']([^"\']+)', content)
            test_descs.extend(descs)
        except Exception:
            pass

    if not test_descs:
        return []

    all_test_text = " ".join(test_descs).lower()
    uncovered = [kw for kw in sorted(keywords) if kw.lower() not in all_test_text]
    if uncovered:
        return [f"驗收標準關鍵字尚無對應測試：{', '.join(uncovered[:5])}"]
    return []


def run_preflight(
    plan_content: str, paths: dict, state: dict
) -> tuple[list[str], list[str]]:
    """
    執行 Pre-flight Suite（0-A 到 0-F）
    返回 (errors, warnings)：
      errors：阻擋性問題（0-A 結構、0-D 依賴），不消耗 API
      warnings：提示性問題（0-B 語言、0-C 複雜度、0-E 過期、0-F 測試），繼續審稿
    """
    errors: list[str] = []
    warnings: list[str] = []

    errors.extend(preflight_structure_linter(plan_content))           # 0-A 阻擋
    warnings.extend(preflight_language_linter(plan_content))           # 0-B 警告
    warnings.extend(preflight_complexity_budget(plan_content, state))  # 0-C 警告
    errors.extend(preflight_dependency_tracking(plan_content))         # 0-D 阻擋
    warnings.extend(preflight_expiry_alert(state))                     # 0-E 警告
    warnings.extend(preflight_test_coverage_hint(plan_content))        # 0-F 警告

    total = len(errors) + len(warnings)
    if total > 0:
        sys.stderr.write(
            f"[Pre-flight] {len(errors)} 個錯誤，{len(warnings)} 個警告：\n"
        )
        for e in errors:
            sys.stderr.write(f"  ✗ {e}\n")
        for w in warnings:
            sys.stderr.write(f"  ℹ {w}\n")
    else:
        sys.stderr.write("[Pre-flight] ✓ 全部通過\n")

    return errors, warnings


# ── 上一輪 review 檔案查找（v3.8 0-G 使用）────────────────────────────────────

def _find_prev_review(
    state: dict, plan_slug: str, target_round: int = 0
) -> "Path | None":
    """
    找上一輪 review 檔案（v3.9：三層查找，相容新舊 state 結構）。
    target_round：顯式傳入目標輪次（= prev_round），避免靠 state.round 推測出錯。
    """
    last_files = state.get("last_round_files", {})
    # 優先用外部傳入的 target_round；無則 fallback state["round"]
    last_committed_round = target_round if target_round > 0 else state.get("round", 0)

    def _round_key(p: Path) -> int:
        m = re.search(r"-round(\d+)", p.name)
        return int(m.group(1)) if m else 0

    # 方法 1a：新結構 last_round_files["reviews"] map（v3.9）
    # 同時校驗 _round_key 符合 last_committed_round，防止 state 被污染
    reviews_map = last_files.get("reviews", {})
    if reviews_map:
        for preferred in ("skeptic", "engineer"):
            rel = reviews_map.get(preferred)
            if not rel:
                continue
            path = REPO_ROOT / rel
            if path.exists() and (_round_key(path) == last_committed_round or last_committed_round == 0):
                return path
        for _, rel in reviews_map.items():
            path = REPO_ROOT / rel
            if path.exists() and (_round_key(path) == last_committed_round or last_committed_round == 0):
                return path

    # 方法 1b：舊結構 last_round_files["review"]（向後相容）
    if last_files.get("review"):
        path = REPO_ROOT / last_files["review"]
        if path.exists():
            return path

    # 方法 2：glob fallback（int 排序避免 round10 < round2）
    review_dir = REPO_ROOT / "docs" / "reviews" / plan_slug
    if not review_dir.exists():
        return None

    all_matches = sorted(review_dir.glob("review-*-round*.md"), key=_round_key)
    if not all_matches:
        return None

    # 優先：last_committed_round 的 skeptic 或 engineer
    if last_committed_round > 0:
        prev_matches = [p for p in all_matches if _round_key(p) == last_committed_round]
        for preferred in ("skeptic", "engineer"):
            for p in prev_matches:
                if p.name.endswith(f"-{preferred}.md"):
                    return p
        if prev_matches:
            return prev_matches[-1]

    # 最終 fallback：最大 round
    return all_matches[-1]


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


# ── 歷史上下文（L1-A）────────────────────────────────────────────────────────

def build_history_context(round_num: int, paths: dict, n_rounds: int = 3) -> str:
    """
    從過去最多 n_rounds 輪的 review 文件提取歷史摘要（L1-A Context-Aware Review）。
    - NEEDS_REVISION/BLOCKED：列出待解決 IMP IDs
    - APPROVED：標示「本輪已解決」
    - 找不到歷史 → 返回空字串（不影響正常流程）
    """
    if round_num <= 1:
        return ""

    reviews_dir = paths["reviews_dir"]
    if not reviews_dir.exists():
        return ""

    lines = []
    start = max(1, round_num - n_rounds)
    for r in range(start, round_num):
        # v3.9 修正 A：glob 支援 per-persona 後綴（review-*-roundNN-{persona}.md）
        all_candidates = sorted(
            reviews_dir.glob(f"review-*-round{r:02d}*.md"),
            key=lambda p: p.stat().st_mtime, reverse=True
        )
        # 每輪只選一份（優先 skeptic > engineer > 任一），避免多 persona 汙染 context
        candidate = None
        for preferred in ("skeptic", "engineer"):
            for p in all_candidates:
                if p.name.endswith(f"-{preferred}.md"):
                    candidate = p
                    break
            if candidate:
                break
        if not candidate and all_candidates:
            candidate = all_candidates[0]
        if not candidate:
            continue
        try:
            text = candidate.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue

        verdict_m = re.search(r"VERDICT:\s*(APPROVED|NEEDS_REVISION|BLOCKED)", text)
        verdict = verdict_m.group(1) if verdict_m else "UNKNOWN"

        imp_ids = sorted(set(f"IMP-{m}" for m in re.findall(r"\[IMP-(\d{3})\]", text)))

        if verdict == "APPROVED":
            # 區分已 RESOLVED 與仍待追蹤的 IMP（L1-C + L0-X fix）
            resolved_ids = sorted(set(
                f"IMP-{m}" for m in re.findall(r"✅\s*\[IMP-(\d{3})\]\s*RESOLVED:", text)
            ))
            pending_ids = [i for i in imp_ids if i not in resolved_ids]
            res_str = ", ".join(resolved_ids) if resolved_ids else "（無）"
            pend_str = ", ".join(pending_ids) if pending_ids else "（無）"
            lines.append(
                f"  Round {r:02d} VERDICT={verdict}: "
                f"已解決=[{res_str}]  仍待追蹤=[{pend_str}]"
            )
        else:
            imp_str = ", ".join(imp_ids) if imp_ids else "（無）"
            lines.append(f"  Round {r:02d} VERDICT={verdict}: [{imp_str}]")

    if not lines:
        return ""

    return (
        "前輪審稿記要（請聚焦尚未解決的問題，勿重複已解決項）：\n"
        + "\n".join(lines)
    )


# ── OpenAI 呼叫 ──────────────────────────────────────────────────────────────

def call_openai_review(
    plan_content: str, diff_text: str, round_num: int,
    history_context: str = "", persona: str = "engineer"
) -> str:
    """呼叫 OpenAI 進行 PLAN.md 審稿，返回 review 原文。persona 決定審稿視角（L1-B）"""
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

    persona_intro = REVIEWER_PERSONAS.get(persona, REVIEWER_PERSONAS["engineer"])
    prompt = f"""{persona_intro}（Round {round_num:02d}）。
審核以下 PLAN.md，判斷是否達到「可實作」標準。

必須逐一檢查以下 6 點：
1. 目標：是否明確、可量化（非模糊動詞如「優化」「改善」）
2. 範圍/非目標：是否清楚界定邊界
3. 里程碑：是否有具體可驗證的產出物（非純時間點）
4. 風險：是否有概率×影響評估，並列出緩解措施
5. 驗收標準：是否可測試（有明確通過/失敗條件）
6. Decision Log：是否記錄了本輪的決策理由

{f"{history_context}{chr(10)}{chr(10)}" if history_context else ""}本輪 diff（相比前一輪快照的變化）：
```
{diff_section}
```

PLAN.md 完整內容：
---
{truncated_plan}
---

**嚴格遵守以下輸出格式（機器解析，不得改動標題）**：

VERDICT: APPROVED | NEEDS_REVISION | BLOCKED

ISSUES:
- （若有阻擋性問題，每條標 ⚠️ [IMP-NNN]；APPROVED 時可為空）
- ✅ [IMP-NNN] RESOLVED: <已解決說明>（若本輪 diff 修正了前輪 IMP）

IMPROVEMENTS:
- ⚠️ [IMP-NNN] <改進項：補哪段 + 補什麼 + 怎麼驗收（一句話）>
（必須至少 3 條；即使 APPROVED 也需列出，代表下一輪追蹤項）

NOTES:
- （可選補充）

【硬規則】
- IMPROVEMENTS 不得少於 3 條，否則 VERDICT 必須是 NEEDS_REVISION
- 每條 IMP 必須可落地：說明「補哪段」+「補什麼」+「怎麼驗收」，不得寫「更清楚」「更完善」等空泛語句
- [IMP-NNN] ID 若在前輪已出現，沿用相同 ID（跨輪 stable，從 001 開始）
- BLOCKED：嚴重缺失（無目標、無驗收標準等根本性問題）
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
    從 review 內容中解析待解決 [IMP-NNN] 條目（⚠️ 格式）
    返回 list of (id_str, desc_str)，如 [("IMP-001", "缺少驗收標準")]
    """
    pattern = r"[⚠️\*•\-]*\s*\[IMP-(\d{3})\](?!\s*RESOLVED:)\s*(.+?)(?=\n|$)"
    matches = re.findall(pattern, review_content)
    return [(f"IMP-{num}", desc.strip()) for num, desc in matches]


def parse_imp_resolutions(review_content: str) -> dict:
    """
    從 review 內容中解析 IMP 解決 evidence（L1-C）。
    格式：✅ [IMP-NNN] RESOLVED: <evidence>
    返回 {imp_id: evidence_str}，如 {"IMP-001": "新增驗收標準章節"}
    找不到時返回空 dict，不中斷流程。
    """
    pattern = r"✅\s*\[IMP-(\d{3})\]\s*RESOLVED:\s*(.+?)(?=\n|$)"
    matches = re.findall(pattern, review_content)
    return {f"IMP-{num}": desc.strip() for num, desc in matches}


def has_min_imps(review_content: str, k: int = 3) -> bool:
    """
    檢查 review 的 IMPROVEMENTS 區塊是否至少有 k 條 [IMP-N]。
    只看 IMPROVEMENTS 區塊，不計 ISSUES 的 ✅ RESOLVED 行（補丁 B）。
    使用 \\d{1,3} 接受 [IMP-1]～[IMP-999]（補丁 A）。
    """
    m = re.search(r"IMPROVEMENTS:(.*?)(?=\nNOTES:|\nPLAN:|\Z)", review_content, re.DOTALL)
    if not m:
        return False
    return len(re.findall(r"\[IMP-\d{1,3}\]", m.group(1))) >= k


# ── Actionable IMP 品質檢查（v3.8）────────────────────────────────────────────

def extract_improvement_bullets(review_text: str) -> list:
    """從 IMPROVEMENTS 區塊取出每條 bullet（'-' 開頭）。"""
    m = re.search(r"IMPROVEMENTS:(.*?)(?=\nNOTES:|\nPLAN:|\Z)", review_text, re.DOTALL)
    if not m:
        return []
    return [line.strip() for line in m.group(1).splitlines()
            if line.strip().startswith("-")]


_IMP_WHERE  = r"目標|範圍|非目標|里程碑|風險|驗收|decision log|章節|section|##"
_IMP_WHAT   = r"新增|補上|補充|定義|列出|描述|提供|加入|加上|明確|spec|schema|interface"
_IMP_VERIFY = r"驗收|測試|test|case|輸入|輸出|assert|pass criteria|成功條件|done criteria|check"


def is_actionable_imp(line: str) -> bool:
    """
    合格條件（同時符合三項）：
    1. 包含 [IMP-N]（1~3 位數）
    2. 長度 >= 20（避免「更清楚」等極短空泛語句）
    3. 同時命中 Where / What / Verify 三類關鍵詞
    """
    if not re.search(r"\[IMP-\d{1,3}\]", line):
        return False
    if len(line) < 20:
        return False
    return (
        re.search(_IMP_WHERE, line, re.IGNORECASE) is not None
        and re.search(_IMP_WHAT, line, re.IGNORECASE) is not None
        and re.search(_IMP_VERIFY, line, re.IGNORECASE) is not None
    )


def has_actionable_imps(review_text: str, k: int = 3) -> bool:
    """IMPROVEMENTS 區塊中 actionable IMP 數 >= k 才返回 True。"""
    bullets = extract_improvement_bullets(review_text)
    return sum(1 for b in bullets if is_actionable_imp(b)) >= k


# ── IMP Response Matrix helpers（v3.9）───────────────────────────────────────

def get_prev_checklist_open_imps(paths: dict) -> set:
    """
    讀 CHECKLIST.md，回傳 status 為 [ ] 或 ⚠️ 的 IMP IDs（set[str]）。
    找不到或解析失敗 → 回傳空 set（不中斷流程）。
    用 split('|') 解析表格，避免 Evidence 欄有 | 時 regex 出錯。
    動態從 header 行找 Status 欄位 index，未來欄位順序變動不會偏掉。
    """
    checklist_path = paths["checklist_path"]
    if not checklist_path.exists():
        return set()
    open_imps = set()
    status_col = 2  # 預設（ID | 項目 | Status ...）
    try:
        for line in checklist_path.read_text(encoding="utf-8").splitlines():
            if not line.startswith("|"):
                continue
            cols = [c.strip() for c in line.split("|")]
            cols = [c for c in cols if c]  # 去掉 split | 產生的首尾空字串
            if len(cols) < 3:
                continue
            # 分隔行用更保險的判斷（| --- | --- | 也能正確跳過）
            if set(line.replace("|", "").strip()) <= {"-", " "}:
                continue
            # header 行 → 動態更新 status_col
            if cols[0] in ("ID", ""):
                if "Status" in cols:
                    status_col = cols.index("Status")
                continue
            # 資料行
            if re.match(r"IMP-\d+", cols[0]) and len(cols) > status_col:
                imp_id = cols[0]
                status = cols[status_col]
                if status in ("[ ]", "⚠️"):
                    open_imps.add(imp_id)
    except Exception:
        pass
    return open_imps


def build_imp_response_matrix(prev_open_imps: set, all_reviews: dict) -> str:
    """
    比對上輪 open IMPs 是否在本輪 review 有 RESOLVED（v3.9）。
    接受 all_reviews dict，串接所有 persona review 後解析 RESOLVED，
    避免 RESOLVED 只出現在 skeptic 那份時被漏掉。
    """
    if not prev_open_imps:
        return "(no previous open IMPs)"

    combined = "\n".join(all_reviews.values())
    # 放寬 regex：接受 RESOLVED: 或 RESOLVED - 或大小寫
    resolved_ids = set(
        f"IMP-{m}" for m in re.findall(
            r"✅\s*\[IMP-(\d+)\]\s*RESOLVED\s*[:\-]", combined, re.IGNORECASE
        )
    )

    lines = []
    for imp_id in sorted(prev_open_imps):
        if imp_id in resolved_ids:
            lines.append(f"- ✅ {imp_id} — responded")
        else:
            lines.append(f"- ⚠️ {imp_id} — not addressed")
    return "\n".join(lines)


# ── CHECKLIST 管理 ───────────────────────────────────────────────────────────

def update_checklist(
    round_num: int, verdict: str, imp_items: list, paths: dict,
    imp_resolutions: dict = None
) -> None:
    """
    更新 CHECKLIST.md（累積，stable IDs）
    - 新 ID：直接新增
    - 已有 ID：只更新輪次（不覆蓋手動標記的 status）
    - APPROVED 且問題清單空：把所有 [ ] 標為 ✅，並填入 resolution evidence（L1-C）
    """
    if imp_resolutions is None:
        imp_resolutions = {}
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

    # APPROVED → 把「本輪未再提及」的 [ ] 標為 ✅（嚴格模式：本輪仍提及的保持 [ ]）
    if verdict == "APPROVED":
        current_imp_ids = {imp_id for imp_id, _ in imp_items}
        for imp_id in existing_items:
            if existing_items[imp_id]["status"] == "[ ]" and imp_id not in current_imp_ids:
                existing_items[imp_id]["status"] = "✅"
                if imp_id in imp_resolutions:
                    existing_items[imp_id]["evidence"] = imp_resolutions[imp_id][:80]

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

def save_persona_reviews(
    round_num: int, now_ts: str, all_reviews: dict,
    plan_len: int, verdicts_map: dict, paths: dict
) -> dict:
    """
    將各 persona review 分別寫入獨立檔案（v3.9）。
    路徑：docs/reviews/{slug}/review-{ts}-roundNN-{persona}.md
    返回：{persona: str(path)}（相對 REPO_ROOT）
    """
    reviews_dir = paths["reviews_dir"]
    # 用 now_ts 解析人類可讀時間（與檔名 ts 保持一致）
    try:
        now_human = datetime.datetime.strptime(now_ts, "%Y%m%d-%H%M%S").strftime("%Y-%m-%d %H:%M:%S")
    except ValueError:
        now_human = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    result = {}
    for persona, content in all_reviews.items():
        effective_v = verdicts_map.get(persona, "NEEDS_REVISION")
        raw_v = parse_verdict(content)
        # 計算 verdict 被 override 的原因（Suggestion 2）
        if raw_v != effective_v:
            if not has_min_imps(content):
                reason = " (because min_imps<3)"
            elif not has_actionable_imps(content):
                reason = " (because actionable<3)"
            else:
                reason = " (override)"
        else:
            reason = ""
        verdict_line = f"> Effective Verdict: {effective_v}{reason}\n"

        path = reviews_dir / f"review-{now_ts}-round{round_num:02d}-{persona}.md"
        path.write_text(
            f"# OpenAI Review — Round {round_num:02d} [{persona.upper()}]\n\n"
            f"> 時間：{now_human}\n"
            f"> 模型：{REVIEW_MODEL}\n"
            f"> PLAN.md 字元數：{plan_len}\n"
            f"{verdict_line}\n"
            f"---\n\n"
            f"{content}\n",
            encoding="utf-8"
        )
        result[persona] = str(path.relative_to(REPO_ROOT))
    return result


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


# ── Dashboard（v3.9）────────────────────────────────────────────────────────

def write_dashboard(
    plan_slug: str, round_num: int, verdict: str,
    verdicts_map: dict, reviews_map: dict,
    diff_path: "Path | None", summary_path: "Path | None",
    response_matrix_md: str, paths: dict, timing: dict,
    preflight_passed: bool = True,
    gate_passed: bool = True,
    gate_notes: str = ""
) -> Path:
    """
    產出 DASHBOARD.md（每輪覆寫，v3.9）。
    路徑：docs/reviews/{slug}/DASHBOARD.md
    可在 preflight block 以空 reviews_map/verdicts_map 呼叫（minimal DASHBOARD）。
    """
    dashboard_path = paths["reviews_dir"] / "DASHBOARD.md"
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    personas_str = ", ".join(verdicts_map.keys()) if verdicts_map else "-"

    # Round Progress Bar（Suggestion 1 + 雷 2）
    # review_icon 用 artifacts 是否存在推斷，能反映「API 跑了但寫檔掛掉」的情況
    pf_icon     = "✅" if preflight_passed else "❌"
    review_ran  = bool(diff_path or summary_path or reviews_map)
    review_icon = "✅" if review_ran else ("❌" if preflight_passed else "—")
    ag_icon     = "✅" if (gate_passed and preflight_passed) else ("❌" if preflight_passed else "—")
    commit_icon = "✅" if (gate_passed and preflight_passed) else "—"
    progress_bar = (
        f"`[0-G] {pf_icon}  [Review] {review_icon}  "
        f"[Actionable Gate] {ag_icon}  [Commit] {commit_icon}`"
    )

    # Artifacts
    diff_rel = str(diff_path.relative_to(REPO_ROOT)) if diff_path else "-"
    sum_rel  = str(summary_path.relative_to(REPO_ROOT)) if summary_path else "-"
    reviews_lines = "\n".join(
        f"  - {p}: {rp}" for p, rp in reviews_map.items()
    ) if reviews_map else "  - (none)"

    # Verdict by Persona
    verdict_lines = "\n".join(
        f"- {p}: {verdicts_map[p]}" for p in verdicts_map
    ) if verdicts_map else "- (none)"

    # Checklist Snapshot（前 20 條，跳過 header/分隔行）
    checklist_path = paths["checklist_path"]
    if checklist_path.exists():
        try:
            snap_lines = [
                ln for ln in checklist_path.read_text(encoding="utf-8").splitlines()
                if (ln.startswith("|")
                    and not ln.startswith("| ID")
                    and not (set(ln.replace("|", "").strip()) <= {"-", " "}))
            ][:20]
            checklist_snapshot = "\n".join(snap_lines) if snap_lines else "(no items)"
        except Exception:
            checklist_snapshot = "(parse error)"
    else:
        checklist_snapshot = "(no checklist yet)"

    # Timing
    timing_str = (
        f"diff={timing.get('diff', '-')}s  "
        f"review={timing.get('review', '-')}s  "
        f"summary={timing.get('summary', '-')}s  "
        f"total={timing.get('total', '-')}s"
    ) if timing else "-"

    content = (
        f"# Review Dashboard — {plan_slug}\n\n"
        f"> Round: {round_num:02d}\n"
        f"> Verdict: {verdict}\n"
        f"> Personas: {personas_str}\n"
        f"> Updated: {now}\n\n"
        f"## Pipeline\n\n"
        f"{progress_bar}\n\n"
        f"## Artifacts\n\n"
        f"- Diff: {diff_rel}\n"
        f"- Summary: {sum_rel}\n"
        f"- Reviews:\n{reviews_lines}\n\n"
        f"## Verdict by Persona\n\n"
        f"{verdict_lines}\n\n"
        f"## IMP Response Matrix (vs previous round)\n\n"
        f"{response_matrix_md}\n\n"
        f"## Checklist Snapshot (top 20)\n\n"
        f"{checklist_snapshot}\n\n"
        f"## Gate Notes\n\n"
        f"{gate_notes if gate_notes else '- All gates PASSED'}\n"
        f"- Timing: {timing_str}\n"
    )
    dashboard_path.write_text(content, encoding="utf-8")
    return dashboard_path


# ── Status JSON（v4.0）─────────────────────────────────────────────────────

def write_status_json(
    plan_slug: str,
    round_num: int,
    stage: str,
    verdict: str,
    preflight_passed: bool,
    gate_passed: bool,
    personas: list,
    verdicts_map: dict,
    reviews_map: "dict | None",
    diff_path: "Path | None",
    summary_path: "Path | None",
    dashboard_path: "Path | None",
    prev_open_imps: "set | None",
    response_matrix_md: "str | None",
    failed_personas: "list | None",
    timing: dict,
    paths: dict,
    message: str = "",
    timeline_path: "Path | None" = None,
) -> Path:
    """
    覆寫 docs/reviews/{slug}/.status.json（v4.0）。
    atomic write（tmp → replace）避免 watcher 讀到半截。
    stage: "RUNNING" | "PRECHECK_BLOCKED" | "GATE_BLOCKED" | "COMMITTED"
    """
    # updated_at：Asia/Taipei +08:00（不依賴 pytz）
    tz_tw = datetime.timezone(datetime.timedelta(hours=8))
    updated_at = datetime.datetime.now(tz=tz_tw).strftime("%Y-%m-%dT%H:%M:%S+08:00")

    def _rel(p: "Path | None") -> "str | None":
        return str(p.relative_to(REPO_ROOT)) if p else None

    def _ui(s: str, v: str) -> dict:
        if s == "RUNNING":
            return {"icon": "⏳", "color": "yellow",  "label": "Running",           "short": "RUN"}
        if s == "PRECHECK_BLOCKED":
            return {"icon": "⛔", "color": "red",     "label": "Preflight Blocked", "short": "PF-BLOCK"}
        if s == "GATE_BLOCKED":
            return {"icon": "🛑", "color": "red",     "label": "Gate Blocked",      "short": "GATE-BLOCK"}
        if s == "COMMITTED":
            if v == "APPROVED":
                return {"icon": "✅", "color": "green",  "label": "Approved",       "short": "OK"}
            if v == "NEEDS_REVISION":
                return {"icon": "🟡", "color": "yellow", "label": "Needs Revision", "short": "REV"}
            return     {"icon": "🛑", "color": "red",    "label": "Blocked",        "short": "BLK"}
        return {"icon": "❓", "color": "gray", "label": s, "short": (s[:6] if s else "UNK")}

    # IMP matrix 統計（從 response_matrix_md 計算行前綴）
    prev_open_count = len(prev_open_imps) if prev_open_imps else 0
    responded_count = 0
    not_addressed_count = 0
    if response_matrix_md:
        for ln in response_matrix_md.splitlines():
            if ln.startswith("- ✅"):
                responded_count += 1
            elif ln.startswith("- ⚠️"):
                not_addressed_count += 1

    payload = {
        "schema_version": "1",
        "version": "4.0",
        "plan_slug": plan_slug,
        "round": round_num,
        "stage": stage,
        "verdict": verdict,
        "preflight_passed": preflight_passed,
        "gate_passed": gate_passed,
        "personas": list(personas),
        "verdicts_by_persona": dict(verdicts_map),
        "failed_personas": list(failed_personas) if failed_personas else [],
        "ui": _ui(stage, verdict),
        "artifacts": {
            "dashboard":  _rel(dashboard_path),
            "diff":       _rel(diff_path),
            "summary":    _rel(summary_path),
            "reviews":    dict(reviews_map) if reviews_map else None,
            "reviews_dir": str(paths["reviews_dir"].relative_to(REPO_ROOT)),
            "timeline":   _rel(timeline_path),
        },
        "imp_matrix": {
            "prev_open_count":     prev_open_count,
            "responded_count":     responded_count,
            "not_addressed_count": not_addressed_count,
        },
        "timing_sec": {
            "diff":    timing.get("diff"),
            "review":  timing.get("review"),
            "summary": timing.get("summary"),
            "total":   timing.get("total"),
        },
        "updated_at": updated_at,
        "message": message or stage.lower().replace("_", " "),
    }

    status_path = paths["reviews_dir"] / ".status.json"
    # atomic write：先寫 .tmp，再 replace（POSIX atomic）
    tmp = status_path.with_name(status_path.name + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(status_path)
    return status_path


# ── Timeline（v4.0）─────────────────────────────────────────────────────────

def append_timeline_entry(
    plan_slug: str,
    round_num: int,
    stage: str,
    verdict: str,
    verdicts_map: dict,
    reviews_map: "dict | None",
    diff_path: "Path | None",
    summary_path: "Path | None",
    dashboard_path: "Path | None",
    response_matrix_md: "str | None",
    failed_personas: "list | None",
    timing: dict,
    paths: dict,
    note: str = "",
) -> Path:
    """
    在 docs/reviews/{slug}/TIMELINE.md 追加一筆條目（append-only，v4.0）。
    只在終局 stage 呼叫：PRECHECK_BLOCKED / GATE_BLOCKED / COMMITTED。
    不追加 RUNNING（太吵）。
    """
    tz_tw = datetime.timezone(datetime.timedelta(hours=8))
    ts = datetime.datetime.now(tz=tz_tw).strftime("%Y-%m-%d %H:%M:%S+08:00")

    def _r(p: "Path | None") -> str:
        return str(p.relative_to(REPO_ROOT)) if p else "(none)"

    timeline_path = paths["reviews_dir"] / "TIMELINE.md"

    # 首次建立：寫 header
    if not timeline_path.exists():
        timeline_path.write_text(
            f"# Review Timeline — {plan_slug}\n\n"
            f"> append-only. Do not edit past entries unless you know what you are doing.\n\n"
            f"---\n\n",
            encoding="utf-8",
        )

    personas_line = (
        ", ".join(f"{k}={v}" for k, v in verdicts_map.items()) if verdicts_map else "(none)"
    )

    reviews_lines = ""
    if reviews_map:
        for persona, path_str in reviews_map.items():
            reviews_lines += f"  - {persona}: {path_str}\n"
    else:
        reviews_lines = "  (none)\n"

    matrix_block = response_matrix_md.strip() if response_matrix_md else "(N/A)"
    fp_str = ", ".join(failed_personas) if failed_personas else "(none)"

    t = timing or {}

    def _f(x: "object") -> float:
        try:
            return float(x)  # type: ignore[arg-type]
        except Exception:
            return 0.0

    t_str = (
        f"diff={_f(t.get('diff')):.1f}s "
        f"review={_f(t.get('review')):.1f}s "
        f"summary={_f(t.get('summary')):.1f}s "
        f"total={_f(t.get('total')):.1f}s"
    )

    note_line = f"\n> {note}\n" if note else ""
    section = (
        f"## [{ts}] Round {round_num:02d} — {stage} — {verdict}\n"
        f"{note_line}"
        f"- Personas: {personas_line}\n"
        f"- Reviews:\n{reviews_lines}"
        f"- Artifacts:\n"
        f"  - Dashboard: {_r(dashboard_path)}\n"
        f"  - Diff: {_r(diff_path)}\n"
        f"  - Summary: {_r(summary_path)}\n"
        f"- IMP Matrix:\n{matrix_block}\n"
        f"- Failed personas: {fp_str}\n"
        f"- Timing: {t_str}\n\n"
        f"---\n\n"
    )

    with timeline_path.open("a", encoding="utf-8") as f:
        f.write(section)

    return timeline_path


# ── Decision 輸出 ────────────────────────────────────────────────────────────

def output_decision(
    verdict: str,
    round_num: int,
    review_content: str,
    summary_content: str = "",
    plan_slug: str = "",
    preflight_warnings: list | None = None,
) -> None:
    """
    輸出 JSON decision 給 Claude Code
    - APPROVED       → decision: block（附 summary 建議，等待人工確認「開始實作」）
    - NEEDS_REVISION → decision: block（提示修正）
    - BLOCKED        → decision: block（嚴重問題）
    preflight_warnings 若有，附加在 reason 末尾。
    """
    plan_label = f" [{plan_slug}]" if plan_slug else ""

    # 組裝 preflight warnings 段落（若有）
    warn_section = ""
    if preflight_warnings:
        warn_lines = "\n".join(f"  ℹ {w}" for w in preflight_warnings)
        warn_section = f"\n\n[Pre-flight 警告（不影響 VERDICT）]\n{warn_lines}"

    if verdict == "APPROVED":
        suggestion = summary_content.strip() if summary_content else review_content[-500:]
        decision = {
            "decision": "block",
            "reason": (
                f"[Round {round_num:02d}]{plan_label} ✅ APPROVED — PLAN 品質合格\n\n"
                f"{'='*40}\n"
                f"審稿建議（僅供參考，不強制改動）：\n"
                f"{'='*40}\n"
                f"{suggestion}"
                f"{warn_section}\n\n"
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
                f"{warn_section}"
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


# ── 核心審稿流程 ──────────────────────────────────────────────────────────────

def run_review(plan_slug: str, dry_run: bool = False) -> None:
    """
    執行完整審稿流程（Pre-flight + diff + OpenAI review/summary + 輸出 decision）。
    dry_run=True 時：仍寫入 review/diff/summary 文件，但不更新 state/CHECKLIST/snapshot。
    """
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

    # prev_round/candidate_round 模式（v3.8）：state 只在 gate 通過後才 commit
    prev_round = state.get("round", 0)
    candidate_round = prev_round + 1
    round_num = candidate_round  # 後續程式碼沿用 round_num
    now_ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")

    dry_tag = " [DRY-RUN]" if dry_run else ""
    sys.stderr.write(f"review_plan_loop v4.0: [{plan_slug}] 開始 Round {round_num:02d}{dry_tag}...\n")

    # v3.10：RUNNING 狀態（watcher 可見「正在跑」）
    if not dry_run:
        write_status_json(
            plan_slug, round_num, stage="RUNNING",
            verdict="NEEDS_REVISION",
            preflight_passed=True, gate_passed=False,
            personas=[], verdicts_map={}, reviews_map=None,
            diff_path=None, summary_path=None, dashboard_path=None,
            prev_open_imps=None, response_matrix_md=None,
            failed_personas=None, timing={}, paths=paths,
            message="running"
        )

    # 讀取當前 PLAN
    current_plan = plan_file.read_text(encoding="utf-8")

    # ── Pre-flight Suite（L0）─────────────────────────────────────────────────
    preflight_errors, preflight_warnings = run_preflight(current_plan, paths, state)

    if preflight_errors:
        error_lines = "\n".join(f"  ✗ {e}" for e in preflight_errors)
        warn_block = ""
        if preflight_warnings:
            warn_block = "\n\n[警告（修正 errors 後仍會顯示）]\n" + "\n".join(
                f"  ℹ {w}" for w in preflight_warnings
            )
        # 注：prev_round/candidate_round 模式，state 尚未 commit，無需回滾
        if dry_run:
            print(f"[DRY-RUN] Pre-flight 失敗\n{error_lines}{warn_block}")
        else:
            decision = {
                "decision": "block",
                "reason": (
                    f"[Round {round_num:02d}][{plan_slug}] ❌ Pre-flight 失敗（未消耗 API）\n\n"
                    f"以下問題需要先修正：\n{error_lines}"
                    f"{warn_block}\n\n"
                    f"請修正後重新儲存 PLAN。"
                ),
                "hookSpecificOutput": {
                    "hookEventName": "PostToolUse",
                    "additionalContext": "Pre-flight block — 零 API 消耗"
                }
            }
            print(json.dumps(decision, ensure_ascii=False))
        sys.exit(0)

    # ── L0 0-G：上一輪 review IMPs 不 actionable → 直接 block（零 API，v3.8+v3.9）──
    # 6-B：顯式傳 target_round=prev_round，避免靠 state.round 推測出錯
    prev_review_path = _find_prev_review(state, plan_slug, target_round=prev_round)
    if prev_review_path:
        try:
            prev_review_text = prev_review_path.read_text(encoding="utf-8")
            prev_verdict = parse_verdict(prev_review_text)
            if prev_verdict in ("NEEDS_REVISION", "BLOCKED"):
                if not has_actionable_imps(prev_review_text):
                    if not dry_run:
                        # 6-C（雷 2）：0-G block 時也寫 minimal DASHBOARD，pipeline 顯示 [0-G] ❌
                        _gate_notes_0g = (
                            "- 0-G preflight: BLOCKED — prev round IMPs not actionable\n"
                            "- Round NOT started (zero API calls)"
                        )
                        write_dashboard(
                            plan_slug, round_num, verdict="BLOCKED",
                            verdicts_map={}, reviews_map={},
                            diff_path=None, summary_path=None,
                            response_matrix_md="(N/A — preflight blocked)",
                            paths=paths, timing={},
                            preflight_passed=False,
                            gate_notes=_gate_notes_0g
                        )
                        # v4.0：PRECHECK_BLOCKED — timeline + status
                        _timeline_path = append_timeline_entry(
                            plan_slug, round_num, stage="PRECHECK_BLOCKED", verdict="BLOCKED",
                            verdicts_map={}, reviews_map=None,
                            diff_path=None, summary_path=None,
                            dashboard_path=paths["reviews_dir"] / "DASHBOARD.md",
                            response_matrix_md=None, failed_personas=None,
                            timing={}, paths=paths,
                            note="blocked by 0-G preflight (zero API calls)",
                        )
                        write_status_json(
                            plan_slug, round_num, stage="PRECHECK_BLOCKED",
                            verdict="BLOCKED",
                            preflight_passed=False, gate_passed=False,
                            personas=list(parse_reviewers(current_plan)),
                            verdicts_map={}, reviews_map=None,
                            diff_path=None, summary_path=None,
                            dashboard_path=paths["reviews_dir"] / "DASHBOARD.md",
                            prev_open_imps=None, response_matrix_md=None,
                            failed_personas=None, timing={}, paths=paths,
                            message="blocked by 0-G preflight (zero API)",
                            timeline_path=_timeline_path,
                        )
                        decision_0g = {
                            "decision": "block",
                            "reason": (
                                f"[Round {candidate_round:02d}][{plan_slug}] ❌ [0-G] "
                                "上一輪 review 的 IMPROVEMENTS 不含 Where+What+Verify 三要素，"
                                "無法判斷是否為具體可落地的改進項。\n\n"
                                "請先確認 reviewer 輸出格式正確後再重跑（不消耗 API）。"
                            ),
                            "hookSpecificOutput": {
                                "hookEventName": "PostToolUse",
                                "additionalContext": "0-G block — 上一輪 IMPs 不 actionable"
                            }
                        }
                        print(json.dumps(decision_0g, ensure_ascii=False))
                    else:
                        print(f"[DRY-RUN] [0-G] 上一輪 IMPs 不 actionable，實際執行會 block")
                    sys.exit(0)
        except Exception as e:
            sys.stderr.write(f"review_plan_loop: [0-G] 讀取上一輪 review 失敗（跳過）: {e}\n")

    # 讀取前一輪快照
    snapshots_dir = paths["snapshots_dir"]
    prev_snapshot_path = snapshots_dir / f"round{(candidate_round - 1):02d}.md"
    prev_content = ""
    if prev_snapshot_path.exists():
        prev_content = prev_snapshot_path.read_text(encoding="utf-8")

    # ── Timing Profiler（L3-B）────────────────────────────────────────────────
    t_start = time.time()

    # 生成 diff
    diff_text, diff_stats = generate_diff(prev_content, current_plan)
    t_diff = time.time()

    # 建立歷史上下文（L1-A）
    history_context = build_history_context(round_num, paths)

    # 解析 reviewers（L1-B）
    reviewers = parse_reviewers(current_plan)

    # 平行呼叫各 persona（L1-B）
    with ThreadPoolExecutor(max_workers=min(len(reviewers), 4)) as executor:
        futures = {
            p: executor.submit(
                call_openai_review, current_plan, diff_text, round_num, history_context, p
            )
            for p in reviewers
        }
        all_reviews = {}
        for p, f in futures.items():
            try:
                all_reviews[p] = f.result()
            except Exception as e:
                all_reviews[p] = f"VERDICT: NEEDS_REVISION\n\nERROR: persona '{p}' 呼叫失敗 — {e}"

    t_review = time.time()

    # 合併 review 內容（各 persona 以分隔線區分）
    review_content = "\n\n---\n\n".join(
        f"## [{p.upper()} PERSONA]\n\n{content}"
        for p, content in all_reviews.items()
    )

    # 合併 VERDICT（取最嚴格，v3.7+v3.8 兩層保險）
    VERDICT_PRIORITY = {"BLOCKED": 0, "NEEDS_REVISION": 1, "APPROVED": 2}

    def _effective_verdict(r: str) -> str:
        if not has_min_imps(r):         # 保險 1：IMPROVEMENTS 數 < 3
            return "NEEDS_REVISION"
        if not has_actionable_imps(r):  # 保險 2：IMP 不含 Where+What+Verify（v3.8）
            return "NEEDS_REVISION"
        return parse_verdict(r)

    verdicts_map = {p: _effective_verdict(r) for p, r in all_reviews.items()}
    verdict = min(verdicts_map.values(), key=lambda v: VERDICT_PRIORITY.get(v, 1))

    # skeptic ≠ APPROVED → 合併 verdict 不得 APPROVED（v3.7 保險 3）
    if verdicts_map.get("skeptic", "NEEDS_REVISION") != "APPROVED":
        if VERDICT_PRIORITY.get(verdict, 1) > VERDICT_PRIORITY["NEEDS_REVISION"]:
            verdict = "NEEDS_REVISION"

    # 解析 IMP 條目與 resolution evidence（L1-C，從合併文本解析）
    imp_items = parse_imp_ids(review_content)
    imp_resolutions = parse_imp_resolutions(review_content)

    # 呼叫 OpenAI 生成摘要
    summary_content = call_openai_summary(diff_text, review_content, round_num)
    t_summary = time.time()

    # 寫入文件（dry_run 仍寫，方便查看 prompt 效果）
    # 6-A：v3.9 per-persona 分檔（傳 verdicts_map 讓檔頭顯示 Effective Verdict）
    reviews_map = save_persona_reviews(round_num, now_ts, all_reviews, len(current_plan), verdicts_map, paths)
    diff_path = write_diff_file(round_num, diff_text, diff_stats, paths)
    summary_path = write_summary_file(round_num, verdict, summary_content, paths)

    t_end = time.time()

    # 計算各步驟耗時
    timing = {
        "diff":    round(t_diff - t_start, 2),
        "review":  round(t_review - t_diff, 2),
        "summary": round(t_summary - t_review, 2),
        "total":   round(t_end - t_start, 2),
    }

    # 6-D：IMP 回應矩陣（v3.9）
    prev_open_imps = get_prev_checklist_open_imps(paths)
    response_matrix_md = build_imp_response_matrix(prev_open_imps, all_reviews)

    review_lines = "\n".join(
        f"  review [{p}] → {rp}"
        for p, rp in reviews_map.items()
    )
    sys.stderr.write(
        f"review_plan_loop v4.0: [{plan_slug}] Round {round_num:02d} 完成 — VERDICT={verdict}\n"
        f"{review_lines}\n"
        f"  diff    → {diff_path.relative_to(REPO_ROOT)}\n"
        f"  summary → {summary_path.relative_to(REPO_ROOT)}\n"
        f"  dashboard → docs/reviews/{plan_slug}/DASHBOARD.md\n"
        f"  timing: diff={timing['diff']}s  review={timing['review']}s  "
        f"summary={timing['summary']}s  total={timing['total']}s\n"
    )

    if dry_run:
        # 乾跑：不更新 state/CHECKLIST/snapshot
        sys.stderr.write(f"  [DRY-RUN] state/CHECKLIST/snapshot 未更新\n")
        print(f"[DRY-RUN] VERDICT={verdict}\n{summary_content.strip()}")
        sys.exit(0)

    # ── Post-review gate（v3.8 B）：任一 persona IMPs 不 actionable → 無效輪 ──
    failed_personas = [
        p for p, r in all_reviews.items()
        if not has_actionable_imps(r, k=3)
    ]
    if failed_personas:
        failed_str = ", ".join(failed_personas)
        sys.stderr.write(
            f"review_plan_loop: [{plan_slug}] [Post-review gate] "
            f"personas [{failed_str}] IMPs 不含 Where+What+Verify — 本輪視為無效，state 不更新\n"
        )
        gate_decision = {
            "decision": "block",
            "reason": (
                f"[Round {round_num:02d}][{plan_slug}] ❌ [Post-review gate] "
                f"Personas [{failed_str}] 未產生 ≥3 條 actionable IMPs（每條必須含 Where+What+Verify）。\n\n"
                "本輪 review/diff/summary 已寫入磁碟供稽核，但 round 未計入 state。\n"
                "請修正 PLAN prompt 或等候下一次 reviewer 輸出後重跑。"
            ),
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": f"Post-review gate block — personas {failed_str}"
            }
        }
        # 6-E（v3.9）：gate fail 時也寫 DASHBOARD，pipeline 顯示 [Actionable Gate] ❌
        _gate_notes_fail = (
            f"- Post-review gate: BLOCKED — personas [{failed_str}] IMPs not actionable\n"
            "- Round NOT committed to state"
        )
        write_dashboard(
            plan_slug, round_num, verdict, verdicts_map,
            reviews_map, diff_path, summary_path,
            response_matrix_md, paths, timing,
            preflight_passed=True,
            gate_passed=False,
            gate_notes=_gate_notes_fail
        )
        # v4.0：GATE_BLOCKED — timeline + status
        _timeline_path = append_timeline_entry(
            plan_slug, round_num, stage="GATE_BLOCKED", verdict=verdict,
            verdicts_map=verdicts_map, reviews_map=reviews_map,
            diff_path=diff_path, summary_path=summary_path,
            dashboard_path=paths["reviews_dir"] / "DASHBOARD.md",
            response_matrix_md=response_matrix_md,
            failed_personas=failed_personas, timing=timing, paths=paths,
            note=f"blocked by post-review gate: {failed_str}",
        )
        write_status_json(
            plan_slug, round_num, stage="GATE_BLOCKED",
            verdict=verdict,
            preflight_passed=True, gate_passed=False,
            personas=list(all_reviews.keys()),
            verdicts_map=verdicts_map, reviews_map=reviews_map,
            diff_path=diff_path, summary_path=summary_path,
            dashboard_path=paths["reviews_dir"] / "DASHBOARD.md",
            prev_open_imps=prev_open_imps, response_matrix_md=response_matrix_md,
            failed_personas=failed_personas, timing=timing, paths=paths,
            message=f"blocked by post-review gate: {failed_str}",
            timeline_path=_timeline_path,
        )
        print(json.dumps(gate_decision, ensure_ascii=False))
        sys.exit(0)

    # ── Gate 通過：commit state/CHECKLIST/snapshot ──────────────────────────
    # 更新 CHECKLIST.md
    update_checklist(round_num, verdict, imp_items, paths, imp_resolutions)

    # 快照（round 編號 + latest 指標）
    snapshot_path = snapshots_dir / f"round{round_num:02d}.md"
    snapshot_path.write_text(current_plan, encoding="utf-8")
    latest_path = snapshots_dir / "latest.md"
    latest_path.write_text(current_plan, encoding="utf-8")

    # 更新狀態（prev_round/candidate_round 模式：此時才寫入 round）
    state["round"] = candidate_round
    state["status"] = verdict
    state["last_round_ts"] = now_ts
    state["last_timing"] = timing
    # 6-F（v3.9）：state 用新結構 reviews map
    state["last_round_files"] = {
        "reviews": reviews_map,
        "diff": str(diff_path.relative_to(REPO_ROOT)),
        "summary": str(summary_path.relative_to(REPO_ROOT)),
    }
    save_state(state, paths)

    # 6-F（v3.9）：寫最終 DASHBOARD（所有 gate PASS）
    write_dashboard(
        plan_slug, round_num, verdict, verdicts_map,
        reviews_map, diff_path, summary_path,
        response_matrix_md, paths, timing,
        preflight_passed=True,
        gate_passed=True,
        gate_notes="- 0-G preflight: PASS\n- Post-review gate: PASS"
    )

    # v4.0：COMMITTED — timeline + status
    _timeline_path = append_timeline_entry(
        plan_slug, round_num, stage="COMMITTED", verdict=verdict,
        verdicts_map=verdicts_map, reviews_map=reviews_map,
        diff_path=diff_path, summary_path=summary_path,
        dashboard_path=paths["reviews_dir"] / "DASHBOARD.md",
        response_matrix_md=response_matrix_md,
        failed_personas=[], timing=timing, paths=paths,
        note="committed",
    )
    write_status_json(
        plan_slug, round_num, stage="COMMITTED",
        verdict=verdict,
        preflight_passed=True, gate_passed=True,
        personas=list(all_reviews.keys()),
        verdicts_map=verdicts_map, reviews_map=reviews_map,
        diff_path=diff_path, summary_path=summary_path,
        dashboard_path=paths["reviews_dir"] / "DASHBOARD.md",
        prev_open_imps=prev_open_imps, response_matrix_md=response_matrix_md,
        failed_personas=[], timing=timing, paths=paths,
        message="committed",
        timeline_path=_timeline_path,
    )

    # 輸出 JSON decision（帶 preflight_warnings）
    output_decision(verdict, round_num, review_content, summary_content, plan_slug, preflight_warnings)
    sys.exit(0)


# ── 主程式 ───────────────────────────────────────────────────────────────────

def main() -> None:
    # ── CLI 直接觸發模式（L2-C）──────────────────────────────────────────────
    if "--run" in sys.argv:
        idx = sys.argv.index("--run")
        if idx + 1 >= len(sys.argv):
            sys.stderr.write(
                "用法：python3 review_plan_loop.py --run <plan-slug> [--dry-run]\n"
            )
            sys.exit(1)
        slug = sys.argv[idx + 1]
        dry_run = "--dry-run" in sys.argv
        run_review(slug, dry_run=dry_run)
        return

    # ── Hook 模式（從 stdin 讀取）────────────────────────────────────────────
    hook_input = get_hook_input()

    # 過濾：只處理監控目標（docs/plans/*.md 或 docs/PLAN.md）
    is_target, plan_slug = is_target_file(hook_input)
    if not is_target:
        sys.exit(0)

    run_review(plan_slug)


if __name__ == "__main__":
    main()
