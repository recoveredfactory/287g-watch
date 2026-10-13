<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import {
    getLocale,
    locales,
    cookieName as localeCookieName,
    cookieMaxAge as localeCookieMaxAge,
    type Locale,
  } from "$lib/paraglide/runtime";

  // hrefFor is passed in rather than computed here — it depends on the
  // current page's un-localized path (basePath), which is a layout-level
  // concern (see +layout.svelte).
  export let hrefFor: (target: Locale) => string;
  export let extraClass = "";

  $: locale = getLocale();

  function rememberLocale(target: Locale) {
    if (typeof document === "undefined") return;
    document.cookie = `${localeCookieName}=${target}; path=/; max-age=${localeCookieMaxAge}; samesite=lax`;
  }
</script>

<div class="flex items-center gap-2 text-xs uppercase tracking-wider {extraClass}" aria-label={m.lang_toggle_aria()}>
  {#each locales as l, i}
    {#if i > 0}<span aria-hidden="true" class="text-ink-500">·</span>{/if}
    <a
      href={hrefFor(l)}
      on:click={() => rememberLocale(l)}
      class={l === locale ? "font-semibold text-ink-900 no-underline" : "text-ink-700 no-underline hover:text-ink-900"}
      aria-current={l === locale ? "true" : undefined}
      hreflang={l}
      rel="alternate"
      data-sveltekit-reload
    >{l === "en" ? m.lang_en() : m.lang_es()}</a>
  {/each}
</div>
