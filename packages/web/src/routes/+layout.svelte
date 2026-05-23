<script>
  import "../app.css";
  import { navigating } from "$app/stores";

  const siteName = "Tracking 287(g)";

  $: fromPath = String($navigating?.from?.url?.pathname || "/");
  $: toPath = String($navigating?.to?.url?.pathname || "/");
  $: isNavigating = Boolean($navigating) && fromPath !== toPath;
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

<div class={`page-fade ${isNavigating ? "page-fade--loading" : ""}`}>
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

  <footer class="mt-16 border-t border-slate-200 bg-white px-4 py-10 text-sm text-slate-500">
    <div class="mx-auto max-w-6xl">
      <div class="grid gap-6 sm:grid-cols-2">
        <div class="space-y-2">
          <p class="font-semibold text-slate-700">Tracking 287(g)</p>
          <p>A public-interest journalism project.</p>
          <p>Records, corrections, and tips welcome.</p>
        </div>
        <div class="space-y-2">
          <p class="font-semibold text-slate-700">Data sources</p>
          <p>
            ICE, FBI Census of State and Local Law Enforcement Agencies, and
            <a href="https://github.com/appelson/Tracking_287g" target="_blank" rel="noreferrer"
              >community archiving efforts</a
            >.
          </p>
          <p><a href="/methodology">Methodology</a> · <a href="/glossary">Glossary</a> · <a href="/about">About</a></p>
        </div>
      </div>
    </div>
  </footer>
</div>
