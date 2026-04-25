import type {
    PDFDocumentProxy,
    PDFPageProxy,
    PageViewport,
} from "pdfjs-dist";

interface AnnotationClickHandlerOptions {
    page: number;
    subPage?: number;
    onNavigateToSlide?: (slide: number) => void;
    onPrevSlide?: () => void;
    onNextSlide?: () => void;
}

/**
 * Handles clicking on PDF annotations (links, actions).
 * Checks if the click is on an annotation and handles the action.
 * Returns true if an annotation was clicked and handled, false otherwise.
 */
export async function handleAnnotationClick(
    e: MouseEvent,
    currentPage: PDFPageProxy,
    currentViewport: PageViewport,
    pdfCanvas: HTMLCanvasElement,
    pdfDoc: PDFDocumentProxy,
    options: AnnotationClickHandlerOptions,
): Promise<boolean> {
    // Don't handle annotations on sub-pages
    if ((options.subPage ?? 0) > 0) return false;

    const rect = pdfCanvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    const [pdfX, pdfY] = currentViewport.convertToPdfPoint(cssX, cssY);

    const annotations = await currentPage.getAnnotations();
    for (const ann of annotations) {
        if (ann.subtype !== "Link") continue;
        const [x1, y1, x2, y2]: number[] = ann.rect;
        if (
            pdfX >= Math.min(x1, x2) &&
            pdfX <= Math.max(x1, x2) &&
            pdfY >= Math.min(y1, y2) &&
            pdfY <= Math.max(y1, y2)
        ) {
            if (ann.url) {
                const tab = window.open(ann.url, "_blank");
                tab?.focus();
            } else if (ann.dest != null) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const dest: any[] | null =
                    typeof ann.dest === "string"
                        ? await pdfDoc.getDestination(ann.dest)
                        : ann.dest;
                if (dest) {
                    const pageIndex = await pdfDoc.getPageIndex(dest[0]);
                    options.onNavigateToSlide?.(pageIndex);
                }
            } else if (ann.action) {
                const pc = pdfDoc.numPages;
                if (ann.action === "GoToNextPage") options.onNextSlide?.();
                else if (ann.action === "GoToPrevPage") options.onPrevSlide?.();
                else if (ann.action === "FirstPage")
                    options.onNavigateToSlide?.(0);
                else if (ann.action === "LastPage")
                    options.onNavigateToSlide?.(pc - 1);
            }
            return true;
        }
    }
    return false;
}
