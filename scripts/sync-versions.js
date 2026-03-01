#!/usr/bin/env node

/**
 * Syncs all @monou/* package and app dependency versions to match current versions.
 * Lockstep versioning across the ParameciumU monorepo.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

const root = process.cwd();
const packagesDir = join(root, "packages");
const appsDir = join(root, "apps");

function collectWorkspaces(dir) {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => d.name)
		.map((name) => ({ name, path: join(dir, name, "package.json") }))
		.filter(({ path: p }) => existsSync(p));
}

const packageWorks = collectWorkspaces(packagesDir);
const appWorks = collectWorkspaces(appsDir);
const allWorks = [...packageWorks, ...appWorks];

const versionMap = {};
const works = {};

for (const { name, path } of allWorks) {
	try {
		const data = JSON.parse(readFileSync(path, "utf8"));
		works[name] = { path, data };
		versionMap[data.name] = data.version;
	} catch (e) {
		console.error(`Failed to read ${path}:`, e.message);
	}
}

console.log("Current versions:");
for (const [name, version] of Object.entries(versionMap).sort()) {
	console.log(`  ${name}: ${version}`);
}

const versions = new Set(Object.values(versionMap));
if (versions.size > 1) {
	console.error("\n❌ ERROR: Not all workspaces have the same version!");
	console.error("Run one of: npm run version:patch | version:minor | version:major");
	process.exit(1);
}

console.log("\n✅ Lockstep version OK");

let total = 0;
for (const { path, data } of Object.values(works)) {
	let updated = false;
	for (const key of ["dependencies", "devDependencies"]) {
		if (!data[key]) continue;
		for (const [dep, ver] of Object.entries(data[key])) {
			if (versionMap[dep]) {
				const newVer = `^${versionMap[dep]}`;
				if (ver !== newVer) {
					console.log(`\n${data.name}: ${dep} ${ver} → ${newVer}`);
					data[key][dep] = newVer;
					updated = true;
					total++;
				}
			}
		}
	}
	if (updated) {
		writeFileSync(path, JSON.stringify(data, null, "\t") + "\n");
	}
}

if (total === 0) {
	console.log("\nAll inter-workspace dependencies already in sync.");
} else {
	console.log(`\n✅ Updated ${total} dependency version(s)`);
}
