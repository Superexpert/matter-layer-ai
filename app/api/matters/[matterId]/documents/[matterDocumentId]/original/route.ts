import { readMatterDocumentFile } from "@/services/matter-documents/storage";
import { requireCurrentUser } from "@/services/users/user-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function contentDispositionFileName(fileName: string) {
  const asciiFileName = fileName
    .replace(/[\r\n"]/g, " ")
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/\s+/g, " ")
    .trim() || "matter-document";

  return `inline; filename="${asciiFileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{
      matterDocumentId: string;
      matterId: string;
    }>;
  },
) {
  try {
    await requireCurrentUser();
  } catch {
    return Response.json({ error: "Authentication is required." }, { status: 401 });
  }

  const { matterDocumentId, matterId } = await params;
  let file;

  try {
    file = await readMatterDocumentFile({
      matterDocumentId,
      matterId,
    });
  } catch {
    return Response.json({ error: "Matter document was not found." }, { status: 404 });
  }

  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": contentDispositionFileName(file.fileName),
      "Content-Length": String(file.size),
      "Content-Type": file.contentType ?? "application/octet-stream",
    },
  });
}
