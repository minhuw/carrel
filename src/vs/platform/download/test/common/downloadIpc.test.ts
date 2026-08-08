/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import sinon from 'sinon';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Emitter } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { ChannelClient, ChannelServer } from '../../../../base/parts/ipc/common/ipc.js';
import { upcastPartial } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IDownloadService } from '../../common/download.js';
import { DownloadServiceChannel, DownloadServiceChannelClient } from '../../common/downloadIpc.js';

suite('DownloadService IPC', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const source = URI.parse('https://example.com/image.jpg?original=true');
	const target = URI.file('/downloads/image.jpg');

	function createClient(download: IDownloadService['download']): DownloadServiceChannelClient {
		const toClient = store.add(new Emitter<VSBuffer>());
		const toServer = store.add(new Emitter<VSBuffer>());
		const client = store.add(new ChannelClient({ onMessage: toClient.event, send: buffer => toServer.fire(buffer) }));
		const server = store.add(new ChannelServer({ onMessage: toServer.event, send: buffer => toClient.fire(buffer) }, 'renderer'));
		server.registerChannel('download', new DownloadServiceChannel(upcastPartial<IDownloadService>({ download })));
		return new DownloadServiceChannelClient(client.getChannel('download'));
	}

	for (const callSite of ['workbench.downloadFile', undefined]) {
		test(`preserves URIs and call site through IPC (call site: ${callSite})`, async () => {
			const download = sinon.stub().resolves();
			const client = createClient(download);

			await client.download(source, target, callSite);

			assert.deepStrictEqual(download.args, [[source, target, callSite ?? 'downloadIpc']]);
		});
	}

	test('propagates download failures through IPC', async () => {
		const client = createClient(async () => { throw new Error('Download failed'); });

		await assert.rejects(client.download(source, target, 'workbench.downloadFile'), /Download failed/);
	});
});
