/**
 * 与 OpenClaw 对齐：Docker 沙箱容器生命周期与 docker exec 执行。
 * - ensureSandboxContainer: 创建并启动容器（-v workspace:workdir, sleep infinity）
 * - runInContainer: docker exec -i -w workdir containerName sh -lc "<command>"
 */

import { spawn } from "node:child_process";

const DEFAULT_WORKDIR = "/workspace";

function slugify(s: string): string {
	return s.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 48);
}

export function execDocker(
	args: string[],
	opts?: { timeoutMs?: number },
): Promise<{ stdout: string; stderr: string; code: number }> {
	return new Promise((resolve, reject) => {
		const timeoutMs = opts?.timeoutMs ?? 30_000;
		const child = spawn("docker", args, {
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (c: Buffer) => {
			stdout += c.toString();
		});
		child.stderr?.on("data", (c: Buffer) => {
			stderr += c.toString();
		});
		const t = setTimeout(() => {
			try {
				child.kill("SIGKILL");
			} catch {
				/* ignore */
			}
			reject(new Error(`docker ${args.slice(0, 3).join(" ")} timeout`));
		}, timeoutMs);
		child.on("error", (err) => {
			clearTimeout(t);
			reject(err);
		});
		child.on("close", (code, signal) => {
			clearTimeout(t);
			resolve({
				stdout,
				stderr,
				code: code ?? (signal ? 128 : 0),
			});
		});
	});
}

export async function dockerContainerState(name: string): Promise<{ exists: boolean; running: boolean }> {
	const result = await execDocker(["inspect", "-f", "{{.State.Running}}", name], {
		timeoutMs: 5000,
	}).catch(() => ({ code: 1, stdout: "", stderr: "" }));
	if (result.code !== 0) {
		return { exists: false, running: false };
	}
	return { exists: true, running: result.stdout.trim() === "true" };
}

export async function ensureSandboxContainer(params: {
	containerName: string;
	workspaceDir: string;
	image: string;
	workdir?: string;
}): Promise<void> {
	const workdir = params.workdir ?? DEFAULT_WORKDIR;
	const state = await dockerContainerState(params.containerName);
	if (state.exists) {
		if (!state.running) {
			await execDocker(["start", params.containerName]);
		}
		return;
	}
	await execDocker([
		"create",
		"--name",
		params.containerName,
		"-v",
		`${params.workspaceDir}:${workdir}`,
		"--workdir",
		workdir,
		params.image,
		"sleep",
		"infinity",
	]);
	await execDocker(["start", params.containerName]);
}

export async function runInContainer(params: {
	containerName: string;
	workdir: string;
	command: string;
	timeoutMs: number;
}): Promise<{ ok: boolean; exitCode: number; stdout: string; stderr: string; error?: string }> {
	const args = ["exec", "-i", "-w", params.workdir, params.containerName, "sh", "-lc", params.command];
	try {
		const result = await execDocker(args, { timeoutMs: params.timeoutMs });
		return {
			ok: result.code === 0,
			exitCode: result.code,
			stdout: result.stdout,
			stderr: result.stderr,
		};
	} catch (err) {
		return {
			ok: false,
			exitCode: 128,
			stdout: "",
			stderr: "",
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

export function getSandboxContainerName(nodeId: string): string {
	const slug = slugify(nodeId);
	const name = `paramecium-u-sandbox-${slug}`;
	return name.slice(0, 63);
}

export { DEFAULT_WORKDIR };
