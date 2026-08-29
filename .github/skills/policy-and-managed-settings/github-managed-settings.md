# Managed Settings



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

