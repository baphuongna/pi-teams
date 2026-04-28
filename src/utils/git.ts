import { createRequire } from "node:module";

type HostedGitInfoResult = {
	repo?: unknown;
	domain?: string;
	project?: string;
	user?: string;
	committish?: string;
};

type HostedGitInfoModule = {
	fromUrl: (url: string) => HostedGitInfoResult | null;
};

/**
 * Parsed git source information.
 */
export type GitSource = {
	/**
	 * Always "git" for git sources.
	 */
	type: "git";
	/**
	 * Clone URL.
	 */
	repo: string;
	/**
	 * Git host domain (for example, "github.com").
	 */
	host: string;
	/**
	 * Repository path (for example, "org/repo").
	 */
	path: string;
	/**
	 * Git ref (branch, tag, or commit) if specified.
	 */
	ref?: string;
	/**
	 * Whether the source includes a pinned ref.
	 */
	pinned: boolean;
};

function getHostedGitInfo(): HostedGitInfoModule | null {
	const require = createRequire(import.meta.url);
	try {
		return require("hosted-git-info") as HostedGitInfoModule;
	} catch {
		return null;
	}
}

const hostedGitInfo = getHostedGitInfo();

function splitRef(url: string): { repo: string; ref?: string } {
	const scpLikeMatch = url.match(/^git@([^:]+):(.+)$/);
	if (scpLikeMatch) {
		const pathWithMaybeRef = scpLikeMatch[2] ?? "";
		const atRefIndex = pathWithMaybeRef.indexOf("@");
		const hashRefIndex = pathWithMaybeRef.indexOf("#");
		let refSeparator = -1;
		if (atRefIndex >= 0 && hashRefIndex >= 0) {
			refSeparator = Math.min(atRefIndex, hashRefIndex);
		} else {
			refSeparator = atRefIndex >= 0 ? atRefIndex : hashRefIndex;
		}
		if (refSeparator < 0) {
			return { repo: url };
		}

		const repoPath = pathWithMaybeRef.slice(0, refSeparator);
		const ref = pathWithMaybeRef.slice(refSeparator + 1);
		if (!repoPath || !ref) {
			return { repo: url };
		}

		return {
			repo: `git@${scpLikeMatch[1] ?? ""}:${repoPath}`,
			ref,
		};
	}

	if (url.includes("://")) {
		try {
			const parsed = new URL(url);
			const fragmentRef = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : "";
			parsed.hash = "";
			const pathWithMaybeRef = parsed.pathname.replace(/^\/+/, "");
			const atRefIndex = pathWithMaybeRef.indexOf("@");
			if (atRefIndex >= 0) {
				const repoPath = pathWithMaybeRef.slice(0, atRefIndex);
				const ref = pathWithMaybeRef.slice(atRefIndex + 1);
				if (!repoPath || !ref) {
					return { repo: parsed.toString().replace(/\/$/, "") };
				}
				parsed.pathname = `/${repoPath}`;
				return {
					repo: parsed.toString().replace(/\/$/, ""),
					ref,
				};
			}

			if (fragmentRef) {
				return {
					repo: parsed.toString().replace(/\/$/, ""),
					ref: fragmentRef,
				};
			}

			return { repo: parsed.toString().replace(/\/$/, "") };
		} catch {
			return { repo: url };
		}
	}

	const slashIndex = url.indexOf("/");
	if (slashIndex < 0) {
		return { repo: url };
	}

	const pathWithMaybeRef = url.slice(slashIndex + 1);
	const atRefIndex = pathWithMaybeRef.indexOf("@");
	const hashRefIndex = pathWithMaybeRef.indexOf("#");
	let refSeparator = -1;
	if (atRefIndex >= 0 && hashRefIndex >= 0) {
		refSeparator = Math.min(atRefIndex, hashRefIndex);
	} else {
		refSeparator = atRefIndex >= 0 ? atRefIndex : hashRefIndex;
	}
	if (refSeparator < 0) {
		return { repo: url };
	}

	const repoPath = pathWithMaybeRef.slice(0, refSeparator);
	const ref = pathWithMaybeRef.slice(refSeparator + 1);
	if (!repoPath || !ref) {
		return { repo: url };
	}

	return {
		repo: `${url.slice(0, slashIndex)}/${repoPath}`,
		ref,
	};
}

