/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { isEqualOrParent } from '../../../../../../base/common/resources.js';
import { URI } from '../../../../../../base/common/uri.js';
import { CustomizationType, type URI as ProtocolURI } from '../../../../../../platform/agentHost/common/state/protocol/state.js';
import { customizationId, type ClientPluginCustomization } from '../../../../../../platform/agentHost/common/state/sessionState.js';
import { AICustomizationSource, AICustomizationSources } from '../../../common/aiCustomizationWorkspaceService.js';
import { PromptsType } from '../../../common/promptSyntax/promptTypes.js';
import { IPromptsService, matchesSessionType, PromptsStorage } from '../../../common/promptSyntax/service/promptsService.js';
import { type ICustomizationSyncProvider } from '../../../common/customizationHarnessService.js';
import { IAgentPlugin, IAgentPluginService } from '../../../common/plugins/agentPluginService.js';
import { isContributionEnabled } from '../../../common/enablement.js';
import type { ISyncableFile, ISyncableMcpServer, SyncedCustomizationBundler } from './syncedCustomizationBundler.js';
import { AGENT_HOST_COPILOT_CLI_SESSION_TYPE } from './agentHostToolSetEnablementService.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { isDefined } from '../../../../../../base/common/types.js';

/**
 * Prompt types that participate in auto-sync to an agent host harness.
 *
 * Hooks are intentionally excluded — bundling hooks requires merging into
 * `hooks/hooks.json` (see {@link SyncedCustomizationBundler}).
 */
export const SYNCABLE_PROMPT_TYPES: readonly PromptsType[] = [
	PromptsType.agent,
	PromptsType.skill,
	PromptsType.instructions,
	PromptsType.prompt,
];

/**
 * Storage sources whose contents are auto-synced by default. Remote agent
 * registrations can additionally include user storage.
 *
 * `builtin` only yields skills bundled with the Agents app (e.g. `/create-pr`,
 * `/merge`); for every other prompt type the prompts service returns nothing,
 * and in the regular VS Code workbench window it returns nothing at all.
 */
export const SYNCABLE_STORAGE_SOURCES: readonly PromptsStorage[] = [
	PromptsStorage.plugin,
	PromptsStorage.extension,
	PromptsStorage.builtIn,
];

export interface ILocalCustomizationSyncOptions {
	readonly includeUserStorage?: boolean;
}

export interface ILocalCustomizationFile {
	readonly uri: URI;
	readonly type: PromptsType;
	readonly source: AICustomizationSource;
	readonly disabled: boolean;
	readonly pluginUri?: URI;
	readonly extensionId?: string;
}

/**
 * Enumerates all local customization files eligible for auto-sync to an
 * agent host harness, annotating each with whether the user has opted out.
 *
 * This is the single source of truth used by both the AI Customization view
 * (to render disable affordances) and the agent host wire (to compute the
 * `customizations` set published via `activeClientSet`).
 *
 * Built-in skills bundled with the Agents app (only present when the
 * sessions-aware prompts service is in play) are also enumerated so that
 * `/create-pr`, `/merge`, etc. are available to every agent host without
 * any per-provider plumbing. In the regular VS Code workbench window the
 * built-in lookup returns nothing and this is a no-op.
 */
export async function enumerateLocalCustomizationsForHarness(
	promptsService: IPromptsService,
	syncProvider: ICustomizationSyncProvider,
	sessionType: string,
	token: CancellationToken,
	options?: ILocalCustomizationSyncOptions,
): Promise<readonly ILocalCustomizationFile[]> {
	const result: ILocalCustomizationFile[] = [];
	const storageSources = options?.includeUserStorage
		? [PromptsStorage.user, ...SYNCABLE_STORAGE_SOURCES]
		: SYNCABLE_STORAGE_SOURCES;
	for (const type of SYNCABLE_PROMPT_TYPES) {
		const lists = await Promise.all(
			storageSources.map(storage => promptsService.listPromptFilesForStorage(type, storage, token)),
		);
		for (let i = 0; i < lists.length; i++) {
			const source = storageSources[i];
			for (const file of lists[i]) {
				if (matchesSessionType(file.sessionTypes, sessionType)) {
					result.push({
						uri: file.uri,
						type,
						source,
						pluginUri: file.pluginUri,
						extensionId: file.extension?.identifier.value,
						disabled: syncProvider.isDisabled(file.uri),
					});
				}
			}
		}
	}

	return result;
}

