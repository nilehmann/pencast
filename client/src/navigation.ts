import { stores } from "./stores.svelte";
import { send } from "./ws-client";

export function prevSlide(): void {
  const activePdf = stores.activePdf;
  if (!activePdf) return;

  const slide = activePdf.currentSlide;
  if (slide <= 0) return;
  send({ type: "slide_change", source: "pdf", slide: slide - 1 });
}

export function nextSlide(): void {
  const activePdf = stores.activePdf;
  if (!activePdf) return;

  const slide = activePdf.currentSlide;
  const pages = activePdf.pageCount;
  if (slide >= pages - 1) return;
  send({ type: "slide_change", source: "pdf", slide: slide + 1 });
}

export function prevWbSlide(): void {
  const slide = stores.whiteboard.slide;
  if (slide <= 0) return;
  send({ type: "slide_change", source: "whiteboard", slide: slide - 1 });
}

export function nextWbSlide(): void {
  const slide = stores.whiteboard.slide;
  const pages = stores.whiteboard.pageCount;
  if (slide >= pages - 1) {
    send({ type: "whiteboard_add_page" });
  } else {
    send({ type: "slide_change", source: "whiteboard", slide: slide + 1 });
  }
}

export function prevHtmlSlide(): void {
  const activeHtml = stores.activeHtml;
  if (!activeHtml) return;

  const slide = activeHtml.slide;
  if (slide <= 0) return;
  send({ type: "slide_change", source: "html", slide: slide - 1 });
}

export function nextHtmlSlide(): void {
  const activeHtml = stores.activeHtml;
  if (!activeHtml) return;

  const slide = activeHtml.slide;
  const pages = activeHtml.pageCount;
  if (slide >= pages - 1) {
    send({ type: "html_add_page" });
  } else {
    send({ type: "slide_change", source: "html", slide: slide + 1 });
  }
}

export function prevScreenSlide(): void {
  const s = stores.activeScreen;
  if (!s || s.slide <= 0) return;
  send({ type: "slide_change", source: "screen", slide: s.slide - 1 });
}

export function nextScreenSlide(): void {
  const s = stores.activeScreen;
  if (!s) return;
  if (s.slide >= s.pageCount - 1) {
    send({ type: "screen_add_page" });
  } else {
    send({ type: "slide_change", source: "screen", slide: s.slide + 1 });
  }
}
