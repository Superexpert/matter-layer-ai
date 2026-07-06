type PdfjsModule = {
  getDocument: (input: {
    data: Uint8Array;
    disableAutoFetch: boolean;
    disableFontFace: boolean;
    disableRange: boolean;
    disableStream: boolean;
    useWorkerFetch: boolean;
  }) => {
    destroy: () => Promise<void>;
    promise: Promise<{
      getPage: (pageNumber: number) => Promise<{
        cleanup: () => void;
        getTextContent: () => Promise<{
          items: Array<{ str?: string }>;
        }>;
      }>;
      numPages: number;
    }>;
  };
};

let pdfjsPromise: Promise<PdfjsModule> | null = null;

async function ensurePdfjsNodeGlobals() {
  const globalScope = globalThis as unknown as Record<string, unknown>;

  if (globalScope["DOMMatrix"] && globalScope["ImageData"] && globalScope["Path2D"]) {
    return;
  }

  const canvas = await import("@napi-rs/canvas");

  globalScope["DOMMatrix"] ??= canvas.DOMMatrix;
  globalScope["ImageData"] ??= canvas.ImageData;
  globalScope["Path2D"] ??= canvas.Path2D;
}

async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = ensurePdfjsNodeGlobals().then(async () => {
      const [pdfjs, worker] = await Promise.all([
        import("pdfjs-dist/legacy/build/pdf.mjs") as Promise<PdfjsModule>,
        import("pdfjs-dist/legacy/build/pdf.worker.mjs"),
      ]);

      (
        globalThis as typeof globalThis & {
          pdfjsWorker?: unknown;
        }
      ).pdfjsWorker = worker;

      return pdfjs;
    });
  }

  return pdfjsPromise;
}

function toUint8Array(bytes: Buffer | Uint8Array) {
  return new Uint8Array(bytes);
}

export async function extractPdfPages(bytes: Buffer | Uint8Array) {
  const pdfjs = await getPdfjs();
  const loadingTask = pdfjs.getDocument({
    data: toUint8Array(bytes),
    disableAutoFetch: true,
    disableFontFace: true,
    disableRange: true,
    disableStream: true,
    useWorkerFetch: false,
  });

  try {
    const document = await loadingTask.promise;
    const pageTexts: string[] = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);

      try {
        const textContent = await page.getTextContent();
        const text = textContent.items
          .map((item) => item.str ?? "")
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

        pageTexts.push(text);
      } finally {
        page.cleanup();
      }
    }

    return {
      pageCount: document.numPages,
      pageTexts,
    };
  } finally {
    await loadingTask.destroy();
  }
}
