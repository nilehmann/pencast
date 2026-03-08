<script lang="ts">
    import { htmlMode, htmlPath, authToken } from "./stores";
    import { send } from "./ws-client";
    import AnnotationCanvas from "./AnnotationCanvas.svelte";

    let container = $state<HTMLDivElement>(undefined!);
    let iframeEl = $state<HTMLIFrameElement | undefined>(undefined);

    function serializeAndSend() {
        const doc = iframeEl?.contentDocument;
        if (!doc?.documentElement) return;

        const viewerWidth = iframeEl!.clientWidth;
        const viewerHeight = iframeEl!.clientHeight;
        if (viewerWidth <= 0 || viewerHeight <= 0) return;
        let html = doc.documentElement.outerHTML;
        // Inject a <base> tag so absolute-path resources resolve on the presenter.
        const baseTag = `<base href="${location.origin}">`;
        html = html.replace(/(<head[^>]*>)/i, `$1${baseTag}`);
        const scrollX = iframeEl!.contentWindow?.scrollX ?? 0;
        const scrollY = iframeEl!.contentWindow?.scrollY ?? 0;
        send({ type: "html_dom", html, viewerWidth, viewerHeight, scrollX, scrollY });
    }

    $effect(() => {
        if (!$htmlMode || !iframeEl) return;

        const iframe = iframeEl;

        function onLoad() {
            serializeAndSend();

            const docEl = iframe.contentDocument?.documentElement;
            if (!docEl) return;

            let debounce: ReturnType<typeof setTimeout> | null = null;
            const observer = new MutationObserver(() => {
                if (debounce !== null) clearTimeout(debounce);
                debounce = setTimeout(() => {
                    debounce = null;
                    serializeAndSend();
                }, 300);
            });
            observer.observe(docEl, {
                subtree: true,
                childList: true,
                attributes: true,
                characterData: true,
            });

            let scrollDebounce: ReturnType<typeof setTimeout> | null = null;
            const onScroll = () => {
                if (scrollDebounce !== null) clearTimeout(scrollDebounce);
                scrollDebounce = setTimeout(() => { scrollDebounce = null; serializeAndSend(); }, 100);
            };
            iframe.contentWindow!.addEventListener("scroll", onScroll);

            return () => {
                observer.disconnect();
                if (debounce !== null) clearTimeout(debounce);
                iframe.contentWindow?.removeEventListener("scroll", onScroll);
                if (scrollDebounce !== null) clearTimeout(scrollDebounce);
            };
        }

        iframe.addEventListener("load", onLoad);
        return () => iframe.removeEventListener("load", onLoad);
    });

    $effect(() => {
        if (!container) return;
        let debounce: ReturnType<typeof setTimeout> | null = null;
        const observer = new ResizeObserver(() => {
            if (debounce !== null) clearTimeout(debounce);
            debounce = setTimeout(() => {
                debounce = null;
                serializeAndSend();
            }, 150);
        });
        observer.observe(container);
        return () => {
            observer.disconnect();
            if (debounce !== null) clearTimeout(debounce);
        };
    });
</script>

<div class="html-container" bind:this={container}>
    {#if $htmlPath}
        <iframe
            bind:this={iframeEl}
            src={`/api/html?path=${encodeURIComponent($htmlPath)}&token=${encodeURIComponent($authToken)}`}
            class="html-iframe"
            sandbox="allow-scripts allow-forms allow-same-origin"
            title="HTML content"
        ></iframe>
    {/if}
    <AnnotationCanvas sourceCanvas={iframeEl ?? container} readonly={true} />
</div>

<style>
    .html-container {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #1a1a1a;
        overflow: hidden;
        position: relative;
        min-height: 0;
    }

    .html-iframe {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        border: none;
    }
</style>
