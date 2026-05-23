<script>
  import "../app.css";
  import { navigating } from "$app/stores";
  import { onMount } from "svelte";

  const siteName = "Tracking 287(g)";

  $: fromPath = String($navigating?.from?.url?.pathname || "/");
  $: toPath = String($navigating?.to?.url?.pathname || "/");
  $: isNavigating = Boolean($navigating) && fromPath !== toPath;

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
</svelte:head>

<a
  href="#main-content"
  class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:shadow-lg focus:ring-2 focus:ring-blue-600"
>
  Skip to main content
</a>

<div class={`page-fade ${isNavigating ? "page-fade--loading" : ""} ${bannerVisible ? "pb-20" : ""}`}>
  <header class="sticky top-0 z-50 border-b border-slate-200 bg-stone-50/95 backdrop-blur">
    <div class="mx-auto max-w-6xl px-4 sm:px-6">
      <div class="flex flex-col py-3 sm:h-14 sm:flex-row sm:items-center sm:justify-between sm:py-0">
        <a
          href="/"
          class="font-serif text-base font-bold tracking-tight text-slate-900 no-underline hover:no-underline sm:text-lg"
        >
          Tracking 287(g)
        </a>
        <nav class="mt-2 flex items-center gap-5 text-sm text-slate-600 sm:mt-0">
          <a href="/" class="no-underline hover:text-slate-900">Map</a>
          <a href="/glossary" class="no-underline hover:text-slate-900">Glossary</a>
          <a href="/about" class="no-underline hover:text-slate-900">About</a>
          <a href="/methodology" class="no-underline hover:text-slate-900">Methodology</a>
        </nav>
      </div>
    </div>
  </header>

  <slot />

  <footer class="mt-16 border-t border-slate-200 bg-white px-4 py-8 text-sm text-slate-500">
    <div class="mx-auto max-w-6xl space-y-3 text-center">
      <p><span class="font-semibold text-slate-700">Tracking 287(g)</span> — a public-interest journalism project. Records, corrections, and tips welcome.</p>
      <p><a href="/methodology">Methodology</a> · <a href="/about">About</a></p>
      <p class="text-xs text-slate-400">
        A project of <a href="https://vsr.recoveredfactory.net/en" target="_blank" rel="noreferrer" class="text-slate-500">Recovered Factory</a>.
        Developed by David Eads and Tory Lysik.
        Code, design, and text copyright &copy; 2026 Recovered Factory.
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
      <p class="text-sm font-semibold text-white">Love our work?</p>
      <p class="text-sm text-slate-300 sm:truncate">
        Recovered Factory builds data journalism tools for public-interest newsrooms.
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
        Get in touch
      </a>
      <button
        on:click={dismissBanner}
        aria-label="Dismiss"
        class="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4" aria-hidden="true">
          <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"/>
        </svg>
      </button>
    </div>
  </div>
{/if}
