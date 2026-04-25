import type { PdfState, PdfAnnotationMap } from "../../shared/types";
import type { PDFDocumentProxy } from "pdfjs-dist";

// ── Reactive store class ──────────────────────────────────────────────────────

class ViewerStores {
  activePdf = $state<PdfState | null>(null);
  pdfDoc = $state<PDFDocumentProxy | null>(null);
  pdfBytes = $state<ArrayBuffer | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);

  // Zip browser state
  zipEntries = $state<any[] | null>(null);
  zipLoadPdf = $state<
    | ((
        path: string,
      ) => Promise<{
        pdfBytes: ArrayBuffer;
        annotationMap: PdfAnnotationMap;
        subPageCounts: Record<number, number>;
      }>)
    | null
  >(null);
  showBrowser = $state(false);

  constructor() {
    // Clear error when navigating
    $effect.root(() => {
      $effect(() => {
        void this.activePdf?.position.slide;
        this.error = null;
      });
    });
  }

  // ── Navigation ──────────────────────────────────────────────────────────────

  prevSlide() {
    if (!this.activePdf) return;
    if (this.activePdf.position.slide > 0) {
      this.activePdf.position.slide--;
      this.activePdf.position.page = 0;
    }
  }

  nextSlide() {
    if (!this.activePdf) return;
    if (this.activePdf.position.slide < this.activePdf.pageCount - 1) {
      this.activePdf.position.slide++;
      this.activePdf.position.page = 0;
    }
  }

  prevSubPage() {
    if (!this.activePdf) return;
    if (this.activePdf.position.page > 0) {
      this.activePdf.position.page--;
    }
  }

  nextSubPage() {
    if (!this.activePdf) return;
    const currentSubPageCount =
      this.activePdf.subPageCounts[this.activePdf.position.slide] ??
      this.activePdf.annotations[this.activePdf.position.slide]?.length ??
      1;
    if (this.activePdf.position.page < currentSubPageCount - 1) {
      this.activePdf.position.page++;
    }
  }

  navigateToSlide(slide: number) {
    if (!this.activePdf) return;
    this.activePdf.position.slide = slide;
    this.activePdf.position.page = 0;
  }

  // ── PDF loading ──────────────────────────────────────────────────────────

  setPdfState(
    path: string,
    name: string,
    pdfBytes: ArrayBuffer,
    annotationMap: PdfAnnotationMap,
    subPageCounts: Record<number, number>,
  ) {
    this.pdfBytes = pdfBytes;
    this.activePdf = {
      path,
      name,
      pageCount: 0,
      position: { slide: 0, page: 0 },
      annotations: annotationMap,
      subPageCounts,
    };
  }

  updatePageCount(pageCount: number) {
    if (this.activePdf) {
      this.activePdf.pageCount = pageCount;
    }
  }

  reset() {
    this.activePdf = null;
    this.pdfDoc = null;
    this.pdfBytes = null;
    this.zipEntries = null;
    this.zipLoadPdf = null;
    this.showBrowser = false;
    this.loading = false;
    this.error = null;
  }

  // ── Derived state ────────────────────────────────────────────────────────────

  get currentSubPageCount(): number {
    if (!this.activePdf) return 1;
    const slide = this.activePdf.position.slide;
    return (
      this.activePdf.subPageCounts[slide] ??
      this.activePdf.annotations[slide]?.length ??
      1
    );
  }

  get strokes() {
    if (!this.activePdf) return [];
    const slide = this.activePdf.position.slide;
    const page = this.activePdf.position.page;
    return this.activePdf.annotations[slide]?.[page] ?? [];
  }
}

// ── Singleton instance ───────────────────────────────────────────────────────

export const stores = new ViewerStores();
