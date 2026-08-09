/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../base/common/lifecycle.js';
import { getWindowId } from '../../base/browser/dom.js';
import { mainWindow } from '../../base/browser/window.js';
import { isMacintosh, isNative } from '../../base/common/platform.js';
import { IConfigurationService } from '../../platform/configuration/common/configuration.js';
import { INativeHostService } from '../../platform/native/common/native.js';
import { hasNativeTitlebar } from '../../platform/window/common/window.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../common/contributions.js';
import { WorkbenchLayoutSettings } from '../browser/layout.js';

/**
 * Carrel: the height of the compact chrome top inset. Must match
 * `--carrel-traffic-lights-offset` in `browser/media/compactChrome.css`.
 */
const COMPACT_CHROME_TOP_INSET = 35;

/**
 * Carrel: positions the macOS traffic lights for the compact chrome layout.
 *
 * Normally the titlebar part reports its height on every layout, and the main
 * process centers the window buttons within it (`setWindowButtonPosition`).
 * The compact chrome layout removes the titlebar part from the grid, so no
 * height is ever reported and the buttons fall back to a default position
 * that is clipped by the window's rounded corner. While compact chrome is
 * active, report the top inset instead so the buttons are centered in it.
 *
 * When compact chrome is disabled the titlebar part becomes visible again and
 * resumes reporting its own height, so no explicit reset is needed here.
 */
class CompactChromeWindowControlsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.compactChromeWindowControls';

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@INativeHostService private readonly nativeHostService: INativeHostService
	) {
		super();

		this.apply();
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(WorkbenchLayoutSettings.COMPACT_CHROME) || e.affectsConfiguration('window.titleBarStyle')) {
				this.apply();
			}
		}));
	}

	private apply(): void {
		if (!isMacintosh || !isNative) {
			return;
		}

		const compactChrome = this.configurationService.getValue<boolean>(WorkbenchLayoutSettings.COMPACT_CHROME) === true
			&& !hasNativeTitlebar(this.configurationService);
		if (compactChrome) {
			this.nativeHostService.updateWindowControls({
				targetWindowId: getWindowId(mainWindow),
				height: COMPACT_CHROME_TOP_INSET
			});
		}
	}
}

registerWorkbenchContribution2(CompactChromeWindowControlsContribution.ID, CompactChromeWindowControlsContribution, WorkbenchPhase.AfterRestored);
