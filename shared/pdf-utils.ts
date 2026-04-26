import JSZip from "jszip";
import type { PdfAnnotationMap } from "./types";
import { parseAnnotationsFile } from "./annotation-utils.js";

export interface ZipContents {
    pdfBytes: ArrayBuffer;
    annotationMap: PdfAnnotationMap;
    subPageCounts: Record<number, number>;
}

export interface ZipEntry {
    name: string;
    path: string;
    isPdf: boolean;
}

export async function listZip(file: File): Promise<{
    entries: ZipEntry[];
    loadPdf: (pdfPath: string) => Promise<ZipContents>;
}> {
    const zip = await JSZip.loadAsync(file);
    const entries: ZipEntry[] = [];

    zip.forEach((relativePath, entry) => {
        if (!entry.dir) {
            entries.push({
                name: entry.name.split("/").pop() ?? entry.name,
                path: relativePath,
                isPdf: relativePath.toLowerCase().endsWith(".pdf"),
            });
        }
    });

    async function loadPdf(pdfPath: string): Promise<ZipContents> {
        const pdfEntry = zip.file(pdfPath);
        if (!pdfEntry) throw new Error(`File not found in zip: ${pdfPath}`);

        const pdfBytes = await pdfEntry.async("arraybuffer");

        const jsonPath = pdfPath.replace(/\.pdf$/i, ".annotations.json");
        const jsonEntry = zip.file(jsonPath);
        let annotationMap: PdfAnnotationMap = {};
        let subPageCounts: Record<number, number> = {};
        if (jsonEntry) {
            const text = await jsonEntry.async("string");
            const parsed = parseAnnotationsFile(JSON.parse(text));
            annotationMap = parsed.annotations;
            subPageCounts = parsed.subPageCounts;
        }

        return { pdfBytes, annotationMap, subPageCounts };
    }

    return { entries, loadPdf };
}
