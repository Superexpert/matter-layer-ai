import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { extractPdfPages } from "../../services/matter-documents/pdfjs";

function textPdfFixture() {
  return Buffer.from(`%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >> endobj
4 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >> endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
6 0 obj << /Length 44 >> stream
BT /F1 24 Tf 100 700 Td (First page text) Tj ET
endstream endobj
7 0 obj << /Length 45 >> stream
BT /F1 24 Tf 100 700 Td (Second page text) Tj ET
endstream endobj
xref
0 8
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000121 00000 n 
0000000241 00000 n 
0000000361 00000 n 
0000000431 00000 n 
0000000525 00000 n 
trailer << /Root 1 0 R /Size 8 >>
startxref
620
%%EOF`);
}

describe("pdfjs extraction", () => {
  it("extracts page text without the fake worker module error", async () => {
    const result = await extractPdfPages(textPdfFixture());

    expect(result.pageCount).toBe(2);
    expect(result.pageTexts[0]).toContain("First page text");
    expect(result.pageTexts[1]).toContain("Second page text");
  });

  it("extracts text from bundled criminal sample PDFs", async () => {
    const result = await extractPdfPages(
      readFileSync(
        path.join(
          process.cwd(),
          "sample-evidence",
          "criminal",
          "04_CAD_Dispatch_Log.pdf",
        ),
      ),
    );

    expect(result.pageCount).toBe(1);
    expect(result.pageTexts[0]).toContain("Computer-Aided Dispatch");
    expect(result.pageTexts[0]).toContain("CAD-26-0114-7821");
  });

  it("initializes Node canvas globals before importing pdfjs", () => {
    const source = readFileSync(
      path.join(process.cwd(), "services", "matter-documents", "pdfjs.ts"),
      "utf8",
    );

    expect(source).toContain('import("@napi-rs/canvas")');
    expect(source).toContain('globalScope["DOMMatrix"]');
    expect(source.indexOf("ensurePdfjsNodeGlobals().then")).toBeLessThan(
      source.indexOf('import("pdfjs-dist/legacy/build/pdf.mjs")'),
    );
  });

  it("does not use a runtime require fallback in the representation service", () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        "services",
        "matter-documents",
        "representations.ts",
      ),
      "utf8",
    );

    expect(source).not.toContain("return require(modulePath)");
    expect(source).not.toContain("Function(\"modulePath\"");
  });
});
