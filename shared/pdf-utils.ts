import JSZip from "jszip";
import type { PdfAnnotationMap } from "./types";

export interface ZipContents {
    pdfBytes: ArrayBuffer;
    annotationMap: PdfAnnotationMap;
}

export async function loadZip(file: File): Promise<ZipContents> {
    const zip = await JSZip.loadAsync(file);

    const pdfEntry = Object.values(zip.files).find(
        (f) => !f.dir && f.name.endsWith(".pdf"),
    );
    if (!pdfEntry) throw new Error("No PDF file found in zip");

    const jsonEntry = Object.values(zip.files).find(
        (f) => !f.dir && f.name.endsWith(".json"),
    );
    if (!jsonEntry) throw new Error("No JSON annotations file found in zip");

    const [pdfBytes, jsonText] = await Promise.all([
        pdfEntry.async("arraybuffer"),
        jsonEntry.async("string"),
    ]);

    let annotationMap: PdfAnnotationMap;
    try {
        annotationMap = JSON.parse(jsonText) as PdfAnnotationMap;
    } catch {
        throw new Error("Failed to parse annotations JSON");
    }

    return { pdfBytes, annotationMap };
}
