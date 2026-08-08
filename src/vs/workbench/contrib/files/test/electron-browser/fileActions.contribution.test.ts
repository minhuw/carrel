/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Schemas } from '../../../../../base/common/network.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { isIMenuItem, MenuId, MenuRegistry } from '../../../../../platform/actions/common/actions.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { IsSessionsWindowContext, ResourceContextKey } from '../../../../common/contextkeys.js';
import { REVEAL_IN_EXPLORER_COMMAND_ID } from '../../browser/fileConstants.js';
import '../../electron-browser/fileActions.contribution.js';

suite('Chat file reveal menus', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	for (const menu of [MenuId.ChatAttachmentsContext, MenuId.ChatInlineResourceAnchorContext, MenuId.ChatInputResourceAttachmentContext]) {
		test(`offers Explorer reveal for local and remote files in ${menu.id}`, () => {
			const items = MenuRegistry.getMenuItems(menu).filter(isIMenuItem).filter(item => item.command.id === REVEAL_IN_EXPLORER_COMMAND_ID);
			const visibleTitles = (isSessionsWindow: boolean) => {
				const context = store.add(new MockContextKeyService());
				const scheme = ResourceContextKey.Scheme.bindTo(context);
				ResourceContextKey.IsFileSystemResource.bindTo(context).set(true);
				IsSessionsWindowContext.bindTo(context).set(isSessionsWindow);
				return [Schemas.file, Schemas.vscodeRemote].map(value => {
					scheme.set(value);
					return items.filter(item => item.when?.evaluate({ getValue: key => context.getContextKeyValue(key) })).map(item => item.command.title);
				});
			};
			assert.deepStrictEqual({
				workbench: visibleTitles(false),
				agentsWindow: visibleTitles(true),
			}, {
				workbench: [['Reveal in Explorer View'], ['Reveal in Explorer View']],
				agentsWindow: [['Reveal in Files View'], ['Reveal in Files View']],
			});
		});
	}
});
