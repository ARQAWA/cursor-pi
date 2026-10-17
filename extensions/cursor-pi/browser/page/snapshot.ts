// The snapshot text: the tree the page-side builder returns, printed as the YAML that browser_snapshot shows.
export interface SnapshotNode {
	ref?: string;
	role?: string | null;
	name?: string;
	tag?: string;
	states?: string[];
	nth?: number;
	value?: string;
	placeholder?: string;
	options?: string;
	level?: number;
	children?: SnapshotNode[];
}

export interface SnapshotStats {
	totalRefs: number;
	interactiveRefs: number;
	maxDepth: number;
}

// Names with a colon, a quote or a bracket are quoted, with quotes escaped.
function scalar(text: string): string {
	return text.includes(":") || text.includes('"') || text.includes("[") ? `"${text.replace(/"/g, '\\"')}"` : text;
}

export function snapshotYaml(node: SnapshotNode, depth = 0): string {
	const indent = "  ".repeat(depth);
	const lines: string[] = [];
	if (node.role) lines.push(`${indent}- role: ${node.role}`);
	if (node.name) lines.push(`${indent}  name: ${scalar(String(node.name).replace(/\n/g, " ").trim())}`);
	if (node.ref) lines.push(`${indent}  ref: ${node.ref}`);
	if (node.nth !== undefined && node.nth > 0) lines.push(`${indent}  nth: ${node.nth}`);
	if (node.value !== undefined && node.value !== "") {
		lines.push(`${indent}  value: ${scalar(String(node.value).replace(/\n/g, "\\n").substring(0, 100))}`);
	}
	if (node.placeholder !== undefined && node.placeholder !== "") lines.push(`${indent}  placeholder: ${node.placeholder}`);
	if (node.options !== undefined && node.options !== "") {
		const options = String(node.options).replace(/\n/g, " ").substring(0, 300);
		lines.push(options.includes(":") || options.includes('"') ? `${indent}  options: "${options.replace(/"/g, '\\"')}"` : `${indent}  options: [${options}]`);
	}
	if (node.level !== undefined) lines.push(`${indent}  level: ${node.level}`);
	if (node.states !== undefined && node.states.length > 0) lines.push(`${indent}  states: [${node.states.join(", ")}]`);
	if (node.children !== undefined && node.children.length > 0) {
		lines.push(`${indent}  children:`);
		for (const child of node.children) lines.push(snapshotYaml(child, depth + 2));
	}
	return lines.join("\n");
}
