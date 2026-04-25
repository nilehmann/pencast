import JSZip from "jszip";
import type { AnnotationsFile, PdfAnnotationMap } from "./types";

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
            try {
                const text = await jsonEntry.async("string");
                const file = JSON.parse(text) as AnnotationsFile;
                annotationMap = file.annotations ?? {};
                subPageCounts = file.subPageCounts ?? {};
            } catch {
                // Invalid JSON — no annotations
            }
        }

        return { pdfBytes, annotationMap, subPageCounts };
    }

    return { entries, loadPdf };
}
