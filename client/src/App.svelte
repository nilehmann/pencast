<script lang="ts">
    import {
        authToken,
        deviceRole,
        activePdfPath,
        activePdfName,
        wsState,
        wsReconnectAttempt,
        logout,
        activeMode,
    } from "./stores";
    import { connect, send, BACKOFF_MS } from "./ws-client";
    import { SwipeGesture } from "./gestures.svelte";
    import {
        prevSlide,
        nextSlide,
        prevWbSlide,
        nextWbSlide,
    } from "./navigation";
    import FileBrowser from "./FileBrowser.svelte";
    import Modal from "./Modal.svelte";
    import SlideView from "./SlideView.svelte";
    import Toolbar from "./Toolbar.svelte";
    import DebugConsole from "./DebugConsole.svelte";
    import type { DeviceRole } from "../../shared/types";

    let pin = $state("");
    let error = $state("");
    let showBrowser = $state(false);
    let showHtmlBrowser = $state(false);
    let showRoleModal = $state(false);
    let showDebugConsole = $state(false);

    // ── Finger swipe gesture (slide navigation) ───────────────────────────────
    const swipe = new SwipeGesture();

    function isSwipeBlocked(): boolean {
        return (
            !token ||
            !role ||
            role !== "presenter" ||
            (!pdfPath && !$activeMode.whiteboard) ||
            ($activeMode.base === "html" && !$activeMode.whiteboard) ||
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
        if ($activeMode.whiteboard) {
            if (triggered === "right") prevWbSlide();
            else if (triggered === "left") nextWbSlide();
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

    let token = $derived($authToken);
    let role = $derived($deviceRole);
    let pdfPath = $derived($activePdfPath);
    let pdfName = $derived($activePdfName);
    let isHtmlMode = $derived($activeMode.base === "html");

    // ── Top-bar visibility ────────────────────────────────────────────────────
    let topBarVisible = $state(false);

    // Cooldown flag: blocks reveal triggers briefly after the bar is hidden,
    // preventing the same gesture that closed it from immediately re-opening it.
    let revealBlocked = false;
    let revealBlockTimer: ReturnType<typeof setTimeout> | null = null;
    const REVEAL_COOLDOWN_MS = 600;

    function blockReveal() {
        revealBlocked = true;
        if (revealBlockTimer !== null) clearTimeout(revealBlockTimer);
        revealBlockTimer = setTimeout(() => {
            revealBlocked = false;
            revealBlockTimer = null;
        }, REVEAL_COOLDOWN_MS);
    }

    function showTopBar() {
        if (revealBlocked) return;
        topBarVisible = true;
    }

    function hideTopBar() {
        topBarVisible = false;
        blockReveal();
    }

    function toggleTopBar() {
        if (topBarVisible) {
            hideTopBar();
        } else {
            showTopBar();
        }
    }

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

        if (e.key === "t" || e.key === "T") toggleTopBar();

        const prev =
            e.key === "ArrowLeft" || e.key === "PageUp" || e.key === "h";
        const next =
            e.key === "ArrowRight" || e.key === "PageDown" || e.key === "l";

        if ($activeMode.whiteboard) {
            if (prev) prevWbSlide();
            else if (next) nextWbSlide();
        } else {
            if (prev) prevSlide();
            else if (next) nextSlide();
        }
    }

    // ── Mouse hover hotzone ───────────────────────────────────────────────────
    let hotzoneTimer: ReturnType<typeof setTimeout> | null = null;

    function onHotzoneEnter() {
        if (
            !token ||
            !role ||
            (!pdfPath && $activeMode.base !== "html") ||
            showRoleModal ||
            showBrowser ||
            showHtmlBrowser
        )
            return;
        if (topBarVisible) return;
        hotzoneTimer = setTimeout(() => {
            showTopBar();
        }, 500);
    }

    function onHotzoneLeave() {
        if (hotzoneTimer !== null) {
            clearTimeout(hotzoneTimer);
            hotzoneTimer = null;
        }
    }

    // ── Touch / mouse swipe-down from top zone ────────────────────────────────
    const SWIPE_ZONE_PX = 25; // touch must start within this many px from top
    const SWIPE_MIN_PX = 50; // must travel at least this far downward

    let swipeStartY = $state<number | null>(null);
    let swipeActive = $state(false);

    function onPointerDown(e: PointerEvent) {
        if (
            !token ||
            !role ||
            (!pdfPath && $activeMode.base !== "html") ||
            showRoleModal ||
            showBrowser ||
            showHtmlBrowser
        )
            return;
        if (topBarVisible) return;
        if (e.clientY <= SWIPE_ZONE_PX) {
            swipeStartY = e.clientY;
            swipeActive = true;
        }
    }

    function onPointerMove(e: PointerEvent) {
        if (!swipeActive || swipeStartY === null) return;
        const dy = e.clientY - swipeStartY;
        if (dy >= SWIPE_MIN_PX) {
            showTopBar();
            swipeActive = false;
            swipeStartY = null;
        }
    }

    function onPointerUp() {
        swipeActive = false;
        swipeStartY = null;
    }

    // ── Double-tap on top bar to dismiss ─────────────────────────────────────
    // Driven by pointerdown (not click) so it works on touch devices where
    // preventDefault() in the annotation canvas suppresses synthetic click events.
    const DOUBLE_TAP_MS = 400;
    let tapCount = 0;
    let tapTimer: ReturnType<typeof setTimeout> | null = null;
    let topBarEl = $state<HTMLDivElement | null>(null);

    function onTopBarPointerDown(e: PointerEvent) {
        if (!e.isPrimary) return;
        if (!topBarVisible) return;
        // Ignore taps on interactive children (buttons, links, etc.)
        if ((e.target as HTMLElement).closest("button, a, input, select"))
            return;
        // Confirm the tap landed inside the bar's bounding rect
        if (!topBarEl) return;
        const rect = topBarEl.getBoundingClientRect();
        if (
            e.clientX < rect.left ||
            e.clientX > rect.right ||
            e.clientY < rect.top ||
            e.clientY > rect.bottom
        )
            return;

        tapCount += 1;
        if (tapCount === 2) {
            hideTopBar();
            tapCount = 0;
            if (tapTimer !== null) {
                clearTimeout(tapTimer);
                tapTimer = null;
            }
            return;
        }
        // Reset counter if second tap doesn't arrive in time
        if (tapTimer !== null) clearTimeout(tapTimer);
        tapTimer = setTimeout(() => {
            tapCount = 0;
            tapTimer = null;
        }, DOUBLE_TAP_MS);
    }

    // One-shot auto-connect: if sessionStorage already has both a token and a
    // role, reconnect immediately without showing the role-selection screen.
    const savedToken = sessionStorage.getItem("authToken");
    const savedRole = sessionStorage.getItem("deviceRole") as DeviceRole | null;

    // Run inside $effect so the async/await is in a context the Svelte ESLint
    // plugin understands. The `ran` guard ensures it fires exactly once.
    let autoConnectRan = false;
    function runAutoConnect(t: string): void {
        void connect(t).then(
            () => {},
            (e: unknown) => {
                console.error("Auto-reconnect failed:", e);
                logout(true);
            },
        );
    }

    $effect(() => {
        if (autoConnectRan || !savedToken || !savedRole) return;
        autoConnectRan = true;
        runAutoConnect(savedToken);
    });

    // Auto-close browser once a PDF is loaded
    $effect(() => {
        if (pdfPath) showBrowser = false;
    });

    // Auto-close HTML browser and PDF browser when HTML mode activates
    $effect(() => {
        if ($activeMode.base === "html") {
            showHtmlBrowser = false;
            showBrowser = false;
        }
    });

    async function submitPin() {
        error = "";
        try {
            const res = await fetch("/api/auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pin }),
            });
            if (res.ok) {
                const data = (await res.json()) as { token: string };
                await connect(data.token);
                authToken.set(data.token);
                sessionStorage.setItem("authToken", data.token);
            } else {
                error = `${res.status} ${res.statusText}`;
                pin = "";
            }
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        }
    }

    function selectRole(selected: DeviceRole) {
        deviceRole.set(selected);
        sessionStorage.setItem("deviceRole", selected);
        showRoleModal = false;
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Enter") void submitPin();
    }

    function changeRole() {
        showRoleModal = true;
    }

    // Derived for the overlay
    let isReconnecting = $derived(
        $wsState === "reconnecting" ||
            ($wsState === "connecting" && $wsReconnectAttempt > 0),
    );
    let reconnectAttempt = $derived($wsReconnectAttempt);
</script>

<svelte:document
    onkeydown={handleGlobalKeydown}
    onpointerdown={(e) => {
        onPointerDown(e);
        onTopBarPointerDown(e);
    }}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
/>

<!-- ── Always-visible layer ── -->
<div class="main">
    {#if role && (pdfPath || isHtmlMode) && !topBarVisible}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="hotzone"
            onpointerenter={onHotzoneEnter}
            onpointerleave={onHotzoneLeave}
        ></div>
    {/if}

    <!-- Top bar: always in DOM, slid out of view when hidden -->
    <div
        bind:this={topBarEl}
        class="top-bar"
        class:top-bar--visible={role &&
            (pdfPath || isHtmlMode) &&
            topBarVisible}
    >
        <span>{pdfName}</span>
        <div class="top-bar-actions">
            <button
                onclick={() => {
                    showBrowser = true;
                }}>Change PDF</button
            >
            <button
                onclick={() => {
                    showHtmlBrowser = true;
                }}>Load HTML</button
            >
            <button onclick={changeRole}>Change Role</button>
        </div>
    </div>

    <div class="viewer-wrap">
        <SlideView
            onChangePdf={() => {
                showBrowser = true;
            }}
            onLoadHtml={() => {
                showHtmlBrowser = true;
            }}
            onChangeRole={changeRole}
        />
        {#if role === "presenter" && (pdfPath || isHtmlMode)}
            <Toolbar />
        {/if}
    </div>
</div>

{#if $activeMode.base === "html" && !$activeMode.whiteboard}
    <button
        class="exit-html-fab"
        onclick={() => send({ type: "set_mode", mode: "pdf" })}
        title="Go back to PDF">← Back to PDF</button
    >
{/if}

<!-- ── Modals ── -->
{#if !token}
    <div class="login-screen">
        <h1>Pencast</h1>
        <input
            type="password"
            placeholder="Enter PIN"
            bind:value={pin}
            onkeydown={handleKeydown}
        />
        <button onclick={submitPin}>Unlock</button>
        {#if error}<p class="error">{error}</p>{/if}
    </div>
{:else if !role || showRoleModal}
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
            <button class="reconnect-cancel" onclick={() => logout(true)}>
                Cancel
            </button>
        </div>
    </div>
{/if}

<!-- ── Swipe chevron overlay ── -->
{#if swipe.direction !== null && role === "presenter" && pdfPath && !isHtmlMode}
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
    input {
        font-size: 1.5rem;
        padding: 0.5rem 1rem;
        text-align: center;
        width: 12rem;
    }
    button {
        font-size: 1rem;
        padding: 0.5rem 2rem;
        cursor: pointer;
    }
    .role-buttons {
        display: flex;
        gap: 1rem;
    }
    .error {
        color: red;
    }
    .login-screen {
        position: fixed;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1rem;
        background: #121212;
        color: #f0f0f0;
    }
    .login-screen h1 {
        margin: 0;
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

    /* ── Hotzone ──────────────────────────────────────────────────────────── */
    .hotzone {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        height: 30px;
        z-index: 200;
        background: transparent;
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

    /* ── Top bar ──────────────────────────────────────────────────────────── */
    .top-bar {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        z-index: 100;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.5rem 1rem;
        background: #f0f0f0;
        border-bottom: 1px solid #ccc;

        /* Start slid fully off the top */
        transform: translateY(-100%);
        transition: transform 250ms ease-out;
    }

    .top-bar--visible {
        transform: translateY(0);
    }

    .top-bar-actions {
        display: flex;
        gap: 0.5rem;
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
