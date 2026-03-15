import * as pdfjsLib from "pdfjs-dist";
import { PDFDocument } from "pdf-lib";
import { drawStroke } from "./draw";
import type { AnnotationMap } from "../../shared/types.ts";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

export async function exportPdf(
  pdfPath: string,
  pageCount: number,
  annotations: AnnotationMap,
  filename: string,
): Promise<void> {
  // Fetch original PDF
  const res = await fetch(`/api/pdf?path=${encodeURIComponent(pdfPath)}`);
  if (!res.ok)
    throw new Error(`Failed to fetch PDF for export (${res.status})`);
  const buffer = await res.arrayBuffer();
  const pdfDoc = await pdfjsLib.getDocument({ data: buffer }).promise;

  const outDoc = await PDFDocument.create();
  const SCALE = 2;

  for (let i = 0; i < pageCount; i++) {
    const page = await pdfDoc.getPage(i + 1);
    const viewport = page.getViewport({ scale: SCALE });

    // Render PDF page to offscreen canvas
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport }).promise;
    page.cleanup();

    // Draw annotations for this slide
    const strokes = annotations[i] ?? [];
    for (const stroke of strokes) {
      drawStroke(ctx, stroke, canvas.width, canvas.height);
    }

    // Embed as PNG page in output PDF
    const pngData = canvas.toDataURL("image/png");
    const pngBytes = dataURLToBytes(pngData);
    const pngImage = await outDoc.embedPng(pngBytes);
    const outPage = outDoc.addPage([
      viewport.width / SCALE,
      viewport.height / SCALE,
    ]);
    outPage.drawImage(pngImage, {
      x: 0,
      y: 0,
      width: outPage.getWidth(),
      height: outPage.getHeight(),
    });
  }

  // Trigger download
  const bytes = await outDoc.save();
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.replace(/\.pdf$/i, "") + "-annotated.pdf";
  a.click();
  URL.revokeObjectURL(url);
}

function dataURLToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
