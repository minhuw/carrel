/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, clearNode, EventType, h } from '../../../../base/browser/dom.js';
import { KeybindingLabel } from '../../../../base/browser/ui/keybindingLabel/keybindingLabel.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { isWeb, OS } from '../../../../base/common/platform.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize } from '../../../../nls.js';
import { HiddenItemStrategy, MenuWorkbenchToolBar } from '../../../../platform/actions/browser/toolbar.js';
import { MenuId } from '../../../../platform/actions/common/actions.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ContextKeyExpr, ContextKeyExpression, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IStorageService, StorageScope, StorageTarget, WillSaveStateReason } from '../../../../platform/storage/common/storage.js';
import { defaultKeybindingLabelStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';

interface WatermarkEntry {
	readonly id: string;
	readonly icon: ThemeIcon;
	readonly label: string;
	readonly description: string;
	readonly when?: {
		native?: ContextKeyExpression;
		web?: ContextKeyExpression;
	};
}

const openFile: WatermarkEntry = {
	id: 'workbench.action.files.openFile',
	icon: Codicon.goToFile,
	label: localize('watermark.openFile', "Open File"),
	description: localize('watermark.openFile.description', "Open a file from disk"),
};

const openFolder: WatermarkEntry = {
	id: 'workbench.action.files.openFolder',
	icon: Codicon.folderOpened,
	label: localize('watermark.openFolder', "Open Folder"),
	description: localize('watermark.openFolder.description', "Open a folder to start working"),
};

const newUntitledFile: WatermarkEntry = {
	id: 'workbench.action.files.newUntitledFile',
	icon: Codicon.newFile,
	label: localize('watermark.newUntitledFile', "New File"),
	description: localize('watermark.newUntitledFile.description', "Create a new untitled text file"),
};

const showCommands: WatermarkEntry = {
	id: 'workbench.action.showCommands',
	icon: Codicon.keyboard,
	label: localize('watermark.showCommands', "Show All Commands"),
	description: localize('watermark.showCommands.description', "Run any command from the Command Palette"),
};

const openTerminal: WatermarkEntry = {
	id: 'workbench.action.terminal.new',
	icon: Codicon.terminal,
	label: localize('watermark.openTerminal', "Open Terminal"),
	description: localize('watermark.openTerminal.description', "Open a new integrated terminal"),
	when: { web: ContextKeyExpr.equals('terminalProcessSupported', true) },
};

const cloneRepository: WatermarkEntry = {
	id: 'git.clone',
	icon: Codicon.repoClone,
	label: localize('watermark.cloneRepository', "Clone Repository"),
	description: localize('watermark.cloneRepository.description', "Clone a Git repository from a remote"),
};

const emptyWindowEntries: WatermarkEntry[] = [
	openFile,
	openFolder,
	newUntitledFile,
	showCommands,
	openTerminal,
	cloneRepository,
];

const workspaceEntries: WatermarkEntry[] = [
	openFile,
	newUntitledFile,
	showCommands,
	openTerminal,
];

export class EditorGroupWatermark extends Disposable {

	private static readonly CACHED_WHEN = 'editorGroupWatermark.whenConditions';
	private static readonly SETTINGS_KEY = 'workbench.tips.enabled';

	private readonly cachedWhen: { [when: string]: boolean };

	private readonly cards: HTMLElement;
	private readonly toolbarContainer: HTMLElement;
	private readonly transientDisposables = this._register(new DisposableStore());
	private readonly keybindingLabels = this._register(new DisposableStore());

	private enabled = false;
	private workbenchState: WorkbenchState;

	constructor(
		container: HTMLElement,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IStorageService private readonly storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ICommandService private readonly commandService: ICommandService,
		@IQuickInputService private readonly quickInputService: IQuickInputService
	) {
		super();

		this.cachedWhen = this.storageService.getObject(EditorGroupWatermark.CACHED_WHEN, StorageScope.PROFILE, Object.create(null));
		this.workbenchState = this.contextService.getWorkbenchState();

		const searchLabel = localize('watermark.searchCommands', "Type to search commands");

		const elements = h('.editor-group-watermark-wrapper', [
			h('.editor-group-watermark-toolbar-container@toolbarContainer'),
			h('.editor-group-watermark', [
				h('.watermark-container', [
					h('.letterpress'),
					h('.watermark-body', [
						h('.watermark-cards@cards'),
						h('.watermark-search', [
							h('input@searchInput', { type: 'text', placeholder: searchLabel, 'aria-label': searchLabel }),
						]),
					]),
				])
			])
		]);

		append(container, elements.root);
		this.cards = elements.cards;
		this.toolbarContainer = elements.toolbarContainer;

		// The search input is a launcher: focusing or submitting it forwards
		// to the Command Palette, seeded with any typed text.
		const openCommandPalette = () => {
			const filter = elements.searchInput.value.trim();
			elements.searchInput.value = '';
			elements.searchInput.blur();
			this.quickInputService.quickAccess.show(filter ? `>${filter}` : '>');
		};
		this._register(addDisposableListener(elements.searchInput, EventType.FOCUS, openCommandPalette));
		this._register(addDisposableListener(elements.searchInput, EventType.KEY_DOWN, e => {
			if (e.key === 'Enter') {
				openCommandPalette();
			}
		}));

		this._register(this.instantiationService.createInstance(MenuWorkbenchToolBar, this.toolbarContainer, MenuId.EditorGroupWatermarkToolbar, {
			hiddenItemStrategy: HiddenItemStrategy.NoHide,
			highlightToggledItems: true,
			menuOptions: { shouldForwardArgs: true }
		}));

		this.registerListeners();

		this.render();
	}

	private registerListeners(): void {
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (
				e.affectsConfiguration(EditorGroupWatermark.SETTINGS_KEY) &&
				this.enabled !== this.configurationService.getValue<boolean>(EditorGroupWatermark.SETTINGS_KEY)
			) {
				this.render();
			}
		}));

		this._register(this.contextService.onDidChangeWorkbenchState(workbenchState => {
			if (this.workbenchState !== workbenchState) {
				this.workbenchState = workbenchState;
				this.render();
			}
		}));

		this._register(this.storageService.onWillSaveState(e => {
			if (e.reason === WillSaveStateReason.SHUTDOWN) {
				const entries = [...emptyWindowEntries, ...workspaceEntries];
				for (const entry of entries) {
					const when = isWeb ? entry.when?.web : entry.when?.native;
					if (when) {
						this.cachedWhen[entry.id] = this.contextKeyService.contextMatchesRules(when);
					}
				}

				this.storageService.store(EditorGroupWatermark.CACHED_WHEN, JSON.stringify(this.cachedWhen), StorageScope.PROFILE, StorageTarget.MACHINE);
			}
		}));
	}

	private render(): void {
		this.enabled = this.configurationService.getValue<boolean>(EditorGroupWatermark.SETTINGS_KEY);

		clearNode(this.cards);
		this.transientDisposables.clear();

		if (!this.enabled) {
			return;
		}

		const entries = this.filterEntries(this.workbenchState !== WorkbenchState.EMPTY ? workspaceEntries : emptyWindowEntries);
		if (!entries.length) {
			return;
		}

		const cardDisposables = this.transientDisposables.add(new DisposableStore());

		const update = () => {
			clearNode(this.cards);
			this.keybindingLabels.clear();
			cardDisposables.clear();

			for (const entry of entries) {
				const card = append(this.cards, $('button.watermark-card', { type: 'button' }));

				const icon = append(card, $('span.watermark-card-icon'));
				icon.classList.add(...ThemeIcon.asClassNameArray(entry.icon));

				const text = append(card, $('span.watermark-card-text'));
				const label = append(text, $('span.watermark-card-label'));
				label.textContent = entry.label;
				const description = append(text, $('span.watermark-card-description'));
				description.textContent = entry.description;

				const keys = this.keybindingService.lookupKeybinding(entry.id);
				if (keys) {
					const keybindingContainer = append(card, $('span.watermark-card-keybinding'));
					const keybindingLabel = this.keybindingLabels.add(new KeybindingLabel(keybindingContainer, OS, { renderUnboundKeybindings: true, ...defaultKeybindingLabelStyles }));
					keybindingLabel.set(keys);
				}

				cardDisposables.add(addDisposableListener(card, EventType.CLICK, () => this.commandService.executeCommand(entry.id)));
			}
		};

		update();
		this.transientDisposables.add(this.keybindingService.onDidUpdateKeybindings(update));
	}

	private filterEntries(entries: WatermarkEntry[]): WatermarkEntry[] {
		const filteredEntries = entries
			.filter(entry => {
				if (this.cachedWhen[entry.id]) {
					return true; // cached from previous session
				}

				const contextKey = isWeb ? entry.when?.web : entry.when?.native;
				return !contextKey /* works without context */ || this.contextKeyService.contextMatchesRules(contextKey);
			})
			.filter(entry => !!CommandsRegistry.getCommand(entry.id));

		return filteredEntries;
	}
}
