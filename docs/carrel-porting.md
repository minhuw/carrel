# Porting Carrel to a new Code - OSS release

Use this checklist with the repository policy in [AGENTS.md](../AGENTS.md). Keep each downstream change in the stage that owns it.

## Keep the stack focused

The stage bookmarks point at stage tips, not necessarily single commits. The current structure is:

```text
carrel-project
└── delete built-in AI feature trees
    └── excise built-in AI source and API references
        └── AI dependencies and build integration (carrel-ai-removal)
            └── remove debugger, testing, and notebooks
                └── remove integrated browser, updates, Microsoft auth, and mermaid (carrel-opinion)
                    └── carrel-layout
                        └── carrel branding, packaging, and release automation
```

Preserve this separation when amending the stack. Whole-tree deletions, source/API excision, and dependency changes have very different conflict behavior and should not be combined into one large commit.

## Rebase and resolve conflicts

1. Archive the previous release line, fetch the new stable tag, and run `git backfill --min-batch-size=1000 --all` before rebasing.
2. Rebase and resolve from the bottom of the stack upward. Do not kill a running `jj rebase`.
3. A file deleted by Carrel may be resolved mechanically as a deletion. For every content conflict, merge upstream's changes with Carrel's edits **per hunk**. Do not replace the whole file with the old Carrel version; that silently drops unrelated upstream fixes.
4. After each stage, and again at the tip, run:

   ```sh
   node scripts/carrel-port-check.mjs
   ```

   This catches new upstream files in removed roots, manifest/lock drift, reintroduced AI dependencies, and conflict markers. Let the compiler find deleted-module imports; do not add a second, fragile import resolver to the script.
5. Regenerate the `pnpm-lock.yaml` of each root whose manifest changed with `pnpm install --lockfile-only`, which resolves without installing packages. Then verify each changed root with `pnpm install --frozen-lockfile --lockfile-only`; `--frozen-lockfile` makes pnpm fail instead of rewriting a lockfile that disagrees with its manifest. Keep native dependencies compatible with Carrel's packaging targets: `@vscode/policy-watcher` remains at 1.4.0 until the macOS deployment floor supports its newer requirements.
6. History-only reorganizations must preserve the tip tree hash. Run the complete validation after every rebase as required by [AGENTS.md](../AGENTS.md#required-release-validation).

## Jujutsu notes

- Moving a bookmark backwards or sideways, such as `upstream-stable` to a new base, needs `jj bookmark set --allow-backwards`.
- Once `main` is pushed, jj treats its commits as immutable; rewriting the stack after that needs `--ignore-immutable`.
- The port check reads git's index, so run it with `@` as an empty change on top of the stage (`jj new <stage>`).

## Validation before release

Use the Node version from `.nvmrc`, then run:

```sh
pnpm install --frozen-lockfile
pnpm run compile
pnpm run electron
./scripts/test.sh --no-sandbox
node --test build/next/test/build-fast.test.ts
node --test scripts/carrel-port-check.test.mjs
node scripts/carrel-port-check.mjs
```

Also check the CLI and all packaging targets:

```sh
(cd cli && cargo check --locked)
for target in desktop server server-web web; do
  node build/next/index.ts bundle --out "../../../../tmp/carrel-$target" --minify --nls --target "$target"
done
```

The relative output path keeps bundle resources out of the repository. Clean any generated artifacts before changing jj revisions. When the tree is releasable, clear divergent commits, push `main`, and deliberately push the matching version tag as described in [AGENTS.md](../AGENTS.md#release-automation).
