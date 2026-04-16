<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { send, onMessage, offMessage } from "./ws-client";
    import AnnotationCanvas from "./AnnotationCanvas.svelte";
    import { stores } from "./stores.svelte";

    const whiteBackground = $derived(stores.activeMode.whiteBackground ?? false);

    let container = $state<HTMLDivElement>(undefined!);
    let videoEl = $state<HTMLVideoElement>(undefined!);

    let wrapperW = $state(0);
    let wrapperH = $state(0);

    const captureW = $derived(stores.activeScreen?.captureWidth ?? 0);
    const captureH = $derived(stores.activeScreen?.captureHeight ?? 0);

    const displaySize = $derived.by(() => {
        if (!captureW || !captureH || !wrapperW || !wrapperH) return null;
        const scale = Math.min(wrapperW / captureW, wrapperH / captureH);
        return { width: captureW * scale, height: captureH * scale };
    });

    let pc: RTCPeerConnection | null = null;

    // Queue messages that arrive before onMount creates the PC
    let pendingOffer: string | null = null;
    let pendingIce: RTCIceCandidateInit[] = [];

    // Register handlers at component init — not inside onMount —
    // to eliminate the race between WS message arrival and onMount running.
    onMessage("webrtc_offer_relay", async (msg) => {
        console.info("ScreenPresenter: webrtc_offer_relay received", { hasPc: !!pc });
        if (!pc) { pendingOffer = msg.sdp; return; }
        await handleOffer(msg.sdp);
    });

    onMessage("webrtc_ice_relay", (msg) => {
        if (!pc) { pendingIce.push(msg.candidate); return; }
        pc.addIceCandidate(msg.candidate);
    });

    onMessage("webrtc_restart", () => {
        console.info("ScreenPresenter: webrtc_restart received — rebuilding pc");
        rebuildPc();
    });

    async function handleOffer(sdp: string) {
        if (!pc) return;
        await pc.setRemoteDescription({ type: "offer", sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.info("ScreenPresenter: sending webrtc_answer");
        send({ type: "webrtc_answer", sdp: answer.sdp! });
    }

    function rebuildPc() {
        pc?.close();
        pc = new RTCPeerConnection({ iceServers: [] });

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                send({ type: "webrtc_ice", candidate: e.candidate.toJSON() });
            }
        };

        pc.ontrack = (e) => {
            videoEl.srcObject = e.streams[0];
        };

        pc.oniceconnectionstatechange = () => {
            console.info("ScreenPresenter: iceConnectionState =", pc?.iceConnectionState);
        };

        // Drain any messages that arrived before the PC was ready
        if (pendingOffer) { handleOffer(pendingOffer); pendingOffer = null; }
        for (const c of pendingIce) pc.addIceCandidate(c);
        pendingIce = [];
    }

    onMount(() => {
        console.info("ScreenPresenter: onMount");
        rebuildPc();
    });

    onDestroy(() => {
        offMessage("webrtc_offer_relay");
        offMessage("webrtc_ice_relay");
        offMessage("webrtc_restart");
        pc?.close();
        pc = null;
    });

</script>

<div class="screen-wrapper" bind:clientWidth={wrapperW} bind:clientHeight={wrapperH}>
    {#if displaySize}
        <div class="screen-container" bind:this={container}
             style="width: {displaySize.width}px; height: {displaySize.height}px;">
            <video bind:this={videoEl} autoplay playsinline style="width: 100%; display: {whiteBackground ? 'none' : 'block'};"></video>
            {#if whiteBackground}
                <div class="white-bg"></div>
            {/if}
            <div class="canvas-overlay">
                <AnnotationCanvas sourceCanvas={container} />
            </div>
        </div>
    {/if}
</div>

<style>
    .screen-wrapper {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .screen-container {
        position: relative;
        overflow: hidden;
        flex-shrink: 0;
    }

    video {
        display: block;
        width: 100%;
    }

    .canvas-overlay {
        position: absolute;
        inset: 0;
    }

    .white-bg {
        position: absolute;
        inset: 0;
        background: white;
    }
</style>
