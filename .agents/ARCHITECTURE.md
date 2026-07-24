# AG Kit Architecture

> Comprehensive AI Agent Capability Expansion Toolkit — 2026.7.12

---

## 📋 Overview

AG Kit is a modular system consisting of:

- **20 Specialist Agents** - Role-based AI personas (1 major upgrade in 2026.5.13)
- **47 Skills** - Domain-specific knowledge modules with conditional loading
- **13 Workflows** - Slash command procedures

---

## 🏗️ Directory Structure

```plaintext
.agents/
├── README.md                # Quick start and operating guide
├── ARCHITECTURE.md          # Capability inventory and design
├── CHANGELOG.md             # Version history
├── VERSION                  # Toolkit version
├── agent/                  # 20 Specialist Agents
├── skills/                  # 47 Skills (with conditional loading)
├── workflows/               # 13 Slash Commands
├── rules/                   # Global Rules
├── memory/                  # Persistent Memory (2026.5.13)
└── scripts/                 # Master Validation Scripts
```

---

## 🤖 Agents (20)

Specialist AI personas for different domains.

| Agent                    | Focus                      | Skills Used                                              |
| ------------------------ | -------------------------- | -------------------------------------------------------- |
| `orchestrator`           | Multi-agent coordination   | parallel-agents, coordinator-mode, memory-system, context-compression, verify-changes |
| `project-planner`        | Discovery, task planning   | brainstorming, plan-writing, architecture                |
| `frontend-specialist`    | Web UI/UX                  | frontend-design, nextjs-react-expert, tailwind-patterns |
| `backend-specialist`     | API, business logic        | api-patterns, nodejs-best-practices, database-design     |
| `database-architect`     | Schema, SQL                | database-design                                          |
| `mobile-developer`       | iOS, Android, RN           | mobile-design                                            |
| `game-developer`         | Game logic, mechanics      | game-development                                         |
| `devops-engineer`        | CI/CD, Docker              | deployment-procedures, server-management                 |
| `security-auditor`       | Security compliance        | vulnerability-scanner, red-team-tactics                  |
| `penetration-tester`     | Offensive security         | red-team-tactics                                         |
| `test-engineer`          | Testing strategies         | testing-patterns, tdd-workflow, webapp-testing           |
| `debugger`               | Root cause analysis        | systematic-debugging                                     |
| `performance-optimizer`  | Speed, Web Vitals          | performance-profiling                                    |
| `seo-specialist`         | Ranking, visibility        | seo-fundamentals, geo-fundamentals                       |
| `documentation-writer`   | Manuals, docs              | documentation-templates                                  |
| `product-manager`        | Requirements, user stories | plan-writing, brainstorming                              |
| `product-owner`          | Strategy, backlog, MVP     | plan-writing, brainstorming                              |
| `qa-automation-engineer` | E2E testing, CI pipelines  | webapp-testing, testing-patterns                         |
| `code-archaeologist`     | Legacy code, refactoring   | clean-code, code-review-checklist                        |
| `explorer-agent`         | Codebase analysis          | -                                                        |

---

## 🧩 Skills (47)

Modular knowledge domains that agents can load on-demand based on task context. Each skill has a `when_to_use` frontmatter field for conditional/intelligent loading.

### Frontend & UI

| Skill                   | Description                                                           |
| ----------------------- | --------------------------------------------------------------------- |
| `design-spec`           | DESIGN.md token format — required design source-of-truth before UI    |
| `nextjs-react-expert`   | React & Next.js performance optimization (Vercel - 58 rules)          |
| `frontend-architecture` | Frontend code organization — layers, state tiers, services (React/Vue) |
| `web-design-guidelines` | Web UI audit - 100+ rules for accessibility, UX, performance (Vercel) |
| `tailwind-patterns`     | Tailwind CSS v4 utilities                                             |
| `frontend-design`       | UI/UX patterns, design systems                                        |

### Backend & API

