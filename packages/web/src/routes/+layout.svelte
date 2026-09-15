<script lang="ts">
  import "../app.css";
  import { navigating, page } from "$app/stores";
  import { onMount } from "svelte";
  import { m } from "$lib/paraglide/messages.js";
  import LanguageSwitcher from "$lib/components/LanguageSwitcher.svelte";
  import CommandPalette from "$lib/components/CommandPalette.svelte";
  import {
    getLocale,
    locales,
    localizeHref,
    deLocalizeHref,
    cookieName as localeCookieName,
    cookieMaxAge as localeCookieMaxAge,
    type Locale,
  } from "$lib/paraglide/runtime";

  function rememberLocale(target: Locale) {
    if (typeof document === "undefined") return;
    document.cookie = `${localeCookieName}=${target}; path=/; max-age=${localeCookieMaxAge}; samesite=lax`;
  }

  function hasLocaleCookie(): boolean {
    if (typeof document === "undefined") return false;
    return document.cookie.split(";").some((c) => c.trim().startsWith(`${localeCookieName}=`));
  }

  const siteName = "287(g) Watch";

  // Build timestamp, frozen at build time via Vite `define` (vite.config.ts) —
  // a quiet "last deployed" flag in the footer. A data-refresh run that
  // redeploys bumps it. UTC, minute precision: "2026-06-14 03:47 UTC".
  const buildStamp = `${__BUILD_TIME__.slice(0, 10)} ${__BUILD_TIME__.slice(11, 16)} UTC`;

  const stage = (import.meta.env.PUBLIC_STAGE || "local").toString();
  const isProdStage = stage === "prod" || stage === "production";
  const faviconHref = isProdStage ? "/favicon.svg" : "/favicon-staging.svg";

  // Umami analytics: load on deployed stages (prod + staging), skip local dev.
  const umamiEnabled = stage !== "local";

  $: locale = getLocale();
  $: isEs = locale === "es";

  $: fromPath = String($navigating?.from?.url?.pathname || "/");
  $: toPath = String($navigating?.to?.url?.pathname || "/");
  $: isNavigating = Boolean($navigating) && fromPath !== toPath;

  // Un-localized path used for hreflang alternates and the language toggle
  $: basePath = deLocalizeHref($page.url.pathname);
  $: origin = $page.url.origin;

  // The /video/* routes are bare fixed-size canvases baked into social assets
  // (#167 national video, the surge email/social graphic) — they must render
  // with no site chrome (header, footer, banners, source notice) so the capture
  // is clean. Suppress all of that here rather than stripping the DOM in the
  // bake scripts.
  $: isVideoRoute = basePath === "/video/national" || basePath.startsWith("/video/");

  // Trailing slash stripped so hreflang/canonical match the sitemap and the
  // bare-path redirect, which both emit /en — not /en/.
  function hrefFor(targetLocale: Locale) {
    const href = localizeHref(basePath, { locale: targetLocale });
    return href.length > 1 ? href.replace(/\/$/, "") : href;
  }

  // Active-tab matcher for the header nav. "/" only matches the home page
  // exactly; other paths match the page itself plus any nested route.
  const isNavActive = (href: string, current: string): boolean =>
    href === "/" ? current === "/" : current === href || current.startsWith(href + "/");

  function trackConversion(event: string) {
    if (typeof window === "undefined") return;
    const w = window as unknown as { umami?: { track?: (e: string) => void } };
    w.umami?.track?.(event);
  }

  // Language-mismatch banner: offers to switch when the browser's preferred
  // language differs from the URL locale. Dismissed once, never returns.
  const MISMATCH_KEY = "rf-lang-mismatch-dismissed-v1";
  let mismatchTarget: Locale | null = null;

  onMount(() => {
    if (localStorage.getItem(MISMATCH_KEY)) return;
    if (hasLocaleCookie()) return; // user has already expressed a preference
    const browserLang = (navigator.language || "en").split("-")[0].toLowerCase();
    if (browserLang === locale) return;
    if (!(locales as readonly string[]).includes(browserLang)) return;
    mismatchTarget = browserLang as Locale;
  });

  function dismissMismatch() {
    mismatchTarget = null;
    try {
      localStorage.setItem(MISMATCH_KEY, "1");
    } catch {}
  }

</script>

