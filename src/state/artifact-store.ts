import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { ArtifactDescriptor } from "./types.ts";
import { atomicWriteFile } from "./atomic-write.ts";

function hashContent(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

export interface ArtifactWriteOptions {
	kind: ArtifactDescriptor["kind"];
	relativePath: string;
	content: string;
	producer: string;
	retention?: ArtifactDescriptor["retention"];
}

export function writeArtifact(artifactsRoot: string, options: ArtifactWriteOptions): ArtifactDescriptor {
	const normalizedRelativePath = options.relativePath.replaceAll("\\", "/").replace(/^\.\/+/, "");
	if (normalizedRelativePath.startsWith("../") || path.isAbsolute(normalizedRelativePath)) {
		throw new Error(`Invalid artifact path: ${options.relativePath}`);
	}
	const filePath = path.join(artifactsRoot, normalizedRelativePath);
	atomicWriteFile(filePath, options.content);
	const stats = fs.statSync(filePath);
	return {
		kind: options.kind,
		path: filePath,
		createdAt: new Date().toISOString(),
		producer: options.producer,
		sizeBytes: stats.size,
		contentHash: hashContent(options.content),
		retention: options.retention ?? "run",
	};
}
