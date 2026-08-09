/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Transport kind of a bundled server configuration declared by an agent
 * plugin's manifest. These are plain data shapes used when parsing plugin
 * files; the editor no longer ships an MCP server runtime.
 */
export const enum McpServerType {
	LOCAL = 'stdio',
	REMOTE = 'http',
}

export interface IMcpStdioServerConfiguration {
	readonly type: McpServerType.LOCAL;
	readonly command: string;
	readonly args?: readonly string[];
	readonly env?: Record<string, string | number | null>;
	readonly envFile?: string;
	readonly cwd?: string;
	readonly dev?: unknown;
}

export interface IMcpRemoteServerConfiguration {
	readonly type: McpServerType.REMOTE;
	readonly url: string;
	readonly headers?: Record<string, string>;
	readonly dev?: unknown;
}

export type IMcpServerConfiguration = IMcpStdioServerConfiguration | IMcpRemoteServerConfiguration;
