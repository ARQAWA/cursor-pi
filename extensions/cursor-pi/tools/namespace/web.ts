import { register as registerWebFetch } from "./web-fetch.ts";
import { register as registerWebSearch } from "./web-search.ts";

// Cursor's WebSearch and WebFetch, for the cursor namespace.
export function register(): void {
	registerWebSearch();
	registerWebFetch();
}
