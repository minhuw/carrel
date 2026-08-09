/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $, append, EventType } from '../../../../../base/browser/dom.js';
import { Emitter } from '../../../../../base/common/event.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { KeyCodeChord, ResolvedKeybinding } from '../../../../../base/common/keybindings.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { isMacintosh, OS } from '../../../../../base/common/platform.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CommandsRegistry, ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ConfigurationTarget } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { USLayoutResolvedKeybinding } from '../../../../../platform/keybinding/common/usLayoutResolvedKeybinding.js';
import { MockContextKeyService, MockKeybindingService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../../platform/workspace/common/workspace.js';
import { EditorGroupWatermark } from '../../../../browser/parts/editor/editorGroupWatermark.js';
import { TestContextService } from '../../../common/workbenchTestServices.js';
import { workbenchInstantiationService } from '../../workbenchTestServices.js';

suite('EditorGroupWatermark', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let container: HTMLElement;
	let configurationService: TestConfigurationService;
	let instantiationService: ReturnType<typeof workbenchInstantiationService>;
	let keybindings: Map<string, ResolvedKeybinding>;
	let keybindingLookups: string[];
	let keybindingsChanged: Emitter<void>;
	let workbenchState: WorkbenchState;
	let contextMatches: boolean;
	let executedCommands: string[];
	let quickAccessValues: string[];

	function keybinding(keyCode: KeyCode): ResolvedKeybinding {
		return new USLayoutResolvedKeybinding([new KeyCodeChord(!isMacintosh, false, false, isMacintosh, keyCode)], OS);
	}

	function render(): void {
		disposables.add(instantiationService.createInstance(EditorGroupWatermark, container));
	}

	function cards() {
		return [...container.querySelectorAll('.watermark-card')].map(card => ({
			label: card.querySelector('.watermark-card-label')?.textContent,
			description: card.querySelector('.watermark-card-description')?.textContent,
			icon: card.querySelector('.codicon')?.className,
			keybinding: card.querySelector('.monaco-keybinding')?.getAttribute('aria-label'),
		}));
	}

	setup(() => {
		container = append(document.body, $('.editor-group-container.empty'));
		disposables.add(toDisposable(() => container.remove()));
		configurationService = new TestConfigurationService({ workbench: { tips: { enabled: true } } });
		disposables.add(configurationService.onDidChangeConfigurationEmitter);
		instantiationService = workbenchInstantiationService({ configurationService: () => configurationService }, disposables);
		keybindingsChanged = disposables.add(new Emitter<void>());
		keybindings = new Map([
			['workbench.action.files.openFile', keybinding(KeyCode.KeyO)],
			['workbench.action.files.newUntitledFile', keybinding(KeyCode.KeyN)],
			['workbench.action.showCommands', keybinding(KeyCode.KeyP)],
		]);
		keybindingLookups = [];
		workbenchState = WorkbenchState.FOLDER;
		contextMatches = true;
		executedCommands = [];
		quickAccessValues = [];
		instantiationService.stub(ICommandService, new class extends mock<ICommandService>() {
			override async executeCommand<T>(id: string): Promise<T | undefined> {
				executedCommands.push(id);
				return undefined;
			}
		});
		instantiationService.stub(IKeybindingService, new class extends MockKeybindingService {
			override get onDidUpdateKeybindings() { return keybindingsChanged.event; }
			override lookupKeybinding(id: string) {
				keybindingLookups.push(id);
				return keybindings.get(id);
			}
		});
		instantiationService.stub(IContextKeyService, new class extends MockContextKeyService {
			override contextMatchesRules() { return contextMatches; }
		});
		instantiationService.stub(IWorkspaceContextService, new class extends TestContextService {
			override getWorkbenchState() { return workbenchState; }
		});
		instantiationService.stub(IQuickInputService, new class extends mock<IQuickInputService>() {
			override readonly quickAccess = {
				show: (value: string) => { quickAccessValues.push(value); },
			} as IQuickInputService['quickAccess'];
		});

		for (const id of [
			'workbench.action.files.openFile',
			'workbench.action.files.openFolder',
			'workbench.action.files.newUntitledFile',
			'workbench.action.showCommands',
			'workbench.action.terminal.new',
			'git.clone',
		]) {
			disposables.add(CommandsRegistry.registerCommand(id, () => { }));
		}
	});

	test('renders Carrel cards with descriptions, icons, and keybindings', () => {
		render();

		assert.deepStrictEqual(cards(), [
			{ label: 'Open File', description: 'Open a file from disk', icon: 'watermark-card-icon codicon codicon-go-to-file', keybinding: keybindings.get('workbench.action.files.openFile')?.getAriaLabel() },
			{ label: 'New File', description: 'Create a new untitled text file', icon: 'watermark-card-icon codicon codicon-new-file', keybinding: keybindings.get('workbench.action.files.newUntitledFile')?.getAriaLabel() },
			{ label: 'Show All Commands', description: 'Run any command from the Command Palette', icon: 'watermark-card-icon codicon codicon-keyboard', keybinding: keybindings.get('workbench.action.showCommands')?.getAriaLabel() },
			{ label: 'Open Terminal', description: 'Open a new integrated terminal', icon: 'watermark-card-icon codicon codicon-terminal', keybinding: undefined },
		]);
	});

	test('clicking each card executes its command', () => {
		render();
		for (const card of container.querySelectorAll<HTMLElement>('button.watermark-card')) {
			card.click();
		}

		assert.deepStrictEqual(executedCommands, [
			'workbench.action.files.openFile',
			'workbench.action.files.newUntitledFile',
			'workbench.action.showCommands',
			'workbench.action.terminal.new',
		]);
	});

	test('uses native buttons without nested interactive controls', () => {
		render();

		assert.deepStrictEqual({
			buttons: container.querySelectorAll('button.watermark-card').length,
			nestedButtons: container.querySelectorAll('button.watermark-card button').length,
		}, { buttons: 4, nestedButtons: 0 });
	});

	test('refreshes keybindings once per update without duplicating them', () => {
		render();
		keybindingLookups = [];
		keybindings.delete('workbench.action.showCommands');
		keybindingsChanged.fire();

		assert.deepStrictEqual({
			lookups: keybindingLookups,
			keybindingLabels: container.querySelectorAll('.watermark-card .monaco-keybinding').length,
			cards: cards().length,
		}, {
			lookups: [
				'workbench.action.files.openFile',
				'workbench.action.files.newUntitledFile',
				'workbench.action.showCommands',
				'workbench.action.terminal.new',
			],
			keybindingLabels: 2,
			cards: 4,
		});
	});

	test('respects the tips setting when disabled and re-enabled', async () => {
		render();
		const setTipsEnabled = async (enabled: boolean) => {
			await configurationService.setUserConfiguration('workbench.tips.enabled', enabled);
			configurationService.onDidChangeConfigurationEmitter.fire({
				source: ConfigurationTarget.USER,
				affectedKeys: new Set(['workbench.tips.enabled']),
				change: { keys: ['workbench.tips.enabled'], overrides: [] },
				affectsConfiguration: key => key === 'workbench.tips.enabled',
			});
		};

		await setTipsEnabled(false);
		const hiddenCards = cards();
		await setTipsEnabled(true);

		assert.deepStrictEqual({ hiddenCards, visibleCards: cards().length }, { hiddenCards: [], visibleCards: 4 });
	});

	test('renders empty-window actions', () => {
		workbenchState = WorkbenchState.EMPTY;
		render();

		assert.deepStrictEqual(cards().map(card => card.label), [
			'Open File',
			'Open Folder',
			'New File',
			'Show All Commands',
			'Open Terminal',
			'Clone Repository',
		]);
	});

	test('opens the Command Palette from the search launcher', () => {
		render();
		const input = container.querySelector<HTMLInputElement>('.watermark-search input')!;
		input.dispatchEvent(new Event(EventType.FOCUS));
		input.value = 'open';
		input.dispatchEvent(new KeyboardEvent(EventType.KEY_DOWN, { key: 'Enter', bubbles: true }));

		assert.deepStrictEqual(quickAccessValues, ['>', '>open']);
	});
});
