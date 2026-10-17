// Element refs: the snapshot marks each element with data-cursor-ref="eN". A ref may also be given as @eN or ref=eN.
export const REF_ATTRIBUTE = "data-cursor-ref";

export function normalizeRef(ref: string | undefined): string | undefined {
	if (!ref) return ref;
	const trimmed = ref.trim();
	if (trimmed.startsWith("@")) return trimmed.slice(1);
	if (trimmed.startsWith("ref=")) return trimmed.slice(4);
	return trimmed;
}