| Skill                   | Description                    |
| ----------------------- | ------------------------------ |
| `api-patterns`          | REST, GraphQL, tRPC            |
| `nodejs-best-practices` | Node.js async, modules         |
| `python-patterns`       | Python standards, FastAPI      |
| `rust-pro`              | Rust async, systems, type system |

### Database

| Skill             | Description                 |
| ----------------- | --------------------------- |
| `database-design` | Schema design, optimization |

### Cloud & Infrastructure

| Skill                   | Description               |
| ----------------------- | ------------------------- |
| `deployment-procedures` | CI/CD, deploy workflows   |
| `server-management`     | Infrastructure management |

### Testing & Quality

| Skill                   | Description              |
| ----------------------- | ------------------------ |
| `testing-patterns`      | Jest, Vitest, strategies |
| `webapp-testing`        | E2E, Playwright          |
| `tdd-workflow`          | Test-driven development  |
| `code-review-checklist` | Code review standards    |
| `lint-and-validate`     | Linting, validation      |

### Security

| Skill                   | Description              |
| ----------------------- | ------------------------ |
| `vulnerability-scanner` | Security auditing, OWASP |
| `red-team-tactics`      | Offensive security       |

### Architecture & Planning

| Skill           | Description                |
| --------------- | -------------------------- |
| `app-builder`   | Full-stack app scaffolding |
| `architecture`  | System design patterns     |
| `plan-writing`  | Task planning, breakdown   |
| `brainstorming` | Socratic questioning       |

### Mobile

| Skill           | Description           |
| --------------- | --------------------- |
| `mobile-design` | Mobile UI/UX patterns |

### Game Development

| Skill              | Description           |
| ------------------ | --------------------- |
| `game-development` | Game logic, mechanics |

### SEO & Growth

| Skill              | Description                   |
| ------------------ | ----------------------------- |
| `seo-fundamentals` | SEO, E-E-A-T, Core Web Vitals |
| `geo-fundamentals` | GenAI optimization            |

### Shell/CLI

| Skill                | Description               |
| -------------------- | ------------------------- |
| `bash-linux`         | Linux commands, scripting |
| `powershell-windows` | Windows PowerShell        |

### Orchestration & Memory (2026.5.13)

| Skill                     | Description                                                 |
| ------------------------- | ----------------------------------------------------------- |
| `coordinator-mode`        | Multi-agent orchestration with parallel workers & synthesis  |
| `memory-system`           | Persistent cross-session memory with MEMORY.md index        |
| `context-compression`     | Auto-compress context in long sessions                      |
| `verify-changes`          | Prove code works by running it, not just inspecting         |
| `batch-operations`        | Multi-file pattern-based modifications                      |
| `simplify-code`           | Reduce over-engineered complexity                           |
| `skillify`                | Auto-create skills from repetitive workflows                |
| `code-review-graph`       | Token-efficient code review via Tree-sitter AST + MCP       |

### Other

| Skill                     | Description               |
| ------------------------- | ------------------------- |
| `clean-code`              | Coding standards (Global) |
| `behavioral-modes`        | Agent personas            |
| `parallel-agents`         | Multi-agent patterns      |
| `mcp-builder`             | Model Context Protocol    |
| `documentation-templates` | Doc formats               |
| `i18n-localization`       | Internationalization      |
| `performance-profiling`   | Web Vitals, optimization  |
| `systematic-debugging`    | Troubleshooting           |
| `intelligent-routing`     | Request → agent routing   |

---

## 🔄 Workflows (13)

Slash command procedures. Invoke with `/command`.

| Command          | Description                                    |
| ---------------- | ---------------------------------------------- |
| `/brainstorm`    | Socratic discovery                             |
| `/coordinate`    | **NEW** Advanced multi-agent coordination      |
| `/create`        | Create new features                            |
| `/debug`         | Debug issues                                   |
| `/deploy`        | Deploy application                             |
| `/enhance`       | Improve existing code                          |
| `/orchestrate`   | Multi-agent coordination                       |
| `/plan`          | Task breakdown                                 |
| `/preview`       | Preview changes                                |
| `/remember`      | **NEW** Save to persistent memory              |
| `/status`        | Check project status                           |
| `/test`          | Run tests                                      |
| `/verify`        | **NEW** Prove code works by running it         |

