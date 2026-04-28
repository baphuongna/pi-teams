export function isTextContent(item: { type: string; text?: string }): item is { type: "text"; text: string } {
	return item.type === "text" && typeof item.text === "string";
}

export function firstText(result: { content?: Array<{ type: string; text?: string }> }): string {
	const first = result.content?.find(isTextContent);
	return first?.text ?? "";
}

export function textFromToolResult(result: { content?: Array<{ type: string; text?: string }> }): string {
	return result.content?.filter(isTextContent).map((item) => item.text).join("\n") ?? "";
}
