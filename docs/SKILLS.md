# SKILLS.md - skills and tools for VaaniEHR

**Status (2026-10-14):** the user approved installing all of section 2. 13 of 14 are installed at project scope in `.agents/skills/` (symlinked into `.claude/skills/`), recorded in `skills-lock.json`. Not installed: `pbakaus/impeccable@audit`, because that skill no longer exists as a separate package. The audit feature is now part of `impeccable`, which is already available (section 1). Registry security scan: all "Safe"; Med Risk for `fhir-ig-analysis`, `healthcare-eval-harness`, `design-doc-mermaid`. Licences are NOT yet recorded: each needs checking and an entry in `docs/SBOM.md` (Rule 6). Install counts are from `npx skills find` on 2026-10-14; I did not inspect the skill sources, so vet each one before approving.

## 1. Already available in this IDE (Claude Code, Code tab)

Invoke with the Skill tool, or type `/<skill-name>`. Plugin skills use `plugin:skill`.

| Skill | Description | Likely phase |
|---|---|---|
| `find-skills` | Searches the open skills registry (`npx skills find`). Installing is a separate step that needs approval. | any |
| `ui-ux-pro-max:ui-ux-pro-max` (also `design`, `design-system`, `ui-styling`) | UI/UX guidance for pages, components, accessibility, responsive layout. | all UI work |
| `impeccable` | Design, critique, audit and polish for frontend interfaces. | UI polish |
| `anthropic-skills:docx`, `pdf`, `pptx`, `xlsx` | Read and produce Office and PDF files. | reading PRD/Researchdoc.pdf, reports |
| `engineering:testing-strategy`, `code-review`, `debug`, `architecture`, `documentation`, `system-design` | Engineering workflows. | planning, QA |
| `security-review`, `code-review`, `simplify` | Review the current diff. | before commits |
| `10x-Team:*` (sde, qa-engineer, security-engineer, dba, principal-architect, ...) | Role-based guidance. | as needed |
| `claude-api` | Claude API and SDK reference. | LLM integration |
| `product-management:write-spec` and similar | PM workflows. | probably unused |
| `brightdata-plugin:*` | Web scraping. Needs network and an API key. | not needed (simulated data only) |

Tools: file read/write/edit, Glob/Grep, PowerShell and Bash, built-in browser pane, Claude-in-Chrome, subagents, scheduled tasks. Several MCP connectors (Linear, Notion, Slack, etc.) need authorisation and are unused.

## 2. Candidates found with find-skills (NOT installed - awaiting approval)

| Area | Skill (`npx skills add ...`) | Source / installs | What it does | Phase | Risk |
|---|---|---|---|---|---|
| docx/pdf | `anthropics/skills@docx` | Anthropic, 200.9K | Docx handling | docs | Already covered by `anthropic-skills:docx`; likely redundant. Can run code. |
| docx/pdf | `firecrawl/anydoc@convert-documents-to-markdown` | firecrawl, 11.6K | Converts documents to markdown | docs | May call an external service. Check before use. |
| FHIR | `anthropics/healthcare@fhir-developer-skill` | Anthropic, 648 | FHIR development guidance | FHIR phase | Low install count. Its guidance does not replace cited sources (Rule 3). Verify the repo before installing. |
| FHIR | `forschungsgruppe-digital-health/agent-skills@fhir-ig-analysis` | 267 | Analyses FHIR implementation guides | FHIR phase | Very low installs. Third-party. |
| Healthcare | `affaan-m/ecc@healthcare-phi-compliance`, `@healthcare-emr-patterns`, `@healthcare-cdss-patterns`, `@healthcare-eval-harness` | affaan-m, ~8K each | PHI compliance, EMR/CDSS patterns, eval harness | design, evaluation | Third-party. CDSS content must not be taken as clinical truth (Rule 3). Read before use. |
| API testing | `antfu/skills@vitest` | antfu, 40.4K | Vitest test guidance | all code phases | Low. Only useful if Vitest is chosen. |
| API testing | `currents-dev/playwright-best-practices-skill@playwright-best-practices` | currents-dev, 93.3K | Playwright E2E guidance | UI testing | Low. No dedicated API-testing skill surfaced. |
| Accessibility | `pbakaus/impeccable@audit` | pbakaus, 81.9K | UI audit | UI phases | Overlaps the installed `impeccable`. |
| Accessibility | `vercel-labs/agent-skills@web-design-guidelines` | Vercel, 732.7K | Web interface guideline review | UI phases | Low. |
| Security | none suitable | - | Results were Azure, Solana and Go specific. | - | Use the installed `security-review` and `10x-Team:security-engineer`. |
| Docker | none suitable | - | Results were Azure or unrelated. | - | Handle Docker directly, or search again with a narrower query. |
| Diagrams | `spillwavesolutions/design-doc-mermaid@design-doc-mermaid` | 70.7K | Mermaid diagrams for design docs | docs | Low. |
| Diagrams | `github/awesome-copilot@excalidraw-diagram-generator` | GitHub, 31.2K | Excalidraw diagrams | docs | Low. |

The `docker` and `diagram` searches mostly returned unrelated results, so I picked the closest matches. Any install should also be added to `docs/SBOM.md` if it ends up in the project toolchain (Rule 6).
