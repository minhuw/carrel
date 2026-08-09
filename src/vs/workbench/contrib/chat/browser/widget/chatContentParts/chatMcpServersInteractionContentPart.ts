/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../base/browser/dom.js';
import { Disposable, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { IChatMcpServersStarting, IChatMcpServersStartingSerialized } from '../../../common/chatService/chatService.js';
import { IChatRendererContent } from '../../../common/model/chatViewModel.js';
import { IChatContentPart, IChatContentPartRenderContext } from './chatContentParts.js';
import './media/chatMcpServersInteractionContent.css';

/**
 * Stub for the removed MCP server interaction part. MCP support has been
 * removed, so this renders nothing; it only exists so previously serialized
 * `mcpServersStarting` progress parts remain renderable.
 */
export class ChatMcpServersInteractionContentPart extends Disposable implements IChatContentPart {
	public readonly domNode: HTMLElement;

	constructor(
		data: IChatMcpServersStarting | IChatMcpServersStartingSerialized,
		context: IChatContentPartRenderContext,
	) {
		super();
		this.domNode = dom.$('.chat-mcp-servers-interaction');
	}

	hasSameContent(other: IChatRendererContent): boolean {
		return other.kind === 'mcpServersStarting';
	}

	addDisposable(disposable: IDisposable): void {
		this._register(disposable);
	}
}
