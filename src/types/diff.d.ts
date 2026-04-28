declare module "diff" {
	export interface Change {
		value: string;
		count?: number;
		added?: boolean;
		removed?: boolean;
	}

	export interface DiffOptions {
		ignoreCase?: boolean;
		newlineIsToken?: boolean;
		ignoreWhitespace?: boolean;
		stripTrailingCr?: boolean;
		oneChangePerToken?: boolean;
	}

	export function diffWords(oldStr: string, newStr: string, options?: DiffOptions): Change[];
}
