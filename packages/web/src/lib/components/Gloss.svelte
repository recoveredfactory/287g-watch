<script lang="ts">
  import { onMount } from "svelte";
  import { processGloss } from "$lib/glossary/process";
  import { TERMS_MAP, termSlug } from "$lib/glossary/terms";

  export let text: string;
  // Optional shared "already glossed" tracker. Pass a single Set to multiple
  // Gloss instances on the same page to gloss only the first mention of each
  // term page-wide rather than per-block. Omit for per-block first-mention
  // (the default).
  export let seen: Set<string> | undefined = undefined;

  let container: HTMLElement;
  let popover = { visible: false, term: "", def: "", slug: "", key: "", x: 0, y: 0 };
  let hideTimer: ReturnType<typeof setTimeout>;

  $: processed = processGloss(text, seen);

  function getEntry(el: HTMLElement) {
    const key = decodeURIComponent(el.dataset.term ?? "").toLowerCase();
    return TERMS_MAP.get(key) ?? null;
  }

  function termKey(el: HTMLElement) {
    return decodeURIComponent(el.dataset.term ?? "").toLowerCase();
  }

  function openFor(el: HTMLElement) {
    clearTimeout(hideTimer);
    const entry = getEntry(el);
    if (!entry) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(8, Math.min(rect.left, window.innerWidth - 300));
    const y = rect.bottom + 8;
    popover = { visible: true, term: entry.term, def: entry.definition, slug: termSlug(entry.term), key: termKey(el), x, y };
  }

  function scheduleHide() {
    hideTimer = setTimeout(() => { popover = { ...popover, visible: false }; }, 150);
  }

  function cancelHide() {
    clearTimeout(hideTimer);
  }

  function close() {
    clearTimeout(hideTimer);
    popover = { ...popover, visible: false };
  }

  onMount(() => {
    const over = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>(".gloss-term");
      if (el) openFor(el);
    };
    const out = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest(".gloss-term")) scheduleHide();
    };
    const focusin = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (el.classList.contains("gloss-term")) openFor(el);
    };
    const focusout = (e: FocusEvent) => {
      if ((e.target as HTMLElement).classList.contains("gloss-term")) scheduleHide();
    };
    // Tap shows popover; tap the same term again to follow the link.
    const click = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>(".gloss-term");
      if (!el) return;
      const thisTermOpen = popover.visible && popover.key === termKey(el);
      if (!thisTermOpen) {
        e.preventDefault();
        openFor(el);
      }
      // Second tap on the same open term: let the link navigate naturally.
    };
    const outsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".gloss-term") && !target.closest(".gloss-popover")) close();
    };

    container.addEventListener("mouseover", over);
    container.addEventListener("mouseout", out);
    container.addEventListener("focusin", focusin);
    container.addEventListener("focusout", focusout);
    container.addEventListener("click", click);
    document.addEventListener("click", outsideClick);

    return () => {
      container.removeEventListener("mouseover", over);
      container.removeEventListener("mouseout", out);
      container.removeEventListener("focusin", focusin);
      container.removeEventListener("focusout", focusout);
      container.removeEventListener("click", click);
      document.removeEventListener("click", outsideClick);
      clearTimeout(hideTimer);
    };
  });
</script>

<span bind:this={container}>{@html processed}</span>

{#if popover.visible}
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="gloss-popover"
    style="left:{popover.x}px;top:{popover.y}px;"
    role="tooltip"
    on:mouseenter={cancelHide}
    on:mouseleave={scheduleHide}
  >
    <p class="gloss-popover-term">{popover.term}</p>
    <p class="gloss-popover-def">{popover.def}</p>
    <a href="/glossary#term-{popover.slug}" on:click={close} class="gloss-popover-link">
      Full entry →
    </a>
  </div>
{/if}

<style>
  :global(.gloss-term) {
    font-weight: 600;
    cursor: help;
    color: inherit;
    text-decoration: underline;
    text-decoration-style: dotted;
    text-decoration-color: currentColor;
    text-underline-offset: 3px;
  }

  :global(.gloss-term:focus-visible) {
    outline: 2px solid #BE6079;
    outline-offset: 2px;
    border-radius: 2px;
  }

  .gloss-popover {
    position: fixed;
    z-index: 200;
    width: 280px;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 12px 14px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
    pointer-events: auto;
  }

  .gloss-popover-term {
    font-size: 13px;
    font-weight: 700;
    color: #0a0a0a;
    margin: 0 0 5px;
  }

  .gloss-popover-def {
    font-size: 12px;
    line-height: 1.55;
    color: #475569;
    margin: 0 0 8px;
  }

  .gloss-popover-link {
    font-size: 11px;
    font-weight: 600;
    color: #BE6079;
    text-decoration: none;
  }

  .gloss-popover-link:hover {
    text-decoration: underline;
  }
</style>
