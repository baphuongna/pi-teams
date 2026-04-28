import type { CrewTheme } from "./theme-adapter.ts";

export interface DynamicCrewBorderOptions {
	color?: (value: string) => string;
	char?: string;
}

export class DynamicCrewBorder {
	private readonly theme: CrewTheme;
	private readonly color?: (value: string) => string;
	private readonly char: string;

	constructor(theme: CrewTheme, options: DynamicCrewBorderOptions = {}) {
		this.theme = theme;
		this.color = options.color;
		this.char = options.char && options.char.length > 0 ? options.char : "─";
	}

	render(width: number): string[] {
		const line = this.char.repeat(Math.max(0, width));
		return [this.color ? this.color(line) : this.theme.fg("border", line)];
	}

	invalidate(): void {}
}
