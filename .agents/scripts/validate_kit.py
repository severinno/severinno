#!/usr/bin/env python3
"""Self-validate an AG Kit installation.

Checks machine-readable configuration, frontmatter contracts, cross references,
local Markdown links, Python syntax, and architecture inventory counts.
"""
from __future__ import annotations

import argparse
import ast
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote

try:
    import yaml  # type: ignore
except ImportError:  # pragma: no cover - optional enhancement
    yaml = None


@dataclass
class Finding:
    severity: str
    code: str
    file: str
    line: int
    message: str


REQUIRED_FIELDS = {
    "agent": {"name", "description", "tools", "model", "skills"},
    "skill": {"name", "description", "when_to_use", "allowed-tools"},
    "rule": {"trigger"},
}


def add(findings: list[Finding], severity: str, code: str, path: Path, message: str, line: int = 1) -> None:
    findings.append(Finding(severity, code, path.as_posix(), line, message))


def extract_frontmatter(path: Path) -> tuple[str | None, int]:
    text = path.read_text("utf-8", errors="replace")
    if not text.startswith("---\n"):
        return None, 1
    end = text.find("\n---\n", 4)
    if end < 0:
        return None, 1
    return text[4:end], 1


def fallback_frontmatter(raw: str) -> dict[str, object]:
    data: dict[str, object] = {}
    for line in raw.splitlines():
        if not line or line[0].isspace() or line.lstrip().startswith("#"):
            continue
        match = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
        if not match:
            continue
        key, value = match.groups()
        value = value.strip().strip('"\'')
        if key == "skills":
            data[key] = [part.strip() for part in value.split(",") if part.strip()]
        else:
            data[key] = value
    return data


def parse_frontmatter(path: Path, findings: list[Finding]) -> dict[str, object] | None:
    raw, _ = extract_frontmatter(path)
    if raw is None:
        add(findings, "error", "frontmatter.missing", path, "Missing or unterminated YAML frontmatter")
        return None
    if yaml is None:
        return fallback_frontmatter(raw)
    try:
        data = yaml.safe_load(raw)
    except Exception as exc:
        line = int(getattr(getattr(exc, "problem_mark", None), "line", 0)) + 2
        add(findings, "error", "frontmatter.invalid_yaml", path, str(exc), line)
        return None
    if not isinstance(data, dict):
        add(findings, "error", "frontmatter.not_mapping", path, "Frontmatter must be a YAML mapping")
        return None
    return data


