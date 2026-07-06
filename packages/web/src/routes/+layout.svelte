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

  // The /video/national route is a bare 1080×1920 canvas baked into a social
  // video (#167) — it must render with no site chrome (header, footer, banners,
  // source notice) so the capture is clean. Suppress all of that here rather
  // than stripping the DOM in the bake script.
  $: isVideoRoute = basePath === "/video/national";

  function hrefFor(targetLocale: Locale) {
    return localizeHref(basePath, { locale: targetLocale });
  }

  // Active-tab matcher for the header nav. "/" only matches the home page
  // exactly; other paths match the page itself plus any nested route.
  const isNavActive = (href: string, current: string): boolean =>
    href === "/" ? current === "/" : current === href || current.startsWith(href + "/");

  // Session-only dismissal (#93): user gets the banner once per browser
  // session, not once-and-forever. localStorage was too sticky — we'd
  // rather risk re-showing the banner across sessions than lose all
  // visibility for someone who clicked × six months ago.
  const BANNER_KEY = "rf-banner-dismissed";
  let bannerVisible = false;

  // RF banner A/B test (#93): random pick per page-view, equal weight,
  // assigned client-side once the banner is about to render. Two complete
  // pairs — different pitch + CTA + destination — testing which framing
  // (commercial vs reader-support) converts better.
  //   hire    → mailto, "Got messy data? / We'll turn the noise into signal."
  //   support → /support, "This data belongs to you. / Help us keep it open."
  // Fires conversion_impression_{variant} on mount + conversion_click_{variant}
  // when the CTA is tapped.
  type ConversionVariant = "hire" | "support";
  const CONVERSION_VARIANTS: ConversionVariant[] = ["hire", "support"];
  let conversionVariant: ConversionVariant = "hire";
  $: bannerHref =
    conversionVariant === "hire"
      ? "mailto:davideads@recoveredfactory.net"
      : `https://recoveredfactory.net/${locale}/support`;
  $: bannerHook =
    conversionVariant === "hire"
      ? m.rf_banner_hire_hook()
      : m.rf_banner_support_hook();
  $: bannerFollow =
    conversionVariant === "hire"
      ? m.rf_banner_hire_follow()
      : m.rf_banner_support_follow();
  $: bannerCtaLabel =
    conversionVariant === "hire"
      ? m.rf_banner_hire_cta()
      : m.rf_banner_support_cta();
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
    bannerVisible = !sessionStorage.getItem(BANNER_KEY);
    if (bannerVisible) {
      conversionVariant =
        CONVERSION_VARIANTS[
          Math.floor(Math.random() * CONVERSION_VARIANTS.length)
        ];
      trackConversion(`conversion_impression_${conversionVariant}`);
    }

    if (localStorage.getItem(MISMATCH_KEY)) return;
    if (hasLocaleCookie()) return; // user has already expressed a preference
    const browserLang = (navigator.language || "en").split("-")[0].toLowerCase();
    if (browserLang === locale) return;
    if (!(locales as readonly string[]).includes(browserLang)) return;
    mismatchTarget = browserLang as Locale;
  });

  function dismissBanner() {
    bannerVisible = false;
    sessionStorage.setItem(BANNER_KEY, "1");
  }

  function onBannerCta() {
    trackConversion(`conversion_click_${conversionVariant}`);
  }

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
  class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:shadow-lg focus:ring-2 focus:ring-blue-600"
>
  {m.skip_to_main()}
</a>

