<script lang="ts">
  import * as pdfjsLib from 'pdfjs-dist';
  import type { PDFDocumentProxy } from 'pdfjs-dist';
  import { authToken, activePdfPath, currentSlide, pageCount } from './stores.ts';

  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

  let canvas: HTMLCanvasElement;
  let container: HTMLDivElement;
  let pdfDoc = $state<PDFDocumentProxy | null>(null);
  let rendering = false;
  let pendingSlide: number | null = null;

  // Load PDF when activePdfPath changes
  $effect(() => {
    const path = $activePdfPath;
    const token = $authToken;
    if (!path) return;
    loadPdf(path, token);
  });

  // Re-render when slide changes
  $effect(() => {
    const slide = $currentSlide;
    if (pdfDoc) renderSlide(slide);
  });

  async function loadPdf(path: string, token: string) {
    const url = `/api/pdf?path=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    if (!res.ok) { console.error('Failed to fetch PDF'); return; }
    const buffer = await res.arrayBuffer();
    pdfDoc = await pdfjsLib.getDocument({ data: buffer }).promise;
    pageCount.set(pdfDoc.numPages);
    renderSlide($currentSlide);
  }

  async function renderSlide(slide: number) {
    if (!pdfDoc || !canvas || !container) return;
    if (rendering) { pendingSlide = slide; return; }
    rendering = true;

    try {
      const page = await pdfDoc.getPage(slide + 1);
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;
      const viewport = page.getViewport({ scale: 1 });
      const scale = Math.min(containerWidth / viewport.width, containerHeight / viewport.height);
      const scaled = page.getViewport({ scale });

      const dpr = window.devicePixelRatio || 1;
      canvas.width = scaled.width * dpr;
      canvas.height = scaled.height * dpr;
      canvas.style.width = `${scaled.width}px`;
      canvas.style.height = `${scaled.height}px`;

      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      await page.render({ canvasContext: ctx, viewport: scaled }).promise;
      page.cleanup();
    } finally {
      rendering = false;
      if (pendingSlide !== null) {
        const next = pendingSlide;
        pendingSlide = null;
        renderSlide(next);
      }
    }
  }

  // Resize observer
  $effect(() => {
    if (!container) return;
    const observer = new ResizeObserver(() => {
      if (pdfDoc) renderSlide($currentSlide);
    });
    observer.observe(container);
    return () => observer.disconnect();
  });
</script>

<div class="pdf-container" bind:this={container}>
  {#if !$activePdfPath}
    <p class="hint">No PDF loaded</p>
  {:else if !pdfDoc}
    <p class="hint">Loading…</p>
  {/if}
  <canvas bind:this={canvas}></canvas>
</div>

<style>
  .pdf-container {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #1a1a1a;
    overflow: hidden;
    position: relative;
  }
  canvas {
    display: block;
    box-shadow: 0 2px 16px rgba(0,0,0,0.5);
  }
  .hint {
    color: #888;
    position: absolute;
  }
</style>
