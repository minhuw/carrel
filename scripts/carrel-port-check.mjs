#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const FORBIDDEN_ROOTS = [
	'build/agent-sdk',
	'build/agentHost',
	'build/azure-pipelines/copilot-shim',
	'build/dictation-runtime',
	'copilot_shim',
	'extensions/copilot',
	'extensions/debug-auto-launch',
	'extensions/mermaid-markdown-features',
	'extensions/microsoft-authentication',
	'src/vs/platform/agentHost',
	'src/vs/platform/assignment',
	'src/vs/platform/browserView',
	'src/vs/platform/chat',
	'src/vs/platform/customizationMarketplace',
	'src/vs/platform/mcp',
	'src/vs/platform/networkFilter',
	'src/vs/platform/telemetry/electron-browser',
	'src/vs/platform/webContentExtractor',
	'src/vs/sessions',
	'src/vs/workbench/browser/parts/sessions',
	'src/vs/workbench/contrib/agentsVoice',
	'src/vs/workbench/contrib/browserView',
	'src/vs/workbench/contrib/canvases',
	'src/vs/workbench/contrib/chat',
	'src/vs/workbench/contrib/chatWindow',
	'src/vs/workbench/contrib/debug',
	'src/vs/workbench/contrib/editTelemetry',
	'src/vs/workbench/contrib/inlineChat',
	'src/vs/workbench/contrib/interactive',
	'src/vs/workbench/contrib/mcp',
	'src/vs/workbench/contrib/notebook',
	'src/vs/workbench/contrib/onboarding',
	'src/vs/workbench/contrib/replNotebook',
	'src/vs/workbench/contrib/sessionChanges',
	'src/vs/workbench/contrib/sessions',
	'src/vs/workbench/contrib/telemetry',
	'src/vs/workbench/contrib/terminalContrib/chatAgentTools',
	'src/vs/workbench/contrib/testing',
	'src/vs/workbench/contrib/update',
	'src/vs/workbench/services/agentHost',
	'src/vs/workbench/services/browserView',
	'src/vs/workbench/services/chat',
	'src/vs/workbench/services/notebook',
	'src/vs/workbench/services/sessions',
	'src/vs/workbench/services/telemetry',
	'src/vs/workbench/services/update',
	'src/vs/workbench/test/browser/componentFixtures/sessions',
	'src/vs/workbench/test/browser/parts/sessions',
	'test/integration/agentHost',
	'test/smoke/src/areas/agentsWindow',
	'test/smoke/src/areas/browserView',
	'test/smoke/src/areas/chat',
];

export const AI_DEPENDENCIES = [
	'@anthropic-ai/claude-agent-sdk',
	'@anthropic-ai/sdk',
	'@github/copilot',
	'@github/copilot-sdk',
	'@microsoft/mxc-sdk',
	'@openai/codex',
	'@vscode/copilot-api',
	'foundry-local-sdk',
	'libsodium-wrappers',
];

// Each manifest is audited against the importer entry of the pnpm lockfile that covers it.
const MANIFEST_ROOTS = [
	{ root: '.', lockRoot: '.', importer: '.' },
	{ root: 'remote', lockRoot: 'remote', importer: '.' },
	{ root: 'extensions/markdown-language-features', lockRoot: 'extensions', importer: 'markdown-language-features' },
];
const DEPENDENCY_KINDS = ['dependencies', 'devDependencies', 'optionalDependencies'];
// One pnpm-lock.yaml line: a (possibly quoted) key with an optional inline value.
const PNPM_LOCK_ENTRY = /^('(?:[^']|'')*'|"(?:[^"\\]|\\.)*"|[^'"\s].*?):(?: (.*))?$/;

export function findForbiddenFiles(files) {
	return files.filter(file => FORBIDDEN_ROOTS.some(root => file === root || file.startsWith(`${root}/`)));
}

function unquote(text) {
	if (text.startsWith('\'')) {
		return text.slice(1, -1).replaceAll('\'\'', '\'');
	}
	if (text.startsWith('"')) {
		return JSON.parse(text);
	}
	return text;
}

// Reads the importers and package keys of a pnpm-lock.yaml. pnpm writes a fixed layout (two spaces per key level),
// so a key line in an unexpected shape is an error rather than something to skip.
export function parsePnpmLock(text) {
	const importers = {};
	const packageKeys = [];
	let section;
	let importer;
	let kind;
	let dependency;
	for (const line of text.split('\n')) {
		if (!line.trim()) {
			continue;
		}
		const indent = line.length - line.trimStart().length;
		if (indent === 0) {
			section = line.replace(/:.*$/, '');
			continue;
		}
		// Only the keys that are read are matched; deeper lines (resolutions, deprecation text) are skipped.
		const readable = (section === 'packages' && indent === 2) || (section === 'importers' && indent <= 8);
		if (!readable) {
			continue;
		}
		const entry = line.trim().match(PNPM_LOCK_ENTRY);
		if (!entry) {
			throw new Error(`unrecognized pnpm-lock.yaml line: ${line}`);
		}
		const key = unquote(entry[1]);
		if (section === 'packages') {
			packageKeys.push(key);
		} else if (indent === 2) {
			importer = key;
			importers[key] = { dependencies: {}, devDependencies: {}, optionalDependencies: {} };
		} else if (indent === 4) {
			kind = DEPENDENCY_KINDS.includes(key) ? key : undefined;
		} else if (indent === 6) {
			dependency = key;
		} else if (indent === 8 && kind && key === 'specifier') {
			importers[importer][kind][dependency] = unquote(entry[2]);
		}
	}
	return { importers, packageKeys };
}

