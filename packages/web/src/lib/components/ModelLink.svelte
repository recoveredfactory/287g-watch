<script lang="ts">
  // ── Model name → tooltip + link (#166) ─────────────────────────────────────
  // The tooltip-and-click paradigm we use for glossary terms (Gloss.svelte), but
  // pointed at a model's own page rather than the glossary. Gloss only operates
  // on running text; this wraps a single, known model name (a legend swatch, a
  // table badge, a chart label) so it hovers a definition and clicks through to
  // /model/{slug}. Definition text is the model's glossary entry, so the copy
  // stays in one place.
  import { onDestroy } from "svelte";
  import { MODEL_COLORS, MODEL_SLUG, MODEL_SHORT } from "$lib/colors";
  import { TERMS_MAP } from "$lib/glossary/terms";
  import { localizeHref } from "$lib/paraglide/runtime";

  export let model: string;
  // Dotted-underline affordance — on for inline text (legends), off when the
  // host already signals interactivity (the coloured table badge).
  export let underline = true;
  let cls = "";
  export { cls as class };

  $: slug = MODEL_SLUG[model];
  $: href = localizeHref(`/model/${slug}`);
  $: def = TERMS_MAP.get(model.toLowerCase())?.definition ?? "";

  let anchor: HTMLAnchorElement;
  let pop = { visible: false, x: 0, y: 0 };
  let hideTimer: ReturnType<typeof setTimeout>;

  const onOutside = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t !== anchor && !t.closest?.(".model-pop")) hide();
  };
  function open() {
    clearTimeout(hideTimer);
    if (!anchor || !def) return;
    const r = anchor.getBoundingClientRect();
    pop = { visible: true, x: Math.max(8, Math.min(r.left, window.innerWidth - 296)), y: r.bottom + 8 };
    document.addEventListener("click", onOutside);
  }
  function hide() {
    clearTimeout(hideTimer);
    pop = { ...pop, visible: false };
    document.removeEventListener("click", onOutside);
  }
  function scheduleHide() {
    hideTimer = setTimeout(hide, 150);
  }
  function onClick(e: MouseEvent) {
    // No-hover (touch): first tap reveals the tooltip, second tap navigates.
    if (window.matchMedia("(hover: none)").matches && !pop.visible) {
      e.preventDefault();
      open();
    }
  }
  onDestroy(() => {
    clearTimeout(hideTimer);
    if (typeof document !== "undefined") document.removeEventListener("click", onOutside);
  });
</script>

<a
  bind:this={anchor}
  {href}
  class="model-term {cls}"
  class:model-term--underline={underline}
  on:mouseenter={open}
  on:mouseleave={scheduleHide}
  on:focus={open}
  on:blur={scheduleHide}
  on:click={onClick}
><slot>{MODEL_SHORT[model] ?? model}</slot></a>

{#if pop.visible && def}
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="model-pop"
    style="left:{pop.x}px;top:{pop.y}px;"
    role="tooltip"
    on:mouseenter={() => clearTimeout(hideTimer)}
    on:mouseleave={scheduleHide}
  >
    <p class="model-pop-term" style="color:{MODEL_COLORS[model]};">{model}</p>
    <p class="model-pop-def">{def}</p>
    <a {href} class="model-pop-link" on:click={hide}>Learn more →</a>
  </div>
{/if}

<style>
  .model-term {
    color: inherit;
    text-decoration: none;
    cursor: pointer;
  }
  .model-term--underline {
    font-weight: 600;
    text-decoration: underline;
    text-decoration-style: dotted;
    text-decoration-color: currentColor;
    text-underline-offset: 3px;
  }
  .model-term:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 2px;
    border-radius: 2px;
  }

  .model-pop {
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
  .model-pop-term {
    font-size: 13px;
    font-weight: 700;
    margin: 0 0 5px;
  }
  .model-pop-def {
    font-size: 12px;
    line-height: 1.55;
    color: #475569;
    margin: 0 0 8px;
  }
  .model-pop-link {
    font-size: 11px;
    font-weight: 600;
    color: #be6079;
    text-decoration: none;
  }
  .model-pop-link:hover {
    text-decoration: underline;
  }
</style>
