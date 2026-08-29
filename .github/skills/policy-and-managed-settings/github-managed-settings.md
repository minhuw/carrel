# Managed Settings

This file documents the generic managed-settings layer used by configuration policies.
Read [SKILL.md](./SKILL.md) and [vscode-policy.md](./vscode-policy.md) first for the
policy lifecycle, catalog export, and testing requirements.

Managed settings do not introduce a separate policy service. They provide a normalized
bag on `IPolicyData.managedSettings`; a policy's existing `value(policyData)` callback
may read that bag and return a locking value.

## Data model

The shared types live in `src/vs/base/common/policy.ts`:

```ts
export type PolicyValue = string | number | boolean;
export type ManagedSettingValue = PolicyValue;
export type ManagedSettingsData = Readonly<Record<string, ManagedSettingValue>>;

export interface IPolicyData {
    // ...
    readonly managedSettings?: ManagedSettingsData;
}
```

Keys are flat dot-separated paths. Scalar values are stored directly. When a setting's
logical value is structured, the transport carries canonical JSON text and the policy
declares the transport type as `string`; `PolicyConfiguration` parses the value for the
setting when it is read.

## Declaring a managed setting

A policy declares every managed key its `value` callback reads:

```ts
policy: {
    name: 'ExamplePolicy',
    category: PolicyCategory.General,
    minimumVersion: '1.135',
    managedSettings: {
        'example.enabled': { type: 'boolean' },
    },
    value: policyData => policyData.managedSettings?.['example.enabled'],
    localization: { description: { /* ... */ } },
}
```

Rules:

- Declare the exact dot-path consumed by the callback.
- Allowed transport types are `string`, `number`, and `boolean`.
- Return the managed locking value when present and `undefined` otherwise, so ordinary
  configuration resolution can continue.
- Do not coerce mismatched values. Projection intentionally drops undeclared keys and
  values whose runtime type does not match the declaration.
- Structured object or array settings must use a `string` managed-setting declaration
  because their transport representation is JSON text.

## Collection and projection

Policy definitions are the source of truth for the managed keys accepted by the editor.
The policy layer aggregates each definition's `managedSettings` map into a single schema.
Incoming values are projected through that schema before callbacks receive them:

1. Undeclared keys are ignored.
2. Declared values with the wrong scalar type are ignored.
3. Values are validated, not converted.
4. Structured JSON remains a string until configuration parsing reads it for the typed
   setting.

This keeps native policy input and any other managed source consistent with the same
configuration-policy declarations.

## Native managed settings

`NativeManagedSettingsService` in
`src/vs/platform/policy/node/nativeManagedSettingsService.ts` builds the native watcher
schema from the currently registered policy definitions. The service updates its schema
when policy definitions change and publishes a normalized `ManagedSettingsData` bag.
Platforms without a native provider use the null service.

When adding a managed key, do not add an independent watcher entry if a policy can declare
it. Declaration-driven collection prevents the transport schema from drifting away from
the configuration policy.

## Policy references

A policy may govern more than one setting through `policyReference`:

- Exactly one setting owns the complete `policy` definition.
- Other settings may declare `policyReference: { name }`.
- A setting cannot declare both `policy` and `policyReference`.
- Reference setting types must match the owner's type.
- References contain no independent managed-setting callback or metadata; they reuse the
  owner's resolved value.

See [vscode-policy.md](./vscode-policy.md) for catalog and export details.

## Validation checklist

1. Add or update the configuration policy and its `managedSettings` declaration.
2. Add focused tests for collection, type projection, and the policy callback.
3. Run `npm run typecheck-client`.
4. Run `npm run export-policy-data` for any policy catalog change; never hand-edit
   `build/lib/policies/policyData.jsonc`.
5. Verify the exported policy data and the relevant policy-service tests.

Trust executable source and tests over this guide when implementation details change.
