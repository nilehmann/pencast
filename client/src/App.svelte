<script lang="ts">
    import {
        authToken,
        deviceRole,
        activePdfPath,
        activePdfName,
    } from "./stores";
    import { connect, disconnect } from "./ws-client";
    import FileBrowser from "./FileBrowser.svelte";
    import PdfViewer from "./PdfViewer.svelte";
    import Toolbar from "./Toolbar.svelte";
    import type { DeviceRole } from "../../shared/types";

    let pin = $state("");
    let error = $state("");
    let connecting = $state(false);
    let showBrowser = $state(false);

    let token = $derived($authToken);
    let role = $derived($deviceRole);
    let pdfPath = $derived($activePdfPath);
    let pdfName = $derived($activePdfName);

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

    // Keyboard shortcut: H
    function handleGlobalKeydown(e: KeyboardEvent) {
        // Don't interfere when user is typing in an input / textarea
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        if (e.key === "t" || e.key === "T") toggleTopBar();
    }

    // ── Mouse hover hotzone ───────────────────────────────────────────────────
    let hotzoneTimer: ReturnType<typeof setTimeout> | null = null;

    function onHotzoneEnter() {
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
    let swipeStartX = $state<number | null>(null);
    let swipeActive = $state(false);

    function onPointerDown(e: PointerEvent) {
        if (topBarVisible) return;
        if (e.clientY <= SWIPE_ZONE_PX) {
            swipeStartY = e.clientY;
            swipeStartX = e.clientX;
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
            swipeStartX = null;
        }
    }

    function onPointerUp() {
        swipeActive = false;
        swipeStartY = null;
        swipeStartX = null;
    }

    // ── Double-tap on top bar to dismiss ─────────────────────────────────────
    // Driven by pointerdown (not click) so it works on touch devices where
    // preventDefault() in the annotation canvas suppresses synthetic click events.
    const DOUBLE_TAP_MS = 400;
    let tapCount = 0;
    let tapTimer: ReturnType<typeof setTimeout> | null = null;
    let topBarEl = $state<HTMLDivElement | null>(null);

    function onTopBarPointerDown(e: PointerEvent) {
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
    if (savedToken && savedRole) {
        connecting = true;
        connect(savedToken, savedRole)
            .catch((e) => {
                console.error("Auto-reconnect failed:", e);
                // Clear stale role so the user is prompted to pick again
                deviceRole.set(null);
                sessionStorage.removeItem("deviceRole");
            })
            .finally(() => {
                connecting = false;
            });
    }

    // Auto-close browser once a PDF is loaded
    $effect(() => {
        if (pdfPath) showBrowser = false;
    });

    async function submitPin() {
        error = "";
        const res = await fetch("/api/auth", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pin }),
        });
        if (res.ok) {
            const data = (await res.json()) as { token: string };
            authToken.set(data.token);
            sessionStorage.setItem("authToken", data.token);
        } else {
            error = "Invalid PIN";
            pin = "";
        }
    }

    async function selectRole(selected: "presenter" | "annotator") {
        connecting = true;
        error = "";
        try {
            await connect(token, selected);
            deviceRole.set(selected);
            sessionStorage.setItem("deviceRole", selected);
        } catch (e) {
            error = "Failed to connect";
            console.error(e);
        } finally {
            connecting = false;
        }
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Enter") submitPin();
    }

    function changeRole() {
        disconnect();
        deviceRole.set(null);
        sessionStorage.removeItem("deviceRole");
    }
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

{#if !token}
    <div class="center">
        <h1>Presenter</h1>
        <input
            type="password"
            placeholder="Enter PIN"
            bind:value={pin}
            onkeydown={handleKeydown}
        />
        <button onclick={submitPin}>Unlock</button>
        {#if error}<p class="error">{error}</p>{/if}
    </div>
{:else if !role}
    <div class="center">
        <h1>Select Role</h1>
        {#if connecting}
            <p>Connecting…</p>
        {:else}
            <div class="role-buttons">
                <button onclick={() => selectRole("presenter")}
                    >Presenter</button
                >
                <button onclick={() => selectRole("annotator")}
                    >Annotator</button
                >
            </div>
            {#if error}<p class="error">{error}</p>{/if}
        {/if}
    </div>
{:else if !pdfPath || showBrowser}
    <div class="browser-wrap">
        <div class="browser-header">
            <h2>Select a PDF</h2>
            {#if pdfPath}
                <button
                    onclick={() => {
                        showBrowser = false;
                    }}>✕ Cancel</button
                >
            {/if}
        </div>
        <FileBrowser />
    </div>
{:else}
    <div class="main">
        <!-- Invisible hotzone for mouse users (hidden when bar is open) -->
        {#if !topBarVisible}
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
            class:top-bar--visible={topBarVisible}
        >
            <span>{pdfName}</span>
            <div class="top-bar-actions">
                <button
                    onclick={() => {
                        showBrowser = true;
                    }}>Change PDF</button
                >
                <button onclick={changeRole}>Change Role</button>
            </div>
        </div>

        <div class="viewer-wrap">
            <PdfViewer />
            {#if role === "annotator"}
                <Toolbar />
            {/if}
        </div>
    </div>
{/if}

<style>
    .center {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100vh;
        gap: 1rem;
    }
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
    .browser-wrap {
        max-width: 700px;
        margin: 0 auto;
        padding: 1rem;
    }
    .browser-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }
    .main {
        display: flex;
        flex-direction: column;
        height: 100vh;
        overflow: hidden;
        position: relative;
        touch-action: none;
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
        /* Truly invisible — no background, no pointer-events cost */
        background: transparent;
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
</style>
