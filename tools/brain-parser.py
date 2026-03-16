#!/usr/bin/env python3
"""brain-parser: Research Brain Markdown → 結構化 JSON（graph / chunks / index）"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# ─── Constants ───────────────────────────────────────────────────────────────

PARSER_VERSION = "1.0"

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
SCHEMA_PATH = PROJECT_ROOT / "src" / "shared" / "schemas" / "brain_sections.json"

TITLE_RE = re.compile(r"^# (.+)$", re.MULTILINE)
SECTION_RE = re.compile(r"^## (.+)$", re.MULTILINE)
TRIPLE_RE = re.compile(r"\((.+?)\)\s*—\[(.+?)\]→\s*\((.+?)\)")
CONCEPT_RE = re.compile(r"\*\*(.+?)\*\*")
# 表格資料行：| cell1 | cell2 | （跳過分隔線 |---|---|）
TABLE_ROW_RE = re.compile(r"^\|\s*(.+?)\s*\|\s*(.+?)\s*\|", re.MULTILINE)
TABLE_SEP_RE = re.compile(r"^[\s|:-]+$")
# 列表項：- item / * item / 1. item / 1️⃣ item / 任何 emoji+數字 開頭
LIST_ITEM_RE = re.compile(r"^\s*(?:[-*]|\d+[.)]\s*|[\U0001F1E0-\U0001FAFF\u2600-\u27BF\u2000-\u206F]+\s*)(.+)$", re.MULTILINE)
# Source metadata: - Key: Value
SOURCE_KV_RE = re.compile(r"^-\s+([^:]+):\s*(.+)$", re.MULTILINE)


# ─── Parsing ─────────────────────────────────────────────────────────────────

def extract_title(text: str) -> str:
    """抓 # title（第一個 h1）。"""
    m = TITLE_RE.search(text)
    return m.group(1).strip() if m else ""


def parse_source_metadata(section_text: str) -> dict:
    """解析 ## Source 段落的 - Key: Value → {snake_case_key: value}。"""
    meta = {}
    for m in SOURCE_KV_RE.finditer(section_text):
        key = m.group(1).strip().lower().replace("-", "_").replace(" ", "_")
        meta[key] = m.group(2).strip()
    return meta


def split_sections(text: str) -> list[dict]:
    """按 ## heading 分段。僅以 ^## 作為 section 邊界，# title 不算 section。"""
    matches = list(SECTION_RE.finditer(text))
    if not matches:
        return []

    sections = []
    for i, m in enumerate(matches):
        name = m.group(1).strip()
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[start:end].strip()
        # 移除段落間的 --- 分隔線
        body = re.sub(r"^---\s*$", "", body, flags=re.MULTILINE).strip()
        sections.append({"section": name, "text": body})

    return sections


def extract_graph_triples(section_text: str) -> list[dict]:
    """從 Knowledge Graph Triples 段落抽取三元組。"""
    triples = []
    for m in TRIPLE_RE.finditer(section_text):
        triples.append({
            "source": m.group(1).strip(),
            "relation": m.group(2).strip(),
            "target": m.group(3).strip(),
            "source_section": "Knowledge Graph Triples",
        })
    return triples


def extract_concepts(section_text: str) -> list[str]:
    """從 Core Concepts 段落抽取 **粗體** 概念名稱。"""
    return list(dict.fromkeys(c.strip() for c in CONCEPT_RE.findall(section_text)))


def extract_technical_elements(section_text: str) -> list[dict]:
    """從 Technical Elements 段落解析 markdown 表格第一、二欄。跳過表頭和分隔線。"""
    elements = []
    lines = section_text.splitlines()
    header_skipped = False
    for line in lines:
        if not line.strip().startswith("|"):
            continue
        # 跳過分隔線 |---|---|
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if all(TABLE_SEP_RE.match(c) for c in cells):
            header_skipped = True
            continue
        if not header_skipped:
            # 第一個 | 行是表頭，跳過
            header_skipped = True
            continue
        if len(cells) >= 2 and cells[0]:
            elements.append({"name": cells[0], "description": cells[1]})
    return elements


