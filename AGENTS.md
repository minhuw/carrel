# Carrel Project Instructions

Carrel is an AI-free desktop code editor derived from Microsoft Code - OSS. Its goal is to be a slim, single-purpose editor: fast to start, calm to look at, and focused on editing, files, search, source control, terminal, and extensions — nothing more. The workbench presents a calmer, more focused experience inspired by the spatial clarity of Cursor.

Carrel must be independently implemented and independently branded. Do not copy proprietary Cursor code or assets, and do not introduce Microsoft or Cursor product names, logos, service credentials, or other protected branding into Carrel releases.

## Product Direction

- Ship no built-in AI, chat, agent, model-provider, or Copilot functionality.
- Ship no built-in debugger or test-runner UI. Carrel is an editor, not an IDE; breakpoints, debug consoles, and test explorers are out of scope (extensions may still provide them).
- Preserve the general extension platform. Carrel itself does not bundle or promote AI extensions.
- Prefer deleting features to adding them. Opinionated cuts (debugger, testing, and future candidates) are made deliberately to keep the product small, fast, and legible; each cut must keep the tree compiling and be measured where practical.
- Develop the workbench layout as a distinct Carrel experience using original code and assets.
- Package the product under the Carrel name with Carrel identifiers, icons, update endpoints, and release channels.
- Use Open VSX or a Carrel-controlled registry instead of the Microsoft Visual Studio Marketplace.
- Keep downstream changes as small and legible as practical so they can follow frequent Code - OSS stable releases.

## Source History

This is a colocated Git and Jujutsu repository. Use `jj` for normal change management; retain Git compatibility for upstream tooling and services that require it.

The permanent downstream stack is:

```text
upstream-stable
└── carrel-project
    └── carrel-ai-removal
        └── carrel-opinion
            └── carrel-layout
                └── carrel
```

The bookmarks have deliberately narrow responsibilities:

- `upstream-stable`: the unmodified stable Code - OSS release used as the current fork point.
- `carrel-project`: project documentation and repository-wide downstream policy.
- `carrel-ai-removal`: removal of built-in AI features and their product contributions.
- `carrel-opinion`: opinionated feature cuts beyond AI (currently: the debugger and the testing feature) that take Carrel toward a slim single-purpose editor. Each cut is an independent, deliberate product decision.
- `carrel-layout`: Carrel workbench layout, interaction, theme, and visual changes.
- `carrel`: branding, packaging, signing, updates, and release automation.

Do not mix work between these stages merely for convenience. If a change belongs to an earlier stage, edit that change and let Jujutsu rebase its descendants:

```bash
jj edit carrel-ai-removal
# make and validate the AI-removal change
jj edit carrel-layout
```

Jujutsu snapshots the working copy automatically. Do not use `git add`, `git commit`, or Git history-rewriting commands for ordinary Carrel development.

## Updating the Code - OSS Base

Microsoft's repository is the `upstream` remote. Reserve `origin` for the Carrel repository. When a new stable Code - OSS release is selected:

```bash
jj git fetch --remote upstream
jj bookmark set upstream-stable -r <stable-tag>
jj rebase -s carrel-project -d upstream-stable
```

Resolve conflicts from the bottom of the stack upward, keeping resolutions inside the stage that owns them. Validate each stage before treating the rebased `carrel` bookmark as releasable. Never modify or rewrite upstream commits.

### Remote Branch Policy

Only `main` is kept in sync with the remote. The stage bookmarks (`carrel-project`, `carrel-ai-removal`, `carrel-opinion`, `carrel-layout`) are local-only structure and are never pushed.

Before moving `main` to a new upstream Code - OSS base, snapshot the previous release line as a versioned branch named after the Carrel version (e.g. `1.132.0` for the line based on Code - OSS 1.132), then let `main` continue on the new base:

```bash
git push origin main:refs/heads/<previous-version>
# rebase the stack onto the new upstream-stable, validate, then
git push origin +carrel:main
```

### Release Automation

Releases are built by `.github/workflows/carrel-release.yml`, which runs **only on version tags** (`v*`) or manual dispatch — never on branch pushes. The jj workflow force-pushes `main` on every rebase, so branch triggers would fire constantly; push a tag deliberately when the stack is releasable:

```bash
git tag v$(python3 -c "import json; print(json.load(open('package.json'))['version'])") carrel
git push origin <tag>
```

The workflow validates that the tag matches `product.json`'s `version`, builds the signed macOS app and all reh server targets on native runners (so server native modules are always correct), publishes the GitHub release, and updates the homebrew cask in `minhuw/homebrew-carrel` (requires a `CARREL_TAP_TOKEN` repo secret with write access to the tap).

## Upstream Engineering Guidance

Unless this file establishes a Carrel-specific policy, continue to follow the upstream Code - OSS architecture, coding, localization, testing, and validation guidance in [Copilot Instructions](.github/copilot-instructions.md). More specific `AGENTS.md` files apply within their directories.
