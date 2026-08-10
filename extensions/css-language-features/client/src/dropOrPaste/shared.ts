/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Utils } from 'vscode-uri';

export const Schemes = Object.freeze({
	file: 'file',
	notebookCell: 'vscode-notebook-cell',
	untitled: 'untitled',
});

export const Mimes = Object.freeze({
	plain: 'text/plain',
	uriList: 'text/uri-list',
});


export function getDocumentDir(uri: vscode.Uri): vscode.Uri | undefined {
	const docUri = getParentDocumentUri(uri);
	if (docUri.scheme === Schemes.untitled) {
		return vscode.workspace.workspaceFolders?.[0]?.uri;
	}
	return Utils.dirname(docUri);
}

function getParentDocumentUri(uri: vscode.Uri): vscode.Uri {
	return uri;
}
