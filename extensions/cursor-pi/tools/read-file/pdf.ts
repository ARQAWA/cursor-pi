type PdfParseModule = typeof import("pdf-parse");

let pdfParseModule: Promise<PdfParseModule> | undefined;

// pdf.js replaces globalThis.navigator when it loads. os.availableParallelism reads navigator.hardwareConcurrency,
// which rules.ts uses for ripgrep's thread count, so the host navigator is put back once pdf-parse is loaded.
function loadPdfParse(): Promise<PdfParseModule> {
	pdfParseModule ??= importKeepingNavigator();
	return pdfParseModule;
}

async function importKeepingNavigator(): Promise<PdfParseModule> {
	const hostNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
	try {
		return await import("pdf-parse");
	} finally {
		if (hostNavigator) Object.defineProperty(globalThis, "navigator", hostNavigator);
	}
}

// Cursor's PDF text: pdf-parse's getText() over the PDF bytes, through the same pdf.js build (pdfjs-dist 5.4.296).
async function extractPdfText(bytes: Buffer): Promise<string> {
	const { PDFParse } = await loadPdfParse();
	const parser = new PDFParse({ data: bytes });
	try {
		const result = await parser.getText();
		return typeof result.text === "string" ? result.text : "";
	} finally {
		await parser.destroy();
	}
}

// Cursor's pdfTextCache: the text of each PDF read so far, keyed by resolved path.
const pdfTextCache = new Map<string, string>();

function normalizeLineEndings(content: string): string {
	return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export async function readPdfText(file: string, bytes: Buffer): Promise<string> {
	const cached = pdfTextCache.get(file);
	if (cached !== undefined) return cached;
	const text = normalizeLineEndings(await extractPdfText(bytes));
	pdfTextCache.set(file, text);
	return text;
}
