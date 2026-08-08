---
name: policy-and-managed-settings
description: Use when adding or changing an editor or extension setting's `policy:` field, or reviewing enterprise policy for a configuration setting. Start here to choose between configuration policy and extension-provided policy.
---

# Enterprise Policy

Carrel exposes enterprise policy for editor and extension settings. Route a control by where the governed behavior is implemented.

| Governed behavior | Destination | Guide |
|---|---|---|
| VS Code editor or workbench | Configuration `policy:` | [vscode-policy.md](./vscode-policy.md) |
| Extension-contributed setting | `extensionConfigurationPolicy` in `product.json` | [extension-policy.md](./extension-policy.md) |

## Rules

- Give every policy a unique PascalCase `name` and localize its description.
- Never log raw policy values or add telemetry containing them.
- Trust source and tests over these docs. Document decisions and invariants; link to source instead of copying it.

## Policy-disabled UI

Prefer an option that stays visible but disabled, with the managed-policy indicator, a localized reason, and an accessible next step, over silently hiding it ([design guidance](../design-philosophy/SKILL.md#make-unavailable-features-understandable)). Use policy provenance to distinguish prohibition from unsupported, feature-gated, or pending states. Presentation never changes authorization: a disabled option must not bypass the setting's validation. Test policy refresh and removal, keyboard and pointer activation, and stale menus.
