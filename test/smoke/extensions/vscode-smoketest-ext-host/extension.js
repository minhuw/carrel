/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @ts-check
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');

/** @type {string | undefined} */
let deactivateMarkerFile;

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	// Record extension host pid on every activation so smoke tests can validate
	// that a new extension host process was started after a restart action.
	try {
		const pid = String(process.pid);
		const activationPidFile = path.join(os.tmpdir(), 'vscode-ext-host-pid-on-activate.txt');
		fs.writeFileSync(activationPidFile, pid, 'utf-8');
	} catch {
		// Ignore errors in smoke helper setup.
	}

	// This is used to verify that the extension host process is properly killed
	// when window reloads even if the extension host is blocked
	// Refs: https://github.com/microsoft/vscode/issues/291346
	context.subscriptions.push(
		vscode.commands.registerCommand('smoketest.getExtensionHostPidAndBlock', (delayMs = 100, durationMs = 60000) => {
			const pid = process.pid;

			// Write PID file to temp dir to avoid polluting workspace search results
			// Note: filename must match name in extension-host-restart.test.ts
			const pidFile = path.join(os.tmpdir(), 'vscode-ext-host-pid.txt');
			setTimeout(() => {
				fs.writeFileSync(pidFile, String(pid), 'utf-8');

				// Block the extension host without busy-spinning to avoid pegging a CPU core.
				// Prefer Atomics.wait on a SharedArrayBuffer when available; otherwise, fall back
				// to the original busy loop to preserve behavior in older environments.
				if (typeof SharedArrayBuffer === 'function' && typeof Atomics !== 'undefined' && typeof Atomics.wait === 'function') {
					const sab = new SharedArrayBuffer(4);
					const blocker = new Int32Array(sab);
					// Wait up to durationMs milliseconds. This blocks the thread without consuming CPU.
					Atomics.wait(blocker, 0, 0, durationMs);
				} else {
					const start = Date.now();
					while (Date.now() - start < durationMs) {
						// Busy loop (fallback)
					}
				}
			}, delayMs);

			return pid;
		})
	);

	// This command sets up a marker file path that will be written during deactivation.
	// It allows the smoke test to verify that extensions get a chance to deactivate.
	context.subscriptions.push(
		vscode.commands.registerCommand('smoketest.setupGracefulDeactivation', () => {
			const pid = process.pid;
			const pidFile = path.join(os.tmpdir(), 'vscode-ext-host-pid-graceful.txt');
			deactivateMarkerFile = path.join(os.tmpdir(), 'vscode-ext-host-deactivated.txt');

			// Write PID file immediately so test knows the extension is ready
			fs.writeFileSync(pidFile, String(pid), 'utf-8');

			return { pid, markerFile: deactivateMarkerFile };
		})
	);
}

/** @type {Promise<void> | undefined} */
let openingAgentHostChat;

/**
 * Open an Agent Host Copilot session in a chat editor. The command is not in
 * the palette, hence this wrapper. It waits up to 30 seconds for the agent
 * host, which may still be starting or run on the remote, to register its
 * Copilot agent, and then fails; retry only that failure, until it has
 * registered.
 */
async function openAgentHostChat() {
	await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	const deadline = Date.now() + 5 * 60_000;
	for (; ;) {
		try {
			await vscode.commands.executeCommand('workbench.action.chat.openNewSessionEditor.agent-host-copilotcli');
			return;
		} catch (error) {
			if (Date.now() >= deadline || !/did not register a copilotcli agent/.test(error instanceof Error ? error.message : String(error))) {
				throw error;
			}
		}
	}
}

function deactivate() {
	// Write marker file to indicate deactivation was called
	if (deactivateMarkerFile) {
		try {
			fs.writeFileSync(deactivateMarkerFile, `deactivated at ${Date.now()}`, 'utf-8');
		} catch {
			// Ignore errors (e.g., folder not accessible)
		}
	}
}

module.exports = {
	activate,
	deactivate
};
