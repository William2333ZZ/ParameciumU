/**
 * Connector 映射持久化：读写 .gateway/mappings.json
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { ConnectorMapping } from "./context.js";

export function loadConnectorMappingsSync(dataDir: string, filename: string): ConnectorMapping[] {
  const filePath = path.join(dataDir, filename);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as ConnectorMapping[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveConnectorMappings(dataDir: string, filename: string, mappings: ConnectorMapping[]): Promise<void> {
  const filePath = path.join(dataDir, filename);
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(mappings, null, 2), "utf-8");
}
