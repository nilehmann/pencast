<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { send, onMessage, offMessage } from "./ws-client";
    import AnnotationCanvas from "./AnnotationCanvas.svelte";

    let { cropTop }: { cropTop: number } = $props();

    let container = $state<HTMLDivElement>(undefined!);
    let videoEl = $state<HTMLVideoElement>(undefined!);

    // Intrinsic video dimensions, set on loadedmetadata
    let videoWidth = $state(0);
    let videoHeight = $state(0);

    // Effective height after crop (in video pixels)
    const effectiveHeight = $derived(Math.max(1, videoHeight - cropTop));

    // Aspect ratio of the cropped video
    const aspectRatio = $derived(
        videoWidth > 0 ? `${videoWidth} / ${effectiveHeight}` : "16 / 9",
    );

    // cropTop as a fraction of intrinsic video height (for CSS margin-top)
    const cropPercent = $derived(
        videoHeight > 0 ? (cropTop / videoHeight) * 100 : 0,
    );

    let pc: RTCPeerConnection | null = null;

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

        onMessage("webrtc_offer_relay", async (msg) => {
            if (!pc) return;
            await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            send({ type: "webrtc_answer", sdp: answer.sdp! });
        });

        onMessage("webrtc_ice_relay", (msg) => {
            pc?.addIceCandidate(msg.candidate);
        });
    });

    onDestroy(() => {
        offMessage("webrtc_offer_relay");
        offMessage("webrtc_ice_relay");
        pc?.close();
        pc = null;
    });

    function onLoadedMetadata() {
        videoWidth = videoEl.videoWidth;
        videoHeight = videoEl.videoHeight;
    }
</script>

<div class="screen-container" bind:this={container} style="aspect-ratio: {aspectRatio};">
    <video
        bind:this={videoEl}
        autoplay
        playsinline
        onloadedmetadata={onLoadedMetadata}
        style="margin-top: -{cropPercent}%; width: 100%;"
    ></video>
    <AnnotationCanvas sourceCanvas={container} />
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
</style>