/**
 * Whether folder-root `.mcp.json` servers from *every* workspace folder should
 * be seeded into a session's synced customizations, rather than only the
 * primary (working-directory) folder's — which the SDK already auto-discovers.
 *
 * True only for the local Copilot Agent Host harness, in a multi-root workspace,
 * with the multi-root setting enabled. Kept as a pure function so the gate can
 * be unit-tested independently of {@link AgentHostActiveClientService}'s wiring
 * (a regression here would otherwise leave the feature tests — which call the
 * collector with the flag hardcoded — green).
 */
export function shouldSyncWorkspaceDotMcp(sessionType: string, workspaceFolderCount: number, multiRootSettingEnabled: boolean): boolean {
	return sessionType === AGENT_HOST_COPILOT_CLI_SESSION_TYPE
		&& workspaceFolderCount > 1
		&& multiRootSettingEnabled;
}

/**
 * Resolves the customization refs to include in an `activeClientSet`
 * message.
 *
 * Every eligible local file is synced unless the user opted out. Files
 * belonging to installed plugins are de-duped to a single plugin ref;
 * remaining loose files — together with MCP servers configured directly in
 * VS Code — are bundled into a synthetic Open Plugin.
 */
export async function resolveCustomizationRefs(
	fileService: IFileService,
	promptsService: IPromptsService,
	syncProvider: ICustomizationSyncProvider,
	agentPluginService: IAgentPluginService,
	bundler: SyncedCustomizationBundler,
	sessionType: string,
	options?: ILocalCustomizationSyncOptions,
): Promise<ClientPluginCustomization[]> {
	const enumerated = await enumerateLocalCustomizationsForHarness(promptsService, syncProvider, sessionType, CancellationToken.None, options);
	const enabled = enumerated.filter(e => !e.disabled);

	const plugins = agentPluginService.plugins.get();
	const pluginRefs = new Map<string, Promise<ClientPluginCustomization>>();
	const looseFiles: ISyncableFile[] = [];

	const addPluginRef = (plugin: IAgentPlugin) => {
		const key = plugin.uri.toString();
		if (!pluginRefs.has(key)) {
			const promise = (async (): Promise<ClientPluginCustomization> => {
				let nonce: number | undefined;
				try {
					nonce = (await fileService.stat(plugin.uri)).mtime;
				} catch {
					// ignored, sync will probably fail later though...
				}

				return {
					type: CustomizationType.Plugin,
					id: customizationId(key),
					uri: key as ProtocolURI,
					name: plugin.label,
					nonce: nonce?.toString(16),
					enabled: true,
				};
			})();
			pluginRefs.set(key, promise);
		}
	};

	for (const entry of enabled) {
		if (entry.source === AICustomizationSources.plugin) {
			const plugin = plugins.find(p => isEqualOrParent(entry.uri, p.uri));
			if (!plugin) {
				continue;
			}
			if (syncProvider.isDisabled(plugin.uri)) {
				continue;
			}
			if (!isContributionEnabled(plugin.enablement.get())) {
				continue;
			}
			addPluginRef(plugin);
		} else {
			looseFiles.push({ uri: entry.uri, type: entry.type, source: entry.source, extensionId: entry.extensionId, pluginUri: entry.pluginUri });
		}
	}

	// Plugins that only contribute MCP servers have no prompt files, so they
	// are never surfaced by enumeration above. Include them explicitly so
	// their servers are still synced to the harness.
	for (const plugin of plugins) {
		if (pluginRefs.has(plugin.uri.toString())) {
			continue;
		}
		if (syncProvider.isDisabled(plugin.uri)) {
			continue;
		}
		if (!isContributionEnabled(plugin.enablement.get())) {
			continue;
		}
		if (plugin.mcpServerDefinitions.get().length === 0) {
			continue;
		}
		addPluginRef(plugin);
	}

	const refs: Promise<ClientPluginCustomization | undefined>[] = [...pluginRefs.values()];
	// MCP support has been removed; no locally configured servers are synced.
	const mcpServers: ISyncableMcpServer[] = [];
	if (looseFiles.length > 0 || mcpServers.length > 0) {
		refs.push(bundler.bundle(looseFiles, mcpServers).then(r => r?.ref));
	}
	return await Promise.all(refs).then(r => r.filter(isDefined));
}
