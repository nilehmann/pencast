<script lang="ts">
    import { stores } from "./stores.svelte";
    import { connect, send, BACKOFF_MS } from "./ws-client";
    import { SwipeGesture } from "./gestures.svelte";
    import {
        prevSlide,
        nextSlide,
        prevWbSlide,
        nextWbSlide,
        prevHtmlSlide,
        nextHtmlSlide,
    } from "./navigation";
    import FileBrowser from "./FileBrowser.svelte";
    import Modal from "./Modal.svelte";
    import SlideView from "./SlideView.svelte";
    import Toolbar from "./Toolbar.svelte";
    import DebugConsole from "./DebugConsole.svelte";
    import NavFab from "./NavFab.svelte";
    import type { DeviceRole } from "../../shared/types";

    let showBrowser = $state(false);
    let showHtmlBrowser = $state(false);
    let showRoleModal = $state(false);
    let showDebugConsole = $state(false);

    // ── Finger swipe gesture (slide navigation) ───────────────────────────────
    const swipe = new SwipeGesture();

    function isSwipeBlocked(): boolean {
        return (
            !role ||
            role !== "presenter" ||
            (!pdfPath &&
                !stores.activeMode.whiteboard &&
                !(stores.activeMode.base === "html")) ||
            showRoleModal ||
            showBrowser ||
            showHtmlBrowser
        );
    }

    function onSwipePointerDown(e: PointerEvent): void {
        if (isSwipeBlocked()) return;
        swipe.onPointerDown(e);
    }

    function onSwipePointerMove(e: PointerEvent): void {
        if (isSwipeBlocked()) return;
        swipe.onPointerMove(e);
    }

    function onSwipePointerUp(e: PointerEvent): void {
        const triggered = swipe.onPointerUp(e);
        if (!triggered || isSwipeBlocked()) return;
        if (stores.activeMode.whiteboard) {
            if (triggered === "right") prevWbSlide();
            else if (triggered === "left") nextWbSlide();
        } else if (stores.activeMode.base === "html") {
            if (triggered === "right") prevHtmlSlide();
            else if (triggered === "left") nextHtmlSlide();
        } else {
            if (triggered === "right") prevSlide();
            else if (triggered === "left") nextSlide();
        }
    }

    function onSwipePointerCancel(e: PointerEvent): void {
        swipe.onPointerCancel(e);
    }

    // ── 3-finger double-tap gesture (debug console toggle) ────────────────────
    const THREE_FINGER_DOWN_WINDOW_MS = 300;
    const DOUBLE_TAP_WINDOW_MS = 400;

    const activePointerIds = new Set<number>();
    let firstPointerDownTime: number | null = null;
    let threeFingerTapDetected = false;
    let firstTapTime: number | null = null;
    let doubleTapTimer: ReturnType<typeof setTimeout> | null = null;

    function onCapturePointerDown(e: PointerEvent): void {
        if (e.pointerType !== "touch") return;
        if (activePointerIds.size === 0) firstPointerDownTime = Date.now();
        activePointerIds.add(e.pointerId);

        if (
            activePointerIds.size >= 3 &&
            firstPointerDownTime !== null &&
            Date.now() - firstPointerDownTime <= THREE_FINGER_DOWN_WINDOW_MS
        ) {
            threeFingerTapDetected = true;
        }
    }

    function onCapturePointerUp(e: PointerEvent): void {
        if (e.pointerType !== "touch") return;
        activePointerIds.delete(e.pointerId);

        if (activePointerIds.size === 0) {
            firstPointerDownTime = null;

            if (threeFingerTapDetected) {
                threeFingerTapDetected = false;

                const now = Date.now();
                if (
                    firstTapTime !== null &&
                    now - firstTapTime <= DOUBLE_TAP_WINDOW_MS
                ) {
                    showDebugConsole = !showDebugConsole;
                    firstTapTime = null;
                    if (doubleTapTimer !== null) {
                        clearTimeout(doubleTapTimer);
                        doubleTapTimer = null;
                    }
                } else {
                    firstTapTime = now;
                    if (doubleTapTimer !== null) clearTimeout(doubleTapTimer);
                    doubleTapTimer = setTimeout(() => {
                        firstTapTime = null;
                        doubleTapTimer = null;
                    }, DOUBLE_TAP_WINDOW_MS);
                }
            }
        }
    }

    function resetGestureState(): void {
        activePointerIds.clear();
        firstPointerDownTime = null;
        threeFingerTapDetected = false;
    }

    $effect(() => {
        window.addEventListener("pointerdown", onCapturePointerDown, {
            capture: true,
        });
        window.addEventListener("pointerup", onCapturePointerUp, {
            capture: true,
        });
        window.addEventListener("pointercancel", onCapturePointerUp, {
            capture: true,
        });
        window.addEventListener("pointerdown", onSwipePointerDown, {
            capture: false,
        });
        window.addEventListener("pointermove", onSwipePointerMove, {
            capture: false,
        });
        window.addEventListener("pointerup", onSwipePointerUp, {
            capture: false,
        });
        window.addEventListener("pointercancel", onSwipePointerCancel, {
            capture: false,
        });
        document.addEventListener("visibilitychange", resetGestureState);
        return () => {
            window.removeEventListener("pointerdown", onCapturePointerDown, {
                capture: true,
            });
            window.removeEventListener("pointerup", onCapturePointerUp, {
                capture: true,
            });
            window.removeEventListener("pointercancel", onCapturePointerUp, {
                capture: true,
            });
            window.removeEventListener("pointerdown", onSwipePointerDown, {
                capture: false,
            });
            window.removeEventListener("pointermove", onSwipePointerMove, {
                capture: false,
            });
            window.removeEventListener("pointerup", onSwipePointerUp, {
                capture: false,
            });
            window.removeEventListener("pointercancel", onSwipePointerCancel, {
                capture: false,
            });
            document.removeEventListener("visibilitychange", resetGestureState);
        };
    });

    let role = $derived(stores.deviceRole);
    let pdfPath = $derived(stores.activePdf?.path);
    let isHtmlMode = $derived(stores.activeMode.base === "html");

    // Keyboard shortcuts
    function handleGlobalKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            if (showRoleModal) {
                showRoleModal = false;
                return;
            }
            if (showHtmlBrowser) {
                showHtmlBrowser = false;
                return;
            }
            if (showBrowser && pdfPath) {
                showBrowser = false;
                return;
            }
        }

        // Don't interfere when user is typing in an input / textarea
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;

        const prev =
            e.key === "ArrowLeft" || e.key === "PageUp" || e.key === "h";
        const next =
            e.key === "ArrowRight" || e.key === "PageDown" || e.key === "l";

        if (stores.activeMode.whiteboard) {
            if (prev) prevWbSlide();
            else if (next) nextWbSlide();
        } else if (stores.activeMode.base === "html") {
            if (prev) prevHtmlSlide();
            else if (next) nextHtmlSlide();
        } else {
            if (prev) prevSlide();
            else if (next) nextSlide();
        }
    }

    // Auto-connect on load.
    let autoConnectRan = false;
    $effect(() => {
        if (autoConnectRan) return;
        autoConnectRan = true;
        void connect().then(
            () => {},
            (e: unknown) => {
                console.error("Connect failed:", e);
                stores.logout();
            },
        );
    });

    // Auto-close browser once a PDF is loaded
    $effect(() => {
        if (pdfPath) showBrowser = false;
    });

    // Auto-close HTML browser and PDF browser when HTML mode activates
    $effect(() => {
        if (stores.activeMode.base === "html") {
            showHtmlBrowser = false;
            showBrowser = false;
        }
    });

    function selectRole(selected: DeviceRole) {
        stores.deviceRole = selected;
        sessionStorage.setItem("deviceRole", selected);
        showRoleModal = false;
        if (stores.wsState === "disconnected") {
            void connect().then(
                () => {},
                (e: unknown) => {
                    console.error("Connect failed:", e);
                    stores.logout();
                },
            );
        }
    }

    function changeRole() {
        showRoleModal = true;
    }

    // Derived for the overlay
    let isReconnecting = $derived(
        stores.wsState === "reconnecting" ||
            (stores.wsState === "connecting" && stores.wsReconnectAttempt > 0),
    );
    let reconnectAttempt = $derived(stores.wsReconnectAttempt);