<svelte:head>
  <meta name="application-name" content={siteName} />
  <link rel="icon" type="image/svg+xml" href={faviconHref} />
  <link rel="canonical" href="{origin}{hrefFor(locale)}" />
  {#each locales as l}
    <link rel="alternate" hreflang={l} href="{origin}{hrefFor(l)}" />
  {/each}
  <link rel="alternate" hreflang="x-default" href="{origin}{hrefFor('en')}" />
  {#if umamiEnabled}
    <script
      defer
      src="https://cloud.umami.is/script.js"
      data-website-id="5e257c41-7b94-419c-8f4a-d1ce88f7d112"
    ></script>
  {/if}
</svelte:head>

<a
  href="#main-content"
  class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded focus:bg-paper-50 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:shadow-lg focus:ring-2 focus:ring-ink-900"
>
  {m.skip_to_main()}
</a>

<div
  class={`page-fade ${isNavigating ? "page-fade--loading" : ""}`}
  style:--staging-banner-height={isProdStage ? "0px" : "28px"}
>
  {#if !isProdStage && !isVideoRoute}
    <div
      class="sticky top-0 z-[60] flex items-center justify-center gap-2 bg-red-600 px-4 py-1 text-center text-xs font-semibold uppercase tracking-wider text-white"
      role="alert"
      aria-label="Non-production environment warning"
      style="height: var(--staging-banner-height);"
    >
      <span>{m.staging_banner()}</span>
      <span aria-hidden="true">•</span>
      <code class="font-mono normal-case tracking-normal">{stage}</code>
    </div>
  {/if}
  {#if mismatchTarget && !isVideoRoute}
    <div
      class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b px-4 py-2 text-center text-sm"
      style="border-color: var(--color-paper-200); background: var(--color-paper-100); color: var(--color-ink-900);"
      role="region"
      aria-label={mismatchTarget === "es" ? "Sugerencia de idioma" : "Language suggestion"}
    >
      {#if mismatchTarget === "es"}
        <span>¿Prefieres esta página en español?</span>
        <a
          href={hrefFor("es")}
          on:click={() => rememberLocale("es")}
          data-sveltekit-reload
          class="font-semibold underline underline-offset-2"
          style="color: var(--color-ink-900);"
        >Sí, cambiar</a>
        <button
          type="button"
          on:click={dismissMismatch}
          class="text-xs underline underline-offset-2"
          style="color: var(--color-ink-500);"
        >No, gracias</button>
      {:else}
        <span>Prefer this page in English?</span>
        <a
          href={hrefFor("en")}
          on:click={() => rememberLocale("en")}
          data-sveltekit-reload
          class="font-semibold underline underline-offset-2"
          style="color: var(--color-ink-900);"
        >Yes, switch</a>
        <button
          type="button"
          on:click={dismissMismatch}
          class="text-xs underline underline-offset-2"
          style="color: var(--color-ink-500);"
        >No thanks</button>
      {/if}
    </div>
  {/if}
  {#if !isVideoRoute}
  <header
    class="sticky z-50 border-b backdrop-blur"
    style="top: var(--staging-banner-height); background-color: var(--color-paper-100); border-color: var(--color-paper-200);"
  >
    <div class="mx-auto max-w-6xl px-4 sm:px-6">
      <!-- Mobile: two rows (logo+lang / nav links). Desktop: single row.
           The language-switcher markup itself lives once, in
           lib/components/LanguageSwitcher.svelte — rendered at both
           positions below so there's one source of truth for the links even
           though the layout needs two different visual slots for it across
           breakpoints. (A local {#snippet} would be the more idiomatic
           Svelte 5 way to do this, but this file still uses the legacy
           <slot/> API for its own children, and the two can't mix in one
           component — a real subcomponent sidesteps that without forcing a
           full runes-mode migration of this already-large layout file.) -->
      <div class="py-3 sm:flex sm:h-14 sm:items-center sm:py-0">

        <!-- Row 1 on mobile: logo + inline search + lang switcher (lang
             switcher uses ml-auto to push right now that there are 3 items —
             justify-between doesn't work cleanly with 3 children, it'd float
             the middle one away from the logo instead of clustering left). -->
        <div class="flex items-center sm:contents">
          <a
            href={localizeHref("/")}
            class="shrink-0 font-serif text-base font-bold tracking-tight no-underline hover:no-underline sm:text-lg"
            style="color: var(--color-ink-900);"
          >
            {siteName}
          </a>
          <CommandPalette />
          <LanguageSwitcher {hrefFor} extraClass="ml-auto pl-4 sm:hidden" />
        </div>

        <!-- Row 2 on mobile / middle+right on desktop -->
        <div class="mt-2.5 flex items-center sm:mt-0 sm:flex-1">
          <nav class="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm font-semibold sm:ml-8 sm:flex-nowrap sm:gap-5">
            <a
              href={localizeHref("/states")}
              class="no-underline {isNavActive('/states', basePath) ? 'text-ink-900 underline underline-offset-4 decoration-2' : 'text-ink-700 hover:text-ink-900'}"
              aria-current={isNavActive('/states', basePath) ? 'page' : undefined}
            >{m.nav_states()}</a>
            <a
              href={localizeHref("/timeline")}
              class="no-underline {isNavActive('/timeline', basePath) ? 'text-ink-900 underline underline-offset-4 decoration-2' : 'text-ink-700 hover:text-ink-900'}"
              aria-current={isNavActive('/timeline', basePath) ? 'page' : undefined}
            >{m.nav_timeline()}</a>
            <a
              href={localizeHref("/glossary")}
              class="no-underline {isNavActive('/glossary', basePath) ? 'text-ink-900 underline underline-offset-4 decoration-2' : 'text-ink-700 hover:text-ink-900'}"
              aria-current={isNavActive('/glossary', basePath) ? 'page' : undefined}
            >{m.nav_glossary()}</a>
            <a
              href={localizeHref("/about")}
              class="no-underline {isNavActive('/about', basePath) ? 'text-ink-900 underline underline-offset-4 decoration-2' : 'text-ink-700 hover:text-ink-900'}"
              aria-current={isNavActive('/about', basePath) ? 'page' : undefined}
            >{m.nav_about()}</a>
          </nav>
          <LanguageSwitcher {hrefFor} extraClass="ml-auto hidden border-l border-paper-200 pl-5 sm:flex" />
        </div>

      </div>
    </div>
  </header>
  {/if}

  {#if isEs && !isVideoRoute}
    <p
      class="mx-auto max-w-6xl px-4 py-2 text-xs italic sm:px-6"
      style="color: var(--color-ink-700);"
      role="note"
    >
      {m.source_material_notice()}
      <a href={localizeHref("/about#methodology")} class="underline" style="color: var(--color-ink-900);">{m.nav_methodology_link()}</a>.
    </p>
  {/if}

  <slot />

  {#if !isVideoRoute}
  <footer class="mt-16 border-t px-4 py-8 text-sm" style="background-color: var(--color-paper-100); border-color: var(--color-paper-200); color: var(--color-ink-700);">
    <div class="mx-auto max-w-6xl space-y-3 text-left sm:text-center">
      <p>
        <span class="font-semibold" style="color: var(--color-ink-900);">{siteName}</span>
        {m.footer_tagline_after_name()}
      </p>
      <p>
        <a href={localizeHref("/states")} class="text-ink-700 hover:text-ink-900">{m.nav_states()}</a>
        <span class="mx-1.5 text-ink-500">·</span>
        <a href={localizeHref("/timeline")} class="text-ink-700 hover:text-ink-900">{m.nav_timeline()}</a>
        <span class="mx-1.5 text-ink-500">·</span>
        <a href={localizeHref("/glossary")} class="text-ink-700 hover:text-ink-900">{m.nav_glossary()}</a>
        <span class="mx-1.5 text-ink-500">·</span>
        <a href={localizeHref("/about")} class="text-ink-700 hover:text-ink-900">{m.footer_about()}</a>
      </p>
      <p class="text-xs" style="color: var(--color-ink-500);">
        {m.footer_credit_prefix()}
        <a href="https://vsr.recoveredfactory.net/en" target="_blank" rel="noreferrer" class="hover:text-ink-900" style="color: var(--color-ink-700);">{m.footer_credit_org_name()}</a>.
        {m.footer_credit_suffix()}
      </p>
      <p class="text-xs" style="color: var(--color-ink-500);">
        {m.footer_build()} {buildStamp}
      </p>
    </div>
  </footer>
  {/if}
</div>
