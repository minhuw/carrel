/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { createNativeAboutDialogDetails } from '../../electron-browser/dialog.js';
import { IOSProperties } from '../../../native/common/native.js';
import product from '../../../product/common/product.js';
import { IProductService } from '../../../product/common/productService.js';

suite('Native About Dialog', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('only shows runtime metadata available in Carrel builds', () => {
		const productService: IProductService = {
			_serviceBrand: undefined,
			...product,
			nameLong: 'Carrel Test',
			version: '1.2.3',
			commit: 'test-commit',
			date: '2026-01-02T03:04:05.000Z'
		};
		const osProperties: IOSProperties = {
			type: 'TestOS',
			release: '1.0',
			arch: 'test-arch',
			platform: 'test-platform',
			cpus: []
		};

		const about = createNativeAboutDialogDetails(productService, osProperties);

		assert.strictEqual(about.title, 'Carrel Test');
		for (const details of [about.details, about.detailsToCopy]) {
			assert.deepStrictEqual(
				details.split('\n').map(line => line.slice(0, line.indexOf(':'))),
				['Version', 'Commit', 'Date', 'Electron', 'Chromium', 'Node.js', 'V8', 'OS']
			);
			assert.ok(details.includes('OS: TestOS test-arch 1.0'));
			assert.ok(!details.includes('ElectronBuildId'));
			assert.ok(!details.includes('@github/copilot'));
			assert.ok(!details.includes('undefined'));
		}
	});
});
