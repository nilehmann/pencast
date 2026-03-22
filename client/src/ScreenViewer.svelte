<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { send, onMessage, offMessage } from "./ws-client";

    let videoEl = $state<HTMLVideoElement>(undefined!);
    let status = $state("Requesting screen capture…");
    let pc: RTCPeerConnection | null = null;
    let stream: MediaStream | null = null;

    onMount(async () => {
        try {
            stream = await navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: { ideal: 30 }, width: { ideal: 1920 } },
                audio: false,
            });
        } catch {
            status = "Screen capture cancelled or denied.";
            return;
        }

        videoEl.srcObject = stream;
        status = "Screen sharing active";

        pc = new RTCPeerConnection({ iceServers: [] });

        for (const track of stream.getTracks()) {
            pc.addTrack(track, stream);
        }

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                send({ type: "webrtc_ice", candidate: e.candidate.toJSON() });
            }
        };

        onMessage("webrtc_answer_relay", (msg) => {
            pc?.setRemoteDescription({ type: "answer", sdp: msg.sdp });
        });

        onMessage("webrtc_ice_relay", (msg) => {
            pc?.addIceCandidate(msg.candidate);
        });

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        send({ type: "webrtc_offer", sdp: offer.sdp! });
    });

    onDestroy(() => {
        offMessage("webrtc_answer_relay");
        offMessage("webrtc_ice_relay");
        pc?.close();
        pc = null;
        for (const track of stream?.getTracks() ?? []) {
            track.stop();
        }
        stream = null;
    });
</script>

<div class="screen-source">
    <video bind:this={videoEl} muted autoplay playsinline></video>
    <p>{status}</p>
</div>

<style>
    .screen-source {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        gap: 1rem;
        color: white;
    }

    video {
        max-width: 100%;
        max-height: 80%;
        border-radius: 8px;
    }
</style>