def validate_json(root: Path, findings: list[Finding]) -> None:
    for path in root.rglob("*.json"):
        if "__pycache__" in path.parts:
            continue
        try:
            json.loads(path.read_text("utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            line = int(getattr(exc, "lineno", 1))
            add(findings, "error", "json.invalid", path.relative_to(root), str(exc), line)


def validate_frontmatter(root: Path, findings: list[Finding]) -> tuple[dict[str, dict[str, object]], dict[str, dict[str, object]]]:
    agents: dict[str, dict[str, object]] = {}
    skills: dict[str, dict[str, object]] = {}
    groups = (
        ("agent", sorted((root / "agent").glob("*.md"))),
        ("skill", sorted((root / "skills").glob("*/SKILL.md"))),
        ("rule", sorted((root / "rules").glob("*.md"))),
    )
    for kind, paths in groups:
        names_seen: set[str] = set()
        for path in paths:
            rel = path.relative_to(root)
            data = parse_frontmatter(rel if False else path, findings)
            if data is None:
                continue
            missing = REQUIRED_FIELDS[kind] - set(data)
            for field in sorted(missing):
                add(findings, "error", "frontmatter.required_field", rel, f"Missing required field: {field}")
            name = str(data.get("name", ""))
            expected = path.stem if kind == "agent" else path.parent.name if kind == "skill" else ""
            if expected and name != expected:
                add(findings, "error", "frontmatter.name_mismatch", rel, f"name={name!r}, expected {expected!r}")
            if name:
                if name in names_seen:
                    add(findings, "error", "frontmatter.duplicate_name", rel, f"Duplicate {kind} name: {name}")
                names_seen.add(name)
            if kind == "agent":
                agents[expected] = data
            elif kind == "skill":
                skills[expected] = data
    return agents, skills


def normalize_skills(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        return [item.strip() for item in value.split(",") if item.strip()]
    return []


def validate_references(root: Path, agents: dict[str, dict[str, object]], skills: dict[str, dict[str, object]], findings: list[Finding]) -> None:
    for agent_name, data in agents.items():
        path = Path("agent") / f"{agent_name}.md"
        for skill in normalize_skills(data.get("skills")):
            if skill not in skills:
                add(findings, "error", "reference.unknown_skill", path, f"Agent references missing skill: {skill}")

    script_pattern = re.compile(r'["\']((?:skills|scripts)/[^"\']+?\.py)["\']')
    for path in (root / "scripts").glob("*.py"):
        text = path.read_text("utf-8", errors="replace")
        for match in script_pattern.finditer(text):
            target = root / match.group(1)
            if not target.is_file():
                line = text.count("\n", 0, match.start()) + 1
                add(findings, "error", "reference.missing_script", path.relative_to(root), f"Referenced script does not exist: {match.group(1)}", line)


def validate_markdown_links(root: Path, findings: list[Finding]) -> None:
    pattern = re.compile(r"!?\[[^\]]*\]\(([^)]+)\)")
    for path in root.rglob("*.md"):
        text = path.read_text("utf-8", errors="replace")
        for match in pattern.finditer(text):
            raw = match.group(1).strip()
            if not raw:
                continue
            target_text = raw.split()[0].strip("<>")
            if target_text.startswith(("#", "http://", "https://", "mailto:", "tel:", "data:")):
                continue
            target_text = unquote(target_text.split("#", 1)[0])
            if not target_text:
                continue
            target = (path.parent / target_text).resolve()
            try:
                target.relative_to(root.resolve())
            except ValueError:
                continue
            # Documentation template links are examples, not toolkit dependencies.
            if path.relative_to(root).as_posix() == "skills/documentation-templates/SKILL.md" and target_text.startswith("./docs/"):
                continue
            if not target.exists():
                line = text.count("\n", 0, match.start()) + 1
                add(findings, "error", "markdown.missing_link", path.relative_to(root), f"Missing local target: {target_text}", line)


def validate_python(root: Path, findings: list[Finding]) -> None:
    for path in root.rglob("*.py"):
        if "__pycache__" in path.parts:
            continue
        try:
            ast.parse(path.read_text("utf-8"), filename=str(path))
        except (OSError, SyntaxError) as exc:
            add(findings, "error", "python.syntax", path.relative_to(root), str(exc), int(getattr(exc, "lineno", 1) or 1))


def validate_architecture_counts(root: Path, findings: list[Finding]) -> None:
    path = root / "ARCHITECTURE.md"
    if not path.is_file():
        add(findings, "error", "architecture.missing", Path("ARCHITECTURE.md"), "ARCHITECTURE.md is missing")
        return
    text = path.read_text("utf-8", errors="replace")
    actual = {
        "agents": len(list((root / "agent").glob("*.md"))),
        "skills": len(list((root / "skills").glob("*/SKILL.md"))),
        "workflows": len(list((root / "workflows").glob("*.md"))),
        "skill_scripts": len(list((root / "skills").glob("*/scripts/*.py"))),
    }
    patterns = {
        "agents": r"\*\*Total Agents\*\*\s*\|\s*(\d+)",
        "skills": r"\*\*Total Skills\*\*\s*\|\s*(\d+)",
        "workflows": r"\*\*Total Workflows\*\*\s*\|\s*(\d+)",
        "skill_scripts": r"\*\*Total Skill Scripts\*\*\s*\|\s*(\d+)",
    }
    for key, pattern in patterns.items():
        match = re.search(pattern, text)
        if not match:
            add(findings, "error", "architecture.count_missing", Path("ARCHITECTURE.md"), f"Missing inventory field for {key}")
        elif int(match.group(1)) != actual[key]:
            add(findings, "error", "architecture.count_mismatch", Path("ARCHITECTURE.md"), f"{key}: documented {match.group(1)}, actual {actual[key]}")


def validate(root: Path) -> list[Finding]:
    findings: list[Finding] = []
    validate_json(root, findings)
    agents, skills = validate_frontmatter(root, findings)
    validate_references(root, agents, skills, findings)
    validate_markdown_links(root, findings)
    validate_python(root, findings)
    validate_architecture_counts(root, findings)
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate AG Kit structure and cross references")
    parser.add_argument("path", nargs="?", default=None, help="Path to .agents (defaults to this toolkit)")
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args()
    root = Path(args.path).resolve() if args.path else Path(__file__).resolve().parents[1]
    if not root.is_dir():
        parser.error(f"Toolkit directory does not exist: {root}")
    findings = validate(root)
    errors = [item for item in findings if item.severity == "error"]
    warnings = [item for item in findings if item.severity == "warning"]
    payload = {
        "toolkit": str(root),
        "passed": not errors,
        "summary": {"errors": len(errors), "warnings": len(warnings)},
        "findings": [item.__dict__ for item in findings],
    }
    if args.as_json:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    else:
        print(f"AG Kit self-validation: {root}")
        for item in findings:
            print(f"[{item.severity.upper()}] {item.file}:{item.line} {item.code} - {item.message}")
        print(f"Summary: {len(errors)} error(s), {len(warnings)} warning(s)")
        print("[PASS] Toolkit is structurally valid." if not errors else "[FAIL] Toolkit validation failed.")
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
