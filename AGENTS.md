<!-- grove:start -->
## Grove workflow

Features move through phased, human-gated steps. Each phase is a `grove-*` skill:

1. **Questions** (`grove-questions`): ticket → scope, neutral research questions, size verdict
2. **Research** (`grove-research`): how the system works today, facts only
3. **Design** (`grove-design`): where we're going; every one-way-door decision chosen explicitly by a human
4. **Structure** (`grove-structure`): ordered, verifiable vertical slices
5. **Plan** (`grove-plan`): detailed execution plan a fresh agent can follow cold
6. **Implement** (`grove-implement`): one slice at a time, human review between slices

### Artifacts

- Config: `grove.config.json`
- Feature folders: `docs/work/<feature-slug>/` (`feature.md`, `00-ticket.md`, `01-questions.md`, `02-research.md`, `03-design.md`, `04-structure.md`, `05-plan.md`, `06-implementation.md`)
- Slug: `<TICKET-ID>-<kebab-name>`, or `<YYYY-MM-DD>-<kebab-name>` with no ticket
- `.html` companions are generated only by `grove-render`, never hand-edited, and not committed
- ADRs: `docs/adr/`. Domain glossary: `CONTEXT.md`
- Tracker: none. `00-ticket.md` is the source of truth

### Gates

- **Hard (block unless `--force <reason>`, recorded in `forced` frontmatter):** structure needs an approved design. Plan needs an approved structure. Implement needs an approved structure and plan.
- **Epics:** plan and implement always refuse on `kind: epic`.
- **Soft (warn, continue):** research without approved questions; design without approved research; starting a child while an earlier sibling hasn't reached implementation.
- **Content:** an artifact can't be approved with non-empty `## Open questions`, any `TODO`/`TBD`, a structure slice without verification, or a design missing chosen options.
- **Staleness:** if an input's `version` is newer than the consumer's `based_on`, stop and tell the human.
- **Approval:** only `grove-approve` sets `status: approved`, and only when the human invokes it directly. Never on a model's own initiative.
<!-- grove:end -->
