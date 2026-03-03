import { writable } from 'svelte/store';
import type { AnnotationMap, DeviceRole } from '../../shared/types.ts';
import type { AppState } from '../../shared/types.ts';

export const authToken = writable<string>(sessionStorage.getItem('authToken') ?? '');
export const deviceRole = writable<DeviceRole | null>(null);
export const activePdfPath = writable<string | null>(null);
export const activePdfName = writable<string | null>(null);
export const pageCount = writable<number>(0);
export const currentSlide = writable<number>(0);
export const annotations = writable<AnnotationMap>({});

export function applyState(state: AppState): void {
  activePdfPath.set(state.activePdfPath);
  activePdfName.set(state.activePdfName);
  pageCount.set(state.pageCount);
  currentSlide.set(state.currentSlide);
  annotations.set(state.annotations);
}
