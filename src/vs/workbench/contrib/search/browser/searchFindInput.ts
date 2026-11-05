/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IContextViewProvider } from '../../../../base/browser/ui/contextview/contextview.js';
import { IFindInputOptions } from '../../../../base/browser/ui/findinput/findInput.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { ContextScopedFindInput } from '../../../../platform/history/browser/contextScopedHistoryWidget.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { Emitter } from '../../../../base/common/event.js';


export class SearchFindInput extends ContextScopedFindInput {
	private readonly _onDidChangeAIToggle = this._register(new Emitter<boolean>());
	public readonly onDidChangeAIToggle = this._onDidChangeAIToggle.event;

	constructor(
		container: HTMLElement | null,
		contextViewProvider: IContextViewProvider,
		options: IFindInputOptions,
		contextKeyService: IContextKeyService,
		readonly contextMenuService: IContextMenuService,
		readonly instantiationService: IInstantiationService,
	) {
		super(container, contextViewProvider, options, contextKeyService);
	}
}