def extract_key_takeaways(section_text: str) -> list[str]:
    """從 Key Takeaways 段落抽取列表項。支援 - / * / 1. / emoji 編號。"""
    items = []
    for m in LIST_ITEM_RE.finditer(section_text):
        item = m.group(1).strip()
        if item:
            items.append(item)
    return items


def validate_sections(found_names: list[str], schema_path: Path) -> list[str]:
    """對照 brain_sections.json 檢查缺失章節。回傳缺失名稱列表。"""
    if not schema_path.exists():
        return []
    try:
        expected = json.loads(schema_path.read_text(encoding="utf-8"))
        if not isinstance(expected, list):
            return []
    except Exception:
        return []
    return [s for s in expected if s not in found_names]


# ─── Build JSON ──────────────────────────────────────────────────────────────

def build_graph_json(
    triples: list[dict],
    metadata: dict,
    title: str,
    doc_id: str,
) -> dict:
    """組裝 graph.json。"""
    nodes = set()
    for t in triples:
        nodes.add(t["source"])
        nodes.add(t["target"])
    return {
        "document_id": doc_id,
        "title": title,
        "metadata": metadata,
        "parser_version": PARSER_VERSION,
        "triples": triples,
        "node_count": len(nodes),
        "edge_count": len(triples),
    }


def build_chunks_json(
    sections: list[dict],
    metadata: dict,
    title: str,
    doc_id: str,
    *,
    include_transcript: bool,
) -> dict:
    """組裝 chunks.json。Source 不作為 chunk。"""
    chunk_meta = {
        "document_id": doc_id,
        "source_basename": metadata.get("source_basename", ""),
        "generated": metadata.get("generated", ""),
        "engine": metadata.get("engine", ""),
    }
    chunks = []
    for s in sections:
        if s["section"] == "Source":
            continue
        if s["section"] == "Transcript" and not include_transcript:
            continue
        chunks.append({
            "section": s["section"],
            "text": s["text"],
            "char_count": len(s["text"]),
            "chunk_metadata": dict(chunk_meta),
        })
    return {
        "document_id": doc_id,
        "title": title,
        "metadata": metadata,
        "parser_version": PARSER_VERSION,
        "chunks": chunks,
        "chunk_count": len(chunks),
    }


def build_index_json(
    sections_map: dict[str, str],
    metadata: dict,
    title: str,
    doc_id: str,
) -> dict:
    """組裝 index.json。"""
    concepts = extract_concepts(sections_map.get("Core Concepts", ""))
    tech = extract_technical_elements(sections_map.get("Technical Elements", ""))
    takeaways = extract_key_takeaways(sections_map.get("Key Takeaways", ""))
    return {
        "document_id": doc_id,
        "title": title,
        "metadata": metadata,
        "parser_version": PARSER_VERSION,
        "concepts": concepts,
        "technical_elements": tech,
        "key_takeaways": takeaways,
        "concept_count": len(concepts),
        "tech_count": len(tech),
        "takeaway_count": len(takeaways),
    }


# ─── I/O ─────────────────────────────────────────────────────────────────────

