<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { send, onMessage, offMessage } from "./ws-client";
    import AnnotationCanvas from "./AnnotationCanvas.svelte";
    import { stores } from "./stores.svelte";

    let container = $state<HTMLDivElement>(undefined!);
    let videoEl = $state<HTMLVideoElement>(undefined!);

    const aspectRatio = $derived.by(() => {
        const w = stores.activeScreen?.captureWidth;
        const h = stores.activeScreen?.captureHeight;
        return w && h ? `${w} / ${h}` : "16 / 9";
    });

    let pc: RTCPeerConnection | null = null;

    // Queue messages that arrive before onMount creates the PC
    let pendingOffer: string | null = null;
    let pendingIce: RTCIceCandidateInit[] = [];

    // Register handlers at component init — not inside onMount —
    // to eliminate the race between WS message arrival and onMount running.
    onMessage("webrtc_offer_relay", async (msg) => {
        if (!pc) { pendingOffer = msg.sdp; return; }
        await handleOffer(msg.sdp);
    });

    onMessage("webrtc_ice_relay", (msg) => {
        if (!pc) { pendingIce.push(msg.candidate); return; }
        pc.addIceCandidate(msg.candidate);
    });

    async function handleOffer(sdp: string) {
        if (!pc) return;
        await pc.setRemoteDescription({ type: "offer", sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        send({ type: "webrtc_answer", sdp: answer.sdp! });
    }

    onMount(() => {
        pc = new RTCPeerConnection({ iceServers: [] });

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                send({ type: "webrtc_ice", candidate: e.candidate.toJSON() });
            }
        };

        pc.ontrack = (e) => {
            videoEl.srcObject = e.streams[0];
        };

        // Drain any messages that arrived before the PC was ready
        if (pendingOffer) { handleOffer(pendingOffer); pendingOffer = null; }
        for (const c of pendingIce) pc.addIceCandidate(c);
        pendingIce = [];
    });

    onDestroy(() => {
        offMessage("webrtc_offer_relay");
        offMessage("webrtc_ice_relay");
        pc?.close();
        pc = null;
    });

</script>

<div class="screen-container" bind:this={container} style="aspect-ratio: {aspectRatio};">
    <video
        bind:this={videoEl}
        autoplay
        playsinline
        style="width: 100%;"
    ></video>
    <div class="canvas-overlay">
        <AnnotationCanvas sourceCanvas={container} />
    </div>
</div>

<style>
    .screen-container {
        position: relative;
        max-width: 100%;
        max-height: 100%;
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
        pointer-events: none;
    }
</style>
