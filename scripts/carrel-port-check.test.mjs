import assert from 'node:assert/strict';
import test from 'node:test';
import { auditManifest, findForbiddenFiles } from './carrel-port-check.mjs';

test('forbidden roots match descendants, not similarly named siblings', () => {
	const files = [
		'src/vs/platform/agentHost/common/agent.ts',
		'src/vs/platform/agentHostile/common/keep.ts',
		'src/vs/platform/github/common/keep.ts',
	];
	assert.deepStrictEqual(findForbiddenFiles(files), ['src/vs/platform/agentHost/common/agent.ts']);
});

test('valid manifest and lock root pass', () => {
	const pkg = { version: '1.0.0', dependencies: { alpha: '^1.0.0' } };
	const lock = {
		version: '1.0.0',
		packages: { '': { dependencies: { alpha: '^1.0.0' } } },
	};
	assert.deepStrictEqual(auditManifest(pkg, lock), []);
});

test('manifest audit catches drift and AI dependency reintroduction', () => {
	const pkg = {
		version: '1.0.0',
		dependencies: { alpha: '^1.0.0', '@hpke/core': '^1.9.0' },
		devDependencies: { beta: '^2.0.0' },
	};
	const lock = {
		version: '1.0.1',
		packages: {
			'': { dependencies: { alpha: '^1.1.0', extra: '^3.0.0' } },
			'node_modules/@hpke/core': { version: '1.9.0' },
		},
	};
	const errors = auditManifest(pkg, lock);
	assert.ok(errors.some(error => error.includes('version')));
	assert.ok(errors.some(error => error.includes('alpha') && error.includes('does not match')));
	assert.ok(errors.some(error => error.includes('beta') && error.includes('missing')));
	assert.ok(errors.some(error => error.includes('extra') && error.includes('only present')));
	assert.ok(errors.some(error => error.includes('@hpke/core') && error.includes('reintroduced')));
});