def save_json(data: dict, path: Path) -> None:
    """寫入 JSON 檔，自動建立父目錄。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def log(msg: str, *, verbose: bool) -> None:
    if verbose:
        print(f"[brain-parser] {msg}", file=sys.stderr)


# ─── CLI ─────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="brain-parser",
        description="Research Brain Markdown → 結構化 JSON（graph / chunks / index）",
    )
    parser.add_argument("input_file", metavar="INPUT_FILE", help="Brain Markdown 檔路徑")
    parser.add_argument("-o", "--output", default="data", help="輸出根目錄（預設: data/）")
    parser.add_argument("--doc-id", help="Document ID（預設: 輸入檔 stem）")
    parser.add_argument("--no-transcript", action="store_true", help="跳過 Transcript chunk")
    parser.add_argument("--verbose", action="store_true", help="顯示解析進度")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    verbose = args.verbose

    # ── 1. 讀取輸入 ─────────────────────────────────────────────────────
    input_path = Path(args.input_file).expanduser().resolve()
    if not input_path.exists():
        print(f"ERROR: 檔案不存在: {input_path}", file=sys.stderr)
        return 1
    if not input_path.is_file():
        print(f"ERROR: 不是檔案: {input_path}", file=sys.stderr)
        return 1

    content = input_path.read_text(encoding="utf-8")
    log(f"Input: {input_path}", verbose=verbose)

    # ── 2. 解析基本資訊 ─────────────────────────────────────────────────
    title = extract_title(content)
    log(f"Title: {title}", verbose=verbose)

    sections = split_sections(content)
    sections_map = {s["section"]: s["text"] for s in sections}
    found_names = [s["section"] for s in sections]

    # 解析 Source metadata
    metadata = parse_source_metadata(sections_map.get("Source", ""))

    # document_id 優先級：--doc-id > markdown Document-ID > 檔名 stem
    doc_id = args.doc_id or metadata.get("document_id", "") or input_path.stem
    log(f"Document ID: {doc_id}", verbose=verbose)

    source_info = metadata.get("source_basename", "unknown")
    source_type = metadata.get("source_type", "unknown")
    engine = metadata.get("engine", "unknown")
    log(f"Source: {source_info} ({source_type}, {engine})", verbose=verbose)

    # ── 3. 驗證章節 ─────────────────────────────────────────────────────
    missing = validate_sections(found_names, SCHEMA_PATH)
    if missing:
        print(f"WARNING: 缺少 {len(missing)} 個章節: {', '.join(missing)}", file=sys.stderr)
    # 不算 Source 和 Transcript（非標準知識章節）
    knowledge_sections = [n for n in found_names if n not in ("Source", "Transcript")]
    log(f"Sections found: {len(found_names)} ({len(knowledge_sections)} knowledge + Source + Transcript)", verbose=verbose)
    if not missing:
        log("Validation: OK (all sections present)", verbose=verbose)

    # ── 4. 抽取 graph triples ──────────────────────────────────────────
    triples = extract_graph_triples(sections_map.get("Knowledge Graph Triples", ""))

    # ── 5. 組裝三種 JSON ───────────────────────────────────────────────
    graph = build_graph_json(triples, metadata, title, doc_id)
    chunks = build_chunks_json(
        sections, metadata, title, doc_id,
        include_transcript=not args.no_transcript,
    )
    index = build_index_json(sections_map, metadata, title, doc_id)

    # log 統計
    log(f"Graph: {len(triples)} triples, {graph['node_count']} nodes", verbose=verbose)
    log(f"Chunks: {chunks['chunk_count']} chunks {'(no transcript)' if args.no_transcript else '(with transcript)'}", verbose=verbose)
    log(f"Index: {index['concept_count']} concepts, {index['tech_count']} tech elements, {index['takeaway_count']} takeaways", verbose=verbose)

    # ── 6. 寫入檔案 ────────────────────────────────────────────────────
    output_dir = Path(args.output)
    name = input_path.stem

    graph_path = output_dir / "graph" / f"{name}.graph.json"
    chunks_path = output_dir / "chunks" / f"{name}.chunks.json"
    index_path = output_dir / "index" / f"{name}.index.json"

    save_json(graph, graph_path)
    save_json(chunks, chunks_path)
    save_json(index, index_path)

    log(f"Output:", verbose=verbose)
    log(f"  {graph_path}", verbose=verbose)
    log(f"  {chunks_path}", verbose=verbose)
    log(f"  {index_path}", verbose=verbose)

    # ── 7. 摘要輸出 ────────────────────────────────────────────────────
    print(f"graph triples: {len(triples)}")
    print(f"chunks: {chunks['chunk_count']}")
    print(f"index: {index['concept_count']} concepts, {index['tech_count']} tech, {index['takeaway_count']} takeaways")
    log("Done.", verbose=verbose)

    return 0


if __name__ == "__main__":
    sys.exit(main())
