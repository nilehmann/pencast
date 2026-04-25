import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from "pdfjs-dist";
import type { PdfState } from "./types";

export interface PdfViewerStores {
  pdfDoc: PDFDocumentProxy | null;
  activePdf: PdfState | null;
}

export abstract class PdfViewerState {
  pdfCanvas = $state<HTMLCanvasElement>(undefined!);
  blankCanvas = $state<HTMLCanvasElement>(undefined!);
  container = $state<HTMLDivElement>(undefined!);
  currentPage = $state<PDFPageProxy | null>(null);
  currentViewport = $state<PageViewport | null>(null);
  pdfReady = $state(false);
  loadError = $state<string | null>(null);
  rendering = false;
  pendingSlide: number | null = null;

  get subPage() {
    return this.stores.activePdf?.position.page ?? 0;
  }

  #destroy: () => void;

  constructor(protected stores: PdfViewerStores) {
    this.#destroy = $effect.root(() => {
      // Re-render when the active slide or sub-page changes.
      $effect(() => {
        const pos = stores.activePdf?.position;
        if (stores.pdfDoc && pos !== undefined) {
          void pos.page; // track sub-page changes so blankCanvas is updated
          void this.renderSlide(pos.slide);
        }
      });

      // Re-render when the container is resized.
      $effect(() => {
        if (!this.container) return;
        const observer = new ResizeObserver(() => {
          const s = stores.activePdf?.position.slide;
          if (stores.pdfDoc && s !== undefined) void this.renderSlide(s);
        });
        observer.observe(this.container);
        return () => observer.disconnect();
      });
    });
  }

  destroy(): void {
    this.#destroy();
  }

  abstract nextSlide(): void;
  abstract prevSlide(): void;
  abstract canInteract(): boolean;

  async renderSlide(s: number): Promise<void> {
    if (!this.stores.pdfDoc || !this.pdfCanvas || !this.container) return;
    if (this.rendering) {
      this.pendingSlide = s;
      return;
    }
    this.rendering = true;

    // Clear stale content so the old slide doesn't flash when
    // unhiding the PDF canvas (e.g. navigating away from a sub-page).
    this.pdfCanvas
      .getContext("2d")!
      .clearRect(0, 0, this.pdfCanvas.width, this.pdfCanvas.height);

    try {
      const page = await this.stores.pdfDoc.getPage(s + 1);
      const containerWidth = this.container.clientWidth;
      const containerHeight = this.container.clientHeight;
      const viewport = page.getViewport({ scale: 1 });
      const scale = Math.min(
        containerWidth / viewport.width,
        containerHeight / viewport.height,
      );
      const scaled = page.getViewport({ scale });

      const dpr = window.devicePixelRatio || 1;

      const offscreen = document.createElement("canvas");
      offscreen.width = scaled.width * dpr;
      offscreen.height = scaled.height * dpr;
      const offCtx = offscreen.getContext("2d")!;
      offCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      await page.render({ canvasContext: offCtx, viewport: scaled }).promise;
      this.currentPage = page;
      this.currentViewport = scaled;
      page.cleanup();

      this.pdfCanvas.width = scaled.width * dpr;
      this.pdfCanvas.height = scaled.height * dpr;
      this.pdfCanvas.style.width = `${scaled.width}px`;
      this.pdfCanvas.style.height = `${scaled.height}px`;
      this.pdfCanvas.getContext("2d")!.drawImage(offscreen, 0, 0);

      // Update blank canvas dimensions to match PDF canvas
      if (this.blankCanvas) {
        this.blankCanvas.width = this.pdfCanvas.width;
        this.blankCanvas.height = this.pdfCanvas.height;
        this.blankCanvas.style.width = this.pdfCanvas.style.width;
        this.blankCanvas.style.height = this.pdfCanvas.style.height;
        const bctx = this.blankCanvas.getContext("2d")!;
        bctx.fillStyle = "#ffffff";
        bctx.fillRect(0, 0, this.blankCanvas.width, this.blankCanvas.height);
      }

      this.pdfReady = true;
    } finally {
      this.rendering = false;
      if (this.pendingSlide !== null) {
        const next = this.pendingSlide;
        this.pendingSlide = null;
        void this.renderSlide(next);
      }
    }
  }

  async handleAnnotationClick(e: MouseEvent): Promise<void> {
    const activePdf = this.stores.activePdf;
    if (!activePdf) return;
    if ((activePdf.position.page ?? 0) > 0) return;

    if (
      !this.currentPage ||
      !this.currentViewport ||
      !this.pdfCanvas ||
      !this.stores.pdfDoc
    )
      return;
    const rect = this.pdfCanvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    const [pdfX, pdfY] = this.currentViewport.convertToPdfPoint(cssX, cssY);

    const annotations = await this.currentPage.getAnnotations();
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
              ? await this.stores.pdfDoc.getDestination(ann.dest)
              : ann.dest;
          if (dest) {
            const pageIndex = await this.stores.pdfDoc.getPageIndex(dest[0]);
            activePdf.position.slide = pageIndex;
          }
        } else if (ann.action) {
          const pc = activePdf.pageCount;
          if (ann.action === "GoToNextPage") this.nextSlide();
          else if (ann.action === "GoToPrevPage") this.prevSlide();
          else if (ann.action === "FirstPage") activePdf.position.slide = 0;
          else if (ann.action === "LastPage") activePdf.position.slide = pc - 1;
        }
        break;
      }
    }
  }

  // A click on the left quarter of the slide area goes to the previous slide and a click
  // elsewhere advances to the next slide. ctrl+shift+click performs a PDF annotation
  // hit-test and follows any link under the cursor.
  onViewerClick(e: MouseEvent): void {
    if (!this.canInteract()) return;
    if (e.ctrlKey && e.shiftKey) {
      void this.handleAnnotationClick(e);
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const isLeftQuarter = e.clientX - rect.left < rect.width / 4;
    if (isLeftQuarter) {
      this.prevSlide();
    } else {
      this.nextSlide();
    }
  }
}
