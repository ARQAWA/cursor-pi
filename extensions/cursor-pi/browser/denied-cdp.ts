// CDP methods that browser_cdp refuses. Cursor's own list is not in the captured extension slices, so this list is rebuilt
// from the tool text: Input.* is focus-sensitive, and the rest are browser-wide, storage, cookie, permission, download,
// target-management, filesystem-backed file input, system-level, or navigation and history commands.
const DENIED_PREFIXES = ["Input.", "Browser.", "Target.", "Storage.", "SystemInfo.", "IO."];

const DENIED_METHODS = new Set([
	"Network.getAllCookies",
	"Network.getCookies",
	"Network.setCookie",
	"Network.setCookies",
	"Network.deleteCookies",
	"Network.clearBrowserCookies",
	"Network.clearBrowserCache",
	"Page.setDownloadBehavior",
	"Page.navigate",
	"Page.navigateToHistoryEntry",
	"Page.resetNavigationHistory",
	"DOM.setFileInputFiles",
]);

export function isDeniedCdpMethod(method: string): boolean {
	return DENIED_METHODS.has(method) || DENIED_PREFIXES.some((prefix) => method.startsWith(prefix));
}
