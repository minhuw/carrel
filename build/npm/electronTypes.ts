/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';
import { download, sha256 } from '../lib/download.ts';
import { getElectronVersion } from '../lib/electronVersion.ts';

const root = fs.realpathSync.native(path.dirname(path.dirname(import.meta.dirname)));
const electronTypesPath = path.join(root, '.build', 'typings', 'electron.d.ts');

function getExpectedChecksum(): string {
	const checksumFile = fs.readFileSync(path.join(root, 'build', 'checksums', 'electron.txt'), 'utf8');
	const checksum = /^(?<checksum>[a-f0-9]{64}) \*electron\.d\.ts$/m.exec(checksumFile)?.groups?.checksum;
	if (!checksum) {
		throw new Error('Electron checksum manifest does not contain electron.d.ts');
	}
	return checksum;
}

export async function ensureElectronTypes(): Promise<void> {
	const expectedChecksum = getExpectedChecksum();
	if (fs.existsSync(electronTypesPath) && sha256(fs.readFileSync(electronTypesPath)) === expectedChecksum) {
		return;
	}

	const { electronVersion } = getElectronVersion();
	const url = `https://github.com/electron/electron/releases/download/v${electronVersion}/electron.d.ts`;
	// GitHub's release CDN can return 5xx responses for minutes at a time, so keep retrying (about three minutes in total) before failing the install.
	const contents = await download(url, { checksumSha256: expectedChecksum, attempts: 6, retryDelay: 5_000 });

	fs.mkdirSync(path.dirname(electronTypesPath), { recursive: true });
	fs.writeFileSync(electronTypesPath, contents);
}

if (import.meta.main) {
	ensureElectronTypes().catch(error => {
		console.error(error);
		process.exit(1);
	});
}
