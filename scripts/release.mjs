#!/usr/bin/env node

/**
 * Release script for monou
 * Usage: node scripts/release.mjs <major|minor|patch>
 *
 * 1. Check uncommitted changes
 * 2. Bump version (version:xxx + sync-versions + reinstall)
 * 3. Update CHANGELOG.md: [Unreleased] -> [version] - date (packages + apps)
 * 4. Commit and tag
 * 5. Publish (npm publish -ws)
 * 6. Add [Unreleased] to changelogs
 * 7. Commit and push
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

const BUMP = process.argv[2];
if (!["major", "minor", "patch"].includes(BUMP)) {
	console.error("Usage: node scripts/release.mjs <major|minor|patch>");
	process.exit(1);
}

function run(cmd, opts = {}) {
	console.log(`$ ${cmd}`);
	try {
		return execSync(cmd, { encoding: "utf-8", stdio: opts.silent ? "pipe" : "inherit", ...opts });
	} catch (e) {
		if (!opts.ignoreError) {
			console.error("Command failed:", cmd);
			process.exit(1);
		}
		return null;
	}
}

function getVersion() {
	const p = join(process.cwd(), "packages/shared/package.json");
	return JSON.parse(readFileSync(p, "utf-8")).version;
}

function getChangelogPaths() {
	const dirs = ["packages", "apps"];
	const out = [];
	for (const dir of dirs) {
		const base = join(process.cwd(), dir);
		if (!existsSync(base)) continue;
		for (const name of readdirSync(base)) {
			const path = join(base, name, "CHANGELOG.md");
			if (existsSync(path)) out.push(path);
		}
	}
	return out;
}

function updateChangelogsForRelease(version) {
	const date = new Date().toISOString().split("T")[0];
	for (const path of getChangelogPaths()) {
		let content = readFileSync(path, "utf-8");
		if (!content.includes("## [Unreleased]")) continue;
		content = content.replace("## [Unreleased]", `## [${version}] - ${date}`);
		writeFileSync(path, content);
		console.log("  Updated", path);
	}
}

function addUnreleasedSection() {
	for (const path of getChangelogPaths()) {
		let content = readFileSync(path, "utf-8");
		content = content.replace(/^(# Changelog\n\n)/, "$1## [Unreleased]\n\n");
		writeFileSync(path, content);
		console.log("  Added [Unreleased]", path);
	}
}

console.log("\n=== Monou Release ===\n");

const status = run("git status --porcelain", { silent: true });
if (status && status.trim()) {
	console.error("Uncommitted changes. Commit or stash first.");
	process.exit(1);
}

run(`npm run version:${BUMP}`);
const version = getVersion();
console.log("  New version:", version, "\n");

updateChangelogsForRelease(version);
run("git add .");
run(`git commit -m "Release v${version}"`);
run(`git tag v${version}`);

console.log("\nPublishing...");
run("npm publish -ws --access public", { ignoreError: true });

addUnreleasedSection();
run("git add .");
run(`git commit -m "Add [Unreleased] for next cycle"`);

console.log("\nPush with: git push origin main && git push origin v" + version);
console.log("=== Released v" + version + " ===\n");