<div
  class={`page-fade ${isNavigating ? "page-fade--loading" : ""} ${bannerVisible && !isVideoRoute ? "pb-28" : ""}`}
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
      class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-blue-200 bg-blue-50 px-4 py-2 text-center text-sm text-blue-950"
      role="region"
      aria-label={mismatchTarget === "es" ? "Sugerencia de idioma" : "Language suggestion"}
    >
      {#if mismatchTarget === "es"}
        <span>¿Prefieres esta página en español?</span>
        <a
          href={hrefFor("es")}
          on:click={() => rememberLocale("es")}
          data-sveltekit-reload
          class="font-semibold text-blue-900 underline underline-offset-2 hover:text-blue-700"
        >Sí, cambiar</a>
        <button
          type="button"
          on:click={dismissMismatch}
          class="text-xs text-blue-700/70 underline underline-offset-2 hover:text-blue-700"
        >No, gracias</button>
      {:else}
        <span>Prefer this page in English?</span>
        <a
          href={hrefFor("en")}
          on:click={() => rememberLocale("en")}
          data-sveltekit-reload
          class="font-semibold text-blue-900 underline underline-offset-2 hover:text-blue-700"
        >Yes, switch</a>
        <button
          type="button"
          on:click={dismissMismatch}
          class="text-xs text-blue-700/70 underline underline-offset-2 hover:text-blue-700"
        >No thanks</button>
      {/if}
    </div>
  {/if}
  {#if !isVideoRoute}
  <header
    class="sticky z-50 border-b border-black/20 backdrop-blur"
    style="top: var(--staging-banner-height); background-color: #191919;"
  >
    <div class="mx-auto max-w-6xl px-4 sm:px-6">
      <!-- Mobile: two rows (logo+lang / nav links). Desktop: single row. -->
      <div class="py-3 sm:flex sm:h-14 sm:items-center sm:py-0">

        <!-- Row 1 on mobile: logo + lang switcher -->
        <div class="flex items-center justify-between sm:contents">
          <a
            href={localizeHref("/")}
            class="font-serif text-base font-bold tracking-tight text-white no-underline hover:no-underline sm:text-lg"
          >
            {siteName}
          </a>
          <!-- Lang switcher — visible on mobile in this row; hidden on sm+ (re-appears in nav) -->
          <div class="flex items-center gap-2 pl-4 text-xs uppercase tracking-wider text-white sm:hidden" aria-label={m.lang_toggle_aria()}>
            {#each locales as l, i}
              {#if i > 0}<span aria-hidden="true" class="text-white/30">·</span>{/if}
              <a
                href={hrefFor(l)}
                on:click={() => rememberLocale(l)}
                class={l === locale ? "font-semibold text-white no-underline" : "text-white/50 no-underline hover:text-white"}
                aria-current={l === locale ? "true" : undefined}
                hreflang={l}
                rel="alternate"
                data-sveltekit-reload
              >{l === "en" ? m.lang_en() : m.lang_es()}</a>
            {/each}
          </div>
        </div>

        <!-- Row 2 on mobile / middle+right on desktop -->
        <div class="mt-2.5 flex items-center sm:mt-0 sm:flex-1">
          <nav class="flex items-center gap-5 text-sm font-semibold sm:ml-8">
            <a
              href={localizeHref("/")}
              class="no-underline {isNavActive('/', basePath) ? 'text-white underline underline-offset-4 decoration-2' : 'text-white/60 hover:text-white'}"
              aria-current={isNavActive('/', basePath) ? 'page' : undefined}
            ><span class="sm:hidden">{m.nav_map_short()}</span><span class="hidden sm:inline">{m.nav_map()}</span></a>
            <a
              href={localizeHref("/states")}
              class="no-underline {isNavActive('/states', basePath) ? 'text-white underline underline-offset-4 decoration-2' : 'text-white/60 hover:text-white'}"
              aria-current={isNavActive('/states', basePath) ? 'page' : undefined}
            >{m.nav_states()}</a>
            <a
              href={localizeHref("/about")}
              class="no-underline {isNavActive('/about', basePath) ? 'text-white underline underline-offset-4 decoration-2' : 'text-white/60 hover:text-white'}"
              aria-current={isNavActive('/about', basePath) ? 'page' : undefined}
            >{m.nav_about()}</a>
            <a
              href={localizeHref("/glossary")}
              class="no-underline {isNavActive('/glossary', basePath) ? 'text-white underline underline-offset-4 decoration-2' : 'text-white/60 hover:text-white'}"
              aria-current={isNavActive('/glossary', basePath) ? 'page' : undefined}
            >{m.nav_glossary()}</a>
            <a
              href={localizeHref("/methodology")}
              class="no-underline {isNavActive('/methodology', basePath) ? 'text-white underline underline-offset-4 decoration-2' : 'text-white/60 hover:text-white'}"
              aria-current={isNavActive('/methodology', basePath) ? 'page' : undefined}
            >{m.nav_methodology()}</a>
          </nav>
          <!-- Lang switcher — hidden on mobile; visible on desktop -->
          <div class="ml-auto hidden items-center gap-2 border-l border-white/20 pl-5 text-xs uppercase tracking-wider sm:flex" aria-label={m.lang_toggle_aria()}>
            {#each locales as l, i}
              {#if i > 0}<span aria-hidden="true" class="text-white/30">·</span>{/if}
              <a
                href={hrefFor(l)}
                on:click={() => rememberLocale(l)}
                class={l === locale ? "font-semibold text-white no-underline" : "text-white/50 no-underline hover:text-white"}
                aria-current={l === locale ? "true" : undefined}
                hreflang={l}
                rel="alternate"
                data-sveltekit-reload
              >{l === "en" ? m.lang_en() : m.lang_es()}</a>
            {/each}
          </div>
        </div>

      </div>
    </div>
  </header>
  {/if}

  {#if isEs && !isVideoRoute}
    <p
      class="mx-auto max-w-6xl px-4 py-2 text-xs italic text-slate-500 sm:px-6"
      role="note"
    >
      {m.source_material_notice()}
      <a href={localizeHref("/methodology")} class="text-slate-600 underline">{m.nav_methodology()}</a>.
    </p>
  {/if}

  <slot />

  {#if !isVideoRoute}
  <footer class="mt-16 border-t border-black/20 px-4 py-8 text-sm" style="background-color: #191919; color: rgba(255,255,255,0.6);">
    <div class="mx-auto max-w-6xl space-y-3 text-left sm:text-center">
      <p>
        <span class="font-semibold text-white">{siteName}</span>
        {m.footer_tagline_after_name()}
      </p>
      <p>
        <a href={localizeHref("/")} class="text-white/60 hover:text-white">{m.nav_map()}</a>
        <span class="mx-1.5 text-white/30">·</span>
        <a href={localizeHref("/glossary")} class="text-white/60 hover:text-white">{m.nav_glossary()}</a>
        <span class="mx-1.5 text-white/30">·</span>
        <a href={localizeHref("/methodology")} class="text-white/60 hover:text-white">{m.footer_methodology()}</a>
        <span class="mx-1.5 text-white/30">·</span>
        <a href={localizeHref("/about")} class="text-white/60 hover:text-white">{m.footer_about()}</a>
      </p>
      <p class="text-xs" style="color: rgba(255,255,255,0.35);">
        {m.footer_credit_prefix()}
        <a href="https://vsr.recoveredfactory.net/en" target="_blank" rel="noreferrer" class="hover:text-white/60" style="color: rgba(255,255,255,0.45);">{m.footer_credit_org_name()}</a>.
        {m.footer_credit_suffix()}
      </p>
      <p class="text-xs" style="color: rgba(255,255,255,0.3);">
        {m.footer_build()} {buildStamp}
      </p>
    </div>
  </footer>
  {/if}
</div>

{#if bannerVisible && !isVideoRoute}
  <div
    class="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-between gap-4 px-4 py-4 sm:px-6"
    style="background-color: #2c2c2c;"
    role="complementary"
    aria-label="Support Recovered Factory"
  >
    <div class="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2">
      <p class="text-sm font-semibold text-white">{bannerHook}</p>
      <p class="text-sm text-white/80 sm:truncate">
        {bannerFollow}
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-3">
      <a
        href={bannerHref}
        target={conversionVariant === "support" ? "_blank" : "_self"}
        rel={conversionVariant === "support" ? "noreferrer" : null}
        on:click={onBannerCta}
        data-variant={conversionVariant}
        class="rounded px-3 py-1.5 text-sm font-semibold no-underline hover:no-underline"
        style="background-color: #BE6079; color: #ffffff;"
      >
        {bannerCtaLabel}
      </a>
      <button
        on:click={dismissBanner}
        aria-label={m.rf_banner_dismiss()}
        class="flex h-7 w-7 items-center justify-center rounded text-white/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4" aria-hidden="true">
          <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"/>
        </svg>
      </button>
    </div>
  </div>
{/if}