---

## 🎯 Skill Loading Protocol (Conditional)

```plaintext
User Request → Check `when_to_use` frontmatter → Match? → Load full SKILL.md
                                                    ↓ No match
                                                 Skip (save tokens)
```

### Skill Structure

```plaintext
skill-name/
├── SKILL.md           # (Required) Metadata, when_to_use & instructions
├── scripts/           # (Optional) Python/Bash scripts
├── references/        # (Optional) Templates, docs
└── assets/            # (Optional) Images, logos
```

### Required Frontmatter Fields

```yaml
---
name: skill-name
description: What this skill does
when_to_use: "When to activate. NOT for X."  # 2026.5.13
allowed-tools: Read, Grep, Glob
---
```

### Enhanced Skills (with scripts/references)

| Skill               | Files | Coverage                            |
| ------------------- | ----- | ----------------------------------- |
| `app-builder`       | 20    | Full-stack scaffolding              |

---

## 🛠️ Runtime Scripts

AG Kit includes **5 user-facing top-level utilities**, **1 internal runner module**, and **18 skill-level scripts**.

### Top-level utilities

| Script | Purpose | Typical use |
|---|---|---|
| `scripts/checklist.py` | Fast, priority-ordered validation | During development and pre-commit |
| `scripts/verify_all.py` | Complete verification suite | Before release or deployment |
| `scripts/validate_kit.py` | Self-check the toolkit structure and references | After editing `.agents/` |
| `scripts/session_manager.py` | Summarize project/session context | At session start or status checks |
| `scripts/auto_preview.py` | Start, stop, and inspect local preview servers | UI development |
| `scripts/validation_runner.py` | Shared process runner used by checklist/verify | Internal module; do not invoke directly |

### Usage

```bash
# Validate the toolkit itself
python .agents/scripts/validate_kit.py

# Fast project checks; runtime checks are skipped when no URL is supplied
python .agents/scripts/checklist.py .

# Full verification with a running app and machine-readable report
python .agents/scripts/verify_all.py . \
  --url http://localhost:3000 \
  --report .agents/reports/verification.json
```

### Verification coverage

- Security and secret scanning with blocking exit codes
- Offline dependency/lock-file hygiene
- Linting, type coverage, schema validation, and tests
- UX, accessibility, SEO, GEO, API, mobile, and i18n audits
- Build asset/bundle sizing
- Lighthouse and Playwright runtime checks when a URL is available

For command details and prerequisites, see [scripts/README.md](scripts/README.md).

---

## 📊 Statistics

| Metric              | Value                             |
| ------------------- | --------------------------------- |
| **Total Agents**    | 20 (1 major upgrade in 2026.5.13) |
| **Total Skills**    | 47                                |
| **Total Workflows** | 13 (+2 new in 2026.5.13)          |
| **Top-level Utilities** | 5 user-facing + 1 internal module |
| **Total Skill Scripts** | 18                              |
| **Coverage**        | Web, API, mobile, security, quality, runtime, orchestration |
| **Token Efficiency**| Reduced via conditional skill loading |

---

## 🔗 Quick Reference

| Need     | Agent                 | Skills                                |
| -------- | --------------------- | ------------------------------------- |
| Web App  | `frontend-specialist` | nextjs-react-expert, frontend-design |
| API      | `backend-specialist`  | api-patterns, nodejs-best-practices   |
| Mobile   | `mobile-developer`    | mobile-design                         |
| Database | `database-architect`  | database-design                       |
| Security | `security-auditor`    | vulnerability-scanner                 |
| Testing  | `test-engineer`       | testing-patterns, webapp-testing      |
| Debug    | `debugger`            | systematic-debugging                  |
| Plan     | `project-planner`     | brainstorming, plan-writing           |
