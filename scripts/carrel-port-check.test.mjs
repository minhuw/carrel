import assert from 'node:assert/strict';
import test from 'node:test';
import { auditManifest, auditPnpmRoots, findForbiddenFiles, parsePnpmLock } from './carrel-port-check.mjs';

const LOCK = [
	"lockfileVersion: '9.0'",
	'',
	'importers:',
	'',
	'  .:',
	'    dependencies:',
	'      alpha:',
	'        specifier: ^1.0.0',
	'        version: 1.0.0',
	'    devDependencies:',
	"      '@types/node':",
	'        specifier: 24.x',
	'        version: 24.0.0',
	'  web:',
	'    dependencies:',
	"      '@vscode/beta':",
	"        specifier: '*'",
	'        version: 2.0.0',
	'',
	'packages:',
	'',
	'  alpha@1.0.0:',
	'    resolution: {integrity: sha512-alpha}',
	'',
	"  '@hpke/core@1.9.0':",
	'    resolution: {integrity: sha512-hpke}',
	'',
].join('\n');

test('forbidden roots match descendants, not similarly named siblings', () => {
	const files = [
		'src/vs/platform/agentHost/common/agent.ts',
		'src/vs/platform/agentHostile/common/keep.ts',
		'src/vs/platform/github/common/keep.ts',
	];
	assert.deepStrictEqual(findForbiddenFiles(files), ['src/vs/platform/agentHost/common/agent.ts']);
});

test('pnpm lock parser reads importers and package keys', () => {
	const lock = parsePnpmLock(LOCK);
	assert.deepStrictEqual(lock.importers['.'], {
		dependencies: { alpha: '^1.0.0' },
		devDependencies: { '@types/node': '24.x' },
		optionalDependencies: {},
	});
	assert.deepStrictEqual(lock.importers.web.dependencies, { '@vscode/beta': '*' });
	assert.deepStrictEqual(lock.packageKeys, ['alpha@1.0.0', '@hpke/core@1.9.0']);
});

test('pnpm lock parser fails on a line it does not recognize', () => {
	assert.throws(() => parsePnpmLock('importers:\n  - unexpected\n'), /unrecognized pnpm-lock.yaml line/);
});

test('valid manifest and importer pass', () => {
	const pkg = { dependencies: { alpha: '^1.0.0' } };
	const lock = parsePnpmLock('importers:\n  .:\n    dependencies:\n      alpha:\n        specifier: ^1.0.0\n        version: 1.0.0\n\npackages:\n\n  alpha@1.0.0:\n    resolution: {integrity: sha512-alpha}\n');
	assert.deepStrictEqual(auditManifest(pkg, lock, '.'), []);
});

test('manifest audit catches drift and AI dependency reintroduction', () => {
	const pkg = {
		dependencies: { alpha: '^1.0.0', '@anthropic-ai/sdk': '^1.9.0' },
		devDependencies: { beta: '^2.0.0' },
	};
	const lock = parsePnpmLock([
		'importers:',
		'  .:',
		'    dependencies:',
		'      alpha:',
		'        specifier: ^1.1.0',
		'        version: 1.1.0',
		'      extra:',
		'        specifier: ^3.0.0',
		'        version: 3.0.0',
		'',
		'packages:',
		'',
		"  '@anthropic-ai/sdk@1.9.0':",
		'    resolution: {integrity: sha512-sdk}',
		'',
	].join('\n'));
	const errors = auditManifest(pkg, lock, '.');
	assert.ok(errors.some(error => error.includes('alpha') && error.includes('does not match')));
	assert.ok(errors.some(error => error.includes('beta') && error.includes('missing')));
	assert.ok(errors.some(error => error.includes('extra') && error.includes('only present')));
	assert.ok(errors.some(error => error.includes('@anthropic-ai/sdk') && error.includes('reintroduced')));
	assert.ok(errors.some(error => error.includes('@anthropic-ai/sdk') && error.includes('present in lockfile')));
});

test('manifest audit reports an importer the lock does not have', () => {
	assert.deepStrictEqual(auditManifest({ dependencies: {} }, parsePnpmLock(LOCK), 'scripts'), ['lock has no importer scripts']);
});

test('every pnpm workspace root has a lock, and no npm lock lies beneath one', () => {
	const files = [
		'pnpm-workspace.yaml',
		'pnpm-lock.yaml',
		'remote/pnpm-workspace.yaml',
		'remote/package-lock.json',
		'extensions/pnpm-workspace.yaml',
		'extensions/markdown-language-features/package-lock.json',
		'extensions/copilot/package.json',
	];
	assert.deepStrictEqual(auditPnpmRoots(files), [
		'remote: pnpm-workspace.yaml has no pnpm-lock.yaml',
		'extensions: pnpm-workspace.yaml has no pnpm-lock.yaml',
		'remote/package-lock.json: npm package-lock.json under a pnpm workspace',
		'extensions/markdown-language-features/package-lock.json: npm package-lock.json under a pnpm workspace',
	]);
});

test('npm lockfiles in sibling directories of a pnpm workspace are not flagged', () => {
	const files = ['remote/pnpm-workspace.yaml', 'remote/pnpm-lock.yaml', 'remote2/package-lock.json'];
	assert.deepStrictEqual(auditPnpmRoots(files), []);
});