export function auditManifest(pkg, lock, importerId) {
	const errors = [];
	const importer = lock.importers[importerId];
	if (!importer) {
		return [`lock has no importer ${importerId}`];
	}
	for (const kind of DEPENDENCY_KINDS) {
		const manifestDeps = pkg[kind] ?? {};
		const lockDeps = importer[kind];
		for (const [name, spec] of Object.entries(manifestDeps)) {
			if (!(name in lockDeps)) {
				errors.push(`${kind}.${name} is missing from lock importer ${importerId}`);
			} else if (lockDeps[name] !== spec) {
				errors.push(`${kind}.${name} spec ${spec} does not match lock importer ${lockDeps[name]}`);
			}
		}
		for (const name of Object.keys(lockDeps)) {
			if (!(name in manifestDeps)) {
				errors.push(`${kind}.${name} is only present in lock importer ${importerId}`);
			}
		}
	}
	for (const name of AI_DEPENDENCIES) {
		if (DEPENDENCY_KINDS.some(kind => name in (pkg[kind] ?? {}))) {
			errors.push(`AI dependency ${name} was reintroduced in manifest`);
		}
		if (lock.packageKeys.some(key => key.startsWith(`${name}@`))) {
			errors.push(`AI dependency ${name} is present in lockfile`);
		}
	}
	return errors;
}

// Each pnpm workspace root needs its pnpm-lock.yaml, and no npm package-lock.json may remain under one.
export function auditPnpmRoots(files) {
	const errors = [];
	const roots = files.filter(file => posix.basename(file) === 'pnpm-workspace.yaml').map(file => posix.dirname(file));
	for (const root of roots) {
		if (!files.includes(posix.join(root, 'pnpm-lock.yaml'))) {
			errors.push(`${root}: pnpm-workspace.yaml has no pnpm-lock.yaml`);
		}
	}
	for (const file of files) {
		if (posix.basename(file) === 'package-lock.json' && roots.some(root => root === '.' || file.startsWith(`${root}/`))) {
			errors.push(`${file}: npm package-lock.json under a pnpm workspace`);
		}
	}
	return errors;
}

function listFiles() {
	return execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
		.split('\0')
		.filter(Boolean);
}

function conflictMarkerFiles() {
	const args = ['grep', '-l', '-E', '^(<<<<<<<|>>>>>>>)', '--',
		'*.ts', '*.tsx', '*.js', '*.mjs', '*.json', '*.md', '*.rs', '*.toml',
		'*.yml', '*.yaml', '*.sh', '*.bat', '*.ps1', '*.py', '*.css', '*.html'];
	try {
		return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
			.split('\n')
			.filter(Boolean);
	} catch (error) {
		if (error.status === 1) {
			return [];
		}
		throw error;
	}
}

export function main() {
	const errors = [];
	const files = listFiles();
	for (const root of FORBIDDEN_ROOTS) {
		const matches = findForbiddenFiles(files).filter(file => file === root || file.startsWith(`${root}/`));
		if (matches.length) {
			errors.push(`${root}: ${matches.length} file(s) in removed root; examples: ${matches.slice(0, 5).join(', ')}`);
		}
	}
	errors.push(...auditPnpmRoots(files));
	for (const { root, lockRoot, importer } of MANIFEST_ROOTS) {
		if (!existsSync(join(root, 'package.json'))) {
			continue;
		}
		const lockPath = join(lockRoot, 'pnpm-lock.yaml');
		if (!existsSync(lockPath)) {
			errors.push(`${root}: ${lockPath} is missing`);
			continue;
		}
		const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
		const lock = parsePnpmLock(readFileSync(lockPath, 'utf8'));
		for (const error of auditManifest(pkg, lock, importer)) {
			errors.push(`${root}: ${error}`);
		}
	}
	for (const file of conflictMarkerFiles()) {
		errors.push(`${file}: conflict marker`);
	}
	if (errors.length) {
		console.error(`Carrel port check failed:\n${errors.map(error => `  - ${error}`).join('\n')}`);
		process.exitCode = 1;
		return;
	}
	console.log(`Carrel port check passed (${files.length} files, ${MANIFEST_ROOTS.length} manifest/lock pairs).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	main();
}
