import { get } from "svelte/store";
import {
  currentSlide,
  pageCount,
  whiteboardSlide,
  whiteboardAnnotations,
  htmlSlide,
  htmlPageCount,
} from "./stores";
import { send } from "./ws-client";

export function prevSlide(): void {
  const slide = get(currentSlide);
  if (slide <= 0) return;
  send({ type: "slide_change", source: "pdf", slide: slide - 1 });
}

export function nextSlide(): void {
  const slide = get(currentSlide);
  const pages = get(pageCount);
  if (slide >= pages - 1) return;
  send({ type: "slide_change", source: "pdf", slide: slide + 1 });
}

export function prevWbSlide(): void {
  const slide = get(whiteboardSlide);
  if (slide <= 0) return;
  send({ type: "slide_change", source: "whiteboard", slide: slide - 1 });
}

export function nextWbSlide(): void {
  const slide = get(whiteboardSlide);
  const pages = get(whiteboardAnnotations).length;
  if (slide >= pages - 1) {
    send({ type: "whiteboard_add_page" });
  } else {
    send({ type: "slide_change", source: "whiteboard", slide: slide + 1 });
  }
}

export function prevHtmlSlide(): void {
  const slide = get(htmlSlide);
  if (slide <= 0) return;
  send({ type: "slide_change", source: "html", slide: slide - 1 });
}

export function nextHtmlSlide(): void {
  const slide = get(htmlSlide);
  const pages = get(htmlPageCount);
  if (slide >= pages - 1) {
    send({ type: "html_add_page" });
  } else {
    send({ type: "slide_change", source: "html", slide: slide + 1 });
  }
}