function parseGenericGitUrl(url: string): GitSource | null {
	const { repo: repoWithoutRef, ref } = splitRef(url);
	let repo = repoWithoutRef;
	let host = "";
	let path = "";

	const scpLikeMatch = repoWithoutRef.match(/^git@([^:]+):(.+)$/);
	if (scpLikeMatch) {
		host = scpLikeMatch[1] ?? "";
		path = scpLikeMatch[2] ?? "";
	} else if (
		repoWithoutRef.startsWith("https://") ||
		repoWithoutRef.startsWith("http://") ||
		repoWithoutRef.startsWith("ssh://") ||
		repoWithoutRef.startsWith("git://")
	) {
		try {
			const parsed = new URL(repoWithoutRef);
			host = parsed.hostname;
			path = parsed.pathname.replace(/^\/+/, "");
		} catch {
			return null;
		}
	} else {
		const slashIndex = repoWithoutRef.indexOf("/");
		if (slashIndex < 0) {
			return null;
		}

		host = repoWithoutRef.slice(0, slashIndex);
		path = repoWithoutRef.slice(slashIndex + 1);
		if (!host.includes(".") && host !== "localhost") {
			return null;
		}

		repo = `https://${repoWithoutRef}`;
	}

	const normalizedPath = path.replace(/\.git$/, "").replace(/^\/+/, "");
	if (!host || !normalizedPath || normalizedPath.split("/").length < 2) {
		return null;
	}

	return {
		type: "git",
		repo,
		host,
		path: normalizedPath,
		ref,
		pinned: Boolean(ref),
	};
}

/**
 * Parse git source into normalized source information.
 */
export function parseGitUrl(source: string): GitSource | null {
	const trimmed = source.trim();
	const hasGitPrefix = trimmed.startsWith("git:");
	const normalizedSource = hasGitPrefix ? trimmed.slice(4).trim() : trimmed.replace(/^git\+/i, "");
	const url = normalizedSource;

	if (
		!hasGitPrefix &&
		!/^(https?|ssh|git):\/\//i.test(url) &&
		!/^git@[^:]+:/.test(url)
	) {
		return null;
	}

	const split = splitRef(url);

	const parseCandidate = (candidate: string): GitSource | null => {
		if (!hostedGitInfo) {
			return null;
		}
		const info = hostedGitInfo.fromUrl(candidate) as HostedGitInfoResult | null;
		if (!info) return null;
		if (split.ref && info.project?.includes("@")) {
			return null;
		}
		return {
			type: "git",
			repo: split.repo.startsWith("http://") || split.repo.startsWith("https://") || split.repo.startsWith("ssh://") || split.repo.startsWith("git://") || split.repo.startsWith("git@")
				? split.repo
				: `https://${split.repo}`,
			host: info.domain ?? "",
			path: `${info.user ?? ""}/${info.project ?? ""}`.replace(/\.git$/, ""),
			ref: info.committish || split.ref || undefined,
			pinned: Boolean(info.committish || split.ref),
		};
	};

	const hostedCandidates = [split.ref ? `${split.repo}#${split.ref}` : undefined, url].filter((value): value is string =>
		Boolean(value),
	);
	for (const candidate of hostedCandidates) {
		const info = parseCandidate(candidate);
		if (info) {
			return info;
		}
	}

	const httpsCandidates = [
		split.ref ? `https://${split.repo}#${split.ref}` : undefined,
		`https://${url}`,
	].filter((value): value is string => Boolean(value));
	for (const candidate of httpsCandidates) {
		const info = parseCandidate(candidate);
		if (info) {
			return info;
		}
	}

	return parseGenericGitUrl(url);
}
