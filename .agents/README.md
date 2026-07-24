# AG Kit

AG Kit is a modular `.agents/` toolkit for routing software-engineering tasks to specialist agents, loading focused skills, and verifying changes with executable checks.

## Quick start

1. Copy the `.agents/` directory into a project root.
2. Read `.agents/rules/core-protocol.md` and `.agents/memory/MEMORY.md` at session start.
3. Route work through the matching agent and load only the relevant skill sections.
4. Validate changes before completion:

```bash
python .agents/scripts/checklist.py .
```

For release verification:

```bash
python .agents/scripts/verify_all.py . --url http://localhost:3000
```

To verify AG Kit itself after editing agents, skills, rules, scripts, or links:

```bash
python .agents/scripts/validate_kit.py
```

## Core concepts

- **Agents** define role, boundaries, tools, and skill dependencies.
- **Skills** contain selectively loaded domain knowledge and optional executable scripts.
- **Rules** define workspace-wide precedence and routing behavior.
- **Workflows** provide reusable slash-command procedures.
- **Memory** stores durable project conventions and decisions.
- **Runtime scripts** turn guidance into repeatable evidence.

## Configuration

`mcp_config.json` is valid JSON. Replace `YOUR_API_KEY` before enabling the Context7 MCP server and keep the real credential outside version control whenever your runtime supports environment-based secret injection.

## Documentation

- [Architecture and inventory](ARCHITECTURE.md)
- [Runtime scripts](scripts/README.md)
- [Change history](../CHANGELOG.md)
- [Quick routing reference](rules/quick-reference.md)