</script>

<svelte:document onkeydown={handleGlobalKeydown} />

<!-- ── Always-visible layer ── -->
<div class="main">
    <div class="viewer-wrap">
        <SlideView />
        {#if role === "presenter" && (pdfPath || isHtmlMode)}
            <Toolbar />
        {/if}
    </div>
</div>

{#if stores.activeMode.base === "html" && !stores.activeMode.whiteboard}
    <button
        class="exit-html-fab"
        onclick={() => send({ type: "set_mode", mode: "pdf" })}
        title="Go back to PDF">← Back to PDF</button
    >
{/if}

{#if role}
    <NavFab
        {role}
        onChangePdf={() => (showBrowser = true)}
        onLoadHtml={() => (showHtmlBrowser = true)}
        onChangeRole={changeRole}
    />
{/if}

<!-- ── Modals ── -->
{#if !role || showRoleModal}
    {@const dismissible = showRoleModal && !!role}
    <Modal
        {dismissible}
        ondismiss={() => {
            showRoleModal = false;
        }}
    >
        <h2>Select Role</h2>
        <div class="role-buttons">
            <button onclick={() => selectRole("viewer")}>Viewer</button>
            <button onclick={() => selectRole("presenter")}>Presenter</button>
        </div>
    </Modal>
{:else if (!pdfPath && !isHtmlMode) || showBrowser}
    {@const dismissible = !!pdfPath || isHtmlMode}
    <Modal
        {dismissible}
        wide
        ondismiss={() => {
            showBrowser = false;
        }}
    >
        <h2>Select a PDF</h2>
        <FileBrowser />
    </Modal>
{/if}

{#if showHtmlBrowser}
    <Modal
        dismissible
        wide
        ondismiss={() => {
            showHtmlBrowser = false;
        }}
    >
        <h2>Select an HTML file</h2>
        <FileBrowser mode="html" />
    </Modal>
{/if}

<!-- Reconnect overlay (unchanged, stays on top) -->
{#if isReconnecting}
    <div class="reconnect-backdrop">
        <div class="reconnect-panel">
            <div class="reconnect-spinner" aria-hidden="true"></div>
            <p class="reconnect-title">Connection lost</p>
            <p class="reconnect-body">Reconnecting…</p>
            {#if reconnectAttempt > 0}
                <p class="reconnect-attempts">
                    Attempt {reconnectAttempt} of {BACKOFF_MS.length}
                </p>
            {/if}
            <button
                class="reconnect-cancel"
                onclick={() => stores.logout()}
            >
                Cancel
            </button>
        </div>
    </div>
{/if}

<!-- ── Swipe chevron overlay ── -->
{#if swipe.direction !== null && role === "presenter" && (pdfPath || isHtmlMode)}
    {@const opacity = swipe.atBoundary
        ? swipe.progress * 0.35
        : swipe.progress * 0.85}
    {@const slide = (1 - swipe.progress) * 100}
    <div
        class="swipe-overlay"
        class:swipe-overlay--left={swipe.direction === "left"}
        class:swipe-overlay--right={swipe.direction === "right"}
        class:swipe-overlay--boundary={swipe.atBoundary}
        style="opacity: {opacity}; --slide: {slide}%;"
        aria-hidden="true"
    >
        <svg
            class="swipe-chevron"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            {#if swipe.direction === "left"}
                <polyline points="9 18 15 12 9 6" />
            {:else}
                <polyline points="15 18 9 12 15 6" />
            {/if}
        </svg>
    </div>
{/if}

{#if showDebugConsole}
    <DebugConsole
        onclose={() => {
            showDebugConsole = false;
        }}
    />
{/if}

<style>
    button {
        font-size: 1rem;
        padding: 0.5rem 2rem;
        cursor: pointer;
    }
    .role-buttons {
        display: flex;
        gap: 1rem;
    }
    .main {
        display: flex;
        flex-direction: column;
        height: 100dvh;
        overflow: hidden;
        touch-action: none;
        background: black;
    }
    .viewer-wrap {
        flex: 1;
        display: flex;
        flex-direction: column;
        position: relative;
        min-height: 0;
    }

    /* ── Reconnect overlay ────────────────────────────────────────────────── */
    .reconnect-backdrop {
        position: fixed;
        inset: 0;
        z-index: 1000;
        background: rgba(0, 0, 0, 0.45);
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: all;
    }

    .reconnect-panel {
        background: #1e1e1e;
        color: #f0f0f0;
        border: 1px solid #444;
        border-radius: 12px;
        padding: 2rem 2.5rem;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.6rem;
        min-width: 240px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
    }

    .reconnect-title {
        font-size: 1.1rem;
        font-weight: 600;
        margin: 0;
    }

    .reconnect-body {
        font-size: 0.95rem;
        color: #aaa;
        margin: 0;
    }

    .reconnect-attempts {
        font-size: 0.85rem;
        color: #777;
        margin: 0;
    }

    .reconnect-cancel {
        margin-top: 0.4rem;
        padding: 0.4rem 1.2rem;
        background: transparent;
        border: 1px solid #555;
        border-radius: 6px;
        color: #aaa;
        font-size: 0.9rem;
        cursor: pointer;
    }

    .reconnect-cancel:hover {
        background: #2a2a2a;
        color: #f0f0f0;
    }

    /* Spinning ring */
    .reconnect-spinner {
        width: 36px;
        height: 36px;
        border: 3px solid #444;
        border-top-color: #f97316;
        border-radius: 50%;
        animation: spin 0.9s linear infinite;
        margin-bottom: 0.4rem;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    /* ── Swipe chevron overlay ────────────────────────────────────────────── */

    .exit-html-fab {
        position: fixed;
        bottom: 14px;
        right: 14px;
        z-index: 50;
        padding: 0.5rem 0.7rem;
        font-size: 0.78rem;
        background: rgba(30, 30, 30, 0.8);
        color: #f0f0f0;
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 20px;
        cursor: pointer;
        backdrop-filter: blur(4px);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
        transition: opacity 0.15s;
    }
    .exit-html-fab:hover {
        opacity: 0.85;
    }

    .swipe-overlay {
        position: fixed;
        top: 50%;
        z-index: 300;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        color: white;
        /* will-change so the opacity+transform animation is GPU-composited */
        will-change: opacity, transform;
    }

    .swipe-overlay--left {
        right: 10%;
        transform: translateY(-50%) translateX(var(--slide, 100%));
    }

    .swipe-overlay--right {
        left: 10%;
        transform: translateY(-50%) translateX(calc(-1 * var(--slide, 100%)));
    }

    .swipe-overlay--boundary {
        color: #ef4444;
    }

    .swipe-chevron {
        width: 120px;
        height: 120px;
        filter: drop-shadow(0 2px 12px rgba(0, 0, 0, 0.6));
    }
</style>
