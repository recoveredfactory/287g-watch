<script lang="ts">
  import "../app.css";
  import { navigating, page } from "$app/stores";
  import { onMount } from "svelte";
  import { m } from "$lib/paraglide/messages.js";
  import {
    getLocale,
    locales,
    localizeHref,
    deLocalizeHref,
    type Locale,
  } from "$lib/paraglide/runtime";

  const siteName = "Tracking 287(g)";

  const stage = (import.meta.env.PUBLIC_STAGE || "local").toString();
  const isProdStage = stage === "prod" || stage === "production";
  const faviconHref = isProdStage ? "/favicon.svg" : "/favicon-staging.svg";

  $: locale = getLocale();
  $: isEs = locale === "es";

  $: fromPath = String($navigating?.from?.url?.pathname || "/");
  $: toPath = String($navigating?.to?.url?.pathname || "/");
  $: isNavigating = Boolean($navigating) && fromPath !== toPath;

  // Un-localized path used for hreflang alternates and the language toggle
  $: basePath = deLocalizeHref($page.url.pathname);
  $: origin = $page.url.origin;

  function hrefFor(targetLocale: Locale) {
    return localizeHref(basePath, { locale: targetLocale });
  }

  const BANNER_KEY = "rf-banner-dismissed";
  let bannerVisible = false;

  onMount(() => {
    bannerVisible = !localStorage.getItem(BANNER_KEY);
  });

  function dismissBanner() {
    bannerVisible = false;
    localStorage.setItem(BANNER_KEY, "1");
  }
</script>

<svelte:head>
  <meta name="application-name" content={siteName} />
  <link rel="icon" type="image/svg+xml" href={faviconHref} />
  {#each locales as l}
    <link rel="alternate" hreflang={l} href="{origin}{hrefFor(l)}" />
  {/each}
  <link rel="alternate" hreflang="x-default" href="{origin}{hrefFor('en')}" />
</svelte:head>

<a
  href="#main-content"
  class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:shadow-lg focus:ring-2 focus:ring-blue-600"
>
  {m.skip_to_main()}
</a>

<div class={`page-fade ${isNavigating ? "page-fade--loading" : ""} ${bannerVisible ? "pb-20" : ""}`}>
  {#if !isProdStage}
    <div
      class="sticky top-0 z-[60] flex items-center justify-center gap-2 bg-amber-400 px-4 py-1 text-center text-xs font-semibold uppercase tracking-wider text-amber-950"
      role="alert"
      aria-label="Non-production environment warning"
    >
      <span aria-hidden="true">⚠</span>
      <span>{m.staging_banner({ stage })}</span>
    </div>
  {/if}
  <header
    class="sticky z-50 border-b border-slate-200 bg-stone-50/95 backdrop-blur"
    style:top={isProdStage ? "0" : "28px"}
  >
    <div class="mx-auto max-w-6xl px-4 sm:px-6">
      <div class="flex flex-col py-3 sm:h-14 sm:flex-row sm:items-center sm:justify-between sm:py-0">
        <a
          href={localizeHref("/")}
          class="font-serif text-base font-bold tracking-tight text-slate-900 no-underline hover:no-underline sm:text-lg"
        >
          {siteName}
        </a>
        <nav class="mt-2 flex items-center gap-5 text-sm text-slate-600 sm:mt-0">
          <a href={localizeHref("/")} class="no-underline hover:text-slate-900">{m.nav_map()}</a>
          <a href={localizeHref("/glossary")} class="no-underline hover:text-slate-900">{m.nav_glossary()}</a>
          <a href={localizeHref("/about")} class="no-underline hover:text-slate-900">{m.nav_about()}</a>
          <a href={localizeHref("/methodology")} class="no-underline hover:text-slate-900">{m.nav_methodology()}</a>
          <div class="flex items-center gap-2 border-l border-slate-200 pl-5 text-xs uppercase tracking-wider" aria-label={m.lang_toggle_aria()}>
            {#each locales as l, i}
              {#if i > 0}<span aria-hidden="true" class="text-slate-300">·</span>{/if}
              <a
                href={hrefFor(l)}
                class={l === locale
                  ? "font-semibold text-slate-900 no-underline"
                  : "text-slate-500 no-underline hover:text-slate-900"}
                aria-current={l === locale ? "true" : undefined}
                hreflang={l}
                rel="alternate"
              >
                {l === "en" ? m.lang_en() : m.lang_es()}
              </a>
            {/each}
          </div>
        </nav>
      </div>
    </div>
  </header>

  {#if isEs}
    <p
      class="mx-auto max-w-6xl px-4 py-2 text-xs italic text-slate-500 sm:px-6"
      role="note"
    >
      {m.source_material_notice()}
      <a href={localizeHref("/methodology")} class="text-slate-600 underline">{m.nav_methodology()}</a>.
    </p>
  {/if}

  <slot />

  <footer class="mt-16 border-t border-slate-200 bg-white px-4 py-8 text-sm text-slate-500">
    <div class="mx-auto max-w-6xl space-y-3 text-center">
      <p>
        <span class="font-semibold text-slate-700">{siteName}</span>
        {m.footer_tagline_after_name()}
      </p>
      <p>
        <a href={localizeHref("/methodology")}>{m.footer_methodology()}</a>
        ·
        <a href={localizeHref("/about")}>{m.footer_about()}</a>
      </p>
      <p class="text-xs text-slate-400">
        {m.footer_credit_prefix()}
        <a href="https://vsr.recoveredfactory.net/en" target="_blank" rel="noreferrer" class="text-slate-500">{m.footer_credit_org_name()}</a>.
        {m.footer_credit_suffix()}
      </p>
    </div>
  </footer>
</div>

{#if bannerVisible}
  <div
    class="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-between gap-4 px-4 py-4 sm:px-6"
    style="background-color: #1e3a5f;"
    role="complementary"
    aria-label="Support Recovered Factory"
  >
    <div class="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-4">
      <p class="text-sm font-semibold text-white">{m.rf_banner_question()}</p>
      <p class="text-sm text-slate-300 sm:truncate">
        {m.rf_banner_pitch()}
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-3">
      <a
        href="https://vsr.recoveredfactory.net/en"
        target="_blank"
        rel="noreferrer"
        class="rounded px-3 py-1.5 text-sm font-semibold no-underline hover:no-underline"
        style="background-color: #80ed99; color: #0f3020;"
      >
        {m.rf_banner_cta()}
      </a>
      <button
        on:click={dismissBanner}
        aria-label={m.rf_banner_dismiss()}
        class="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4" aria-hidden="true">
          <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"/>
        </svg>
      </button>
    </div>
  </div>
{/if}
