/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { autorun } from '../../../../base/common/observable.js';
import { ILogger, ILoggerService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { IAICustomizationWorkspaceService } from '../../../../workbench/contrib/chat/common/aiCustomizationWorkspaceService.js';
import { IPromptsService, PromptsStorage, IPromptPath } from '../../../../workbench/contrib/chat/common/promptSyntax/service/promptsService.js';
import { PromptsType } from '../../../../workbench/contrib/chat/common/promptSyntax/promptTypes.js';
import { AICustomizationManagementSection } from '../../../../workbench/contrib/chat/browser/aiCustomization/aiCustomizationManagement.js';

const PROMPT_SECTIONS: { section: AICustomizationManagementSection; type: PromptsType }[] = [
	{ section: AICustomizationManagementSection.Agents, type: PromptsType.agent },
	{ section: AICustomizationManagementSection.Skills, type: PromptsType.skill },
	{ section: AICustomizationManagementSection.Instructions, type: PromptsType.instructions },
	{ section: AICustomizationManagementSection.Hooks, type: PromptsType.hook },
];

class CustomizationsDebugLogContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'sessions.customizationsDebugLog';

	private readonly _logger: ILogger;

	constructor(
		@ILoggerService loggerService: ILoggerService,
		@IPromptsService private readonly _promptsService: IPromptsService,
		@IAICustomizationWorkspaceService private readonly _workspaceService: IAICustomizationWorkspaceService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService
	) {
		super();
		this._logger = this._register(loggerService.createLogger('customizationsDebug', { name: 'Customizations Debug' }));

		this._register(this._promptsService.onDidChangeCustomAgents(() => this._logSnapshot()));
		this._register(this._promptsService.onDidChangeSlashCommands(() => this._logSnapshot()));
		this._register(this._workspaceContextService.onDidChangeWorkspaceFolders(() => this._logSnapshot()));
		this._register(autorun(reader => {
			this._workspaceService.activeProjectRoot.read(reader);
			this._logSnapshot();
		}));
	}

	private _pendingSnapshot: Promise<void> | undefined;
	private _snapshotDirty = false;

	private _logSnapshot(): void {
		if (this._pendingSnapshot) {
			this._snapshotDirty = true;
			return;
		}
		this._pendingSnapshot = this._doLogSnapshot().finally(() => {
			this._pendingSnapshot = undefined;
			if (this._snapshotDirty) {
				this._snapshotDirty = false;
				this._logSnapshot();
			}
		});
	}

	private async _doLogSnapshot(): Promise<void> {
		const root = this._workspaceService.getActiveProjectRoot()?.fsPath ?? '(none)';

		this._logger.info('');
		this._logger.info('=== Customizations Snapshot ===');
		this._logger.info(`  Root: ${root}`);
		this._logger.info(`  Sections: ${this._workspaceService.managementSections.join(', ')}`);
		this._logger.info('');

		// Header
		this._logger.info(`  ${'Section'.padEnd(16)} ${'Local'.padStart(6)} ${'User'.padStart(6)} ${'Ext'.padStart(6)} ${'Total'.padStart(7)}`);
		this._logger.info(`  ${'--------'.padEnd(16)} ${'-----'.padStart(6)} ${'----'.padStart(6)} ${'---'.padStart(6)} ${'-----'.padStart(7)}`);

		for (const { section, type } of PROMPT_SECTIONS) {
			await this._logSectionRow(section, type);
		}

		this._logger.info('');

		// Details per section
		for (const { section, type } of PROMPT_SECTIONS) {
			await this._logSectionDetails(section, type);
		}

	}

	private async _logSectionRow(section: AICustomizationManagementSection, type: PromptsType): Promise<void> {
		try {
			const [localFiles, userFiles, extensionFiles] = await Promise.all([
				this._promptsService.listPromptFilesForStorage(type, PromptsStorage.local, CancellationToken.None),
				this._promptsService.listPromptFilesForStorage(type, PromptsStorage.user, CancellationToken.None),
				this._promptsService.listPromptFilesForStorage(type, PromptsStorage.extension, CancellationToken.None),
			]);
			const all: IPromptPath[] = [...localFiles, ...userFiles, ...extensionFiles];
			const local = all.filter(f => f.storage === PromptsStorage.local).length;
			const user = all.filter(f => f.storage === PromptsStorage.user).length;
			const ext = all.filter(f => f.storage === PromptsStorage.extension).length;

			this._logger.info(`  ${section.padEnd(16)} ${String(local).padStart(6)} ${String(user).padStart(6)} ${String(ext).padStart(6)} ${String(all.length).padStart(7)}`);
		} catch {
			this._logger.info(`  ${section.padEnd(16)}  (error)`);
		}
	}

	private async _logSectionDetails(section: AICustomizationManagementSection, type: PromptsType): Promise<void> {
		try {
			// Source folders - where we look for files
			const sourceFolders = await this._promptsService.getSourceFolders(type);
			if (sourceFolders.length > 0) {
				this._logger.info(`  -- ${section} --`);
				this._logger.info(`     Search paths:`);
				for (const sf of sourceFolders) {
					this._logger.info(`       [${sf.storage}] ${sf.uri.fsPath}`);
				}
			}

			const [localFiles, userFiles, extensionFiles] = await Promise.all([
				this._promptsService.listPromptFilesForStorage(type, PromptsStorage.local, CancellationToken.None),
				this._promptsService.listPromptFilesForStorage(type, PromptsStorage.user, CancellationToken.None),
				this._promptsService.listPromptFilesForStorage(type, PromptsStorage.extension, CancellationToken.None),
			]);
			const all: IPromptPath[] = [...localFiles, ...userFiles, ...extensionFiles];

			if (all.length > 0) {
				if (sourceFolders.length === 0) {
					this._logger.info(`  -- ${section} --`);
				}
				this._logger.info(`     Found ${all.length} item(s):`);
				for (const f of all) {
					this._logger.info(`       [${f.storage}] ${f.uri.fsPath}`);
				}
			}

			if (sourceFolders.length > 0 || all.length > 0) {
				this._logger.info('');
			}
		} catch {
			// already logged in row
		}
	}
}

registerWorkbenchContribution2(
	CustomizationsDebugLogContribution.ID,
	CustomizationsDebugLogContribution,
	WorkbenchPhase.AfterRestored,
);
