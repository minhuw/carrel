/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import * as nls from '../../../../nls.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Action2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { ExtensionHostKind } from '../../../services/extensions/common/extensionHostKind.js';
import { IExtensionService, IExtensionInspectInfo } from '../../../services/extensions/common/extensions.js';

interface IExtensionHostQuickPickItem extends IQuickPickItem {
	portInfo: IExtensionInspectInfo;
}

export class DebugExtensionHostInDevToolsAction extends Action2 {
	constructor() {
		super({
			id: 'workbench.extensions.action.devtoolsExtensionHost',
			title: nls.localize2('openDevToolsForExtensionHost', 'Debug Extension Host In Dev Tools'),
			category: Categories.Developer,
			f1: true,
			icon: Codicon.debugStart,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const extensionService = accessor.get(IExtensionService);
		const nativeHostService = accessor.get(INativeHostService);
		const quickInputService = accessor.get(IQuickInputService);

		const inspectPorts = await extensionService.getInspectPorts(ExtensionHostKind.LocalProcess, true);

		if (inspectPorts.length === 0) {
			console.log('[devtoolsExtensionHost] No extension host inspect ports found.');
			return;
		}

		const items: IExtensionHostQuickPickItem[] = inspectPorts.filter(portInfo => portInfo.devtoolsUrl).map(portInfo => ({
			label: portInfo.devtoolsLabel ?? `${portInfo.host}:${portInfo.port}`,
			detail: `${portInfo.host}:${portInfo.port}`,
			portInfo: portInfo
		}));

		if (items.length === 1) {
			const portInfo = items[0].portInfo;
			nativeHostService.openDevToolsWindow(portInfo.devtoolsUrl!);
			return;
		}

		const selected = await quickInputService.pick<IExtensionHostQuickPickItem>(items, {
			placeHolder: nls.localize('selectExtensionHost', "Pick extension host"),
			matchOnDetail: true,
		});

		if (selected) {
			const portInfo = selected.portInfo;
			nativeHostService.openDevToolsWindow(portInfo.devtoolsUrl!);
		}
	}
}
