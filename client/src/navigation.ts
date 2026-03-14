import { stores } from "./stores.svelte";
import { send } from "./ws-client";

export function prevSlide(): void {
  const slide = stores.currentSlide;
  if (slide <= 0) return;
  send({ type: "slide_change", source: "pdf", slide: slide - 1 });
}

export function nextSlide(): void {
  const slide = stores.currentSlide;
  const pages = stores.pageCount;
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
  const pages = stores.whiteboard.annotations.length;
  if (slide >= pages - 1) {
    send({ type: "whiteboard_add_page" });
  } else {
    send({ type: "slide_change", source: "whiteboard", slide: slide + 1 });
  }
}

export function prevHtmlSlide(): void {
  const slide = stores.htmlSlide;
  if (slide <= 0) return;
  send({ type: "slide_change", source: "html", slide: slide - 1 });
}

export function nextHtmlSlide(): void {
  const slide = stores.htmlSlide;
  const pages = stores.htmlAnnotations.length;
  if (slide >= pages - 1) {
    send({ type: "html_add_page" });
  } else {
    send({ type: "slide_change", source: "html", slide: slide + 1 });
  }
}
