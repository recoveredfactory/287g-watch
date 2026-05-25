<script lang="ts">
  import type { ModelPageData } from "./+page.server";
  import { MODEL_COLORS, MODEL_TEXT_COLORS, MODEL_SHORT } from "$lib/colors";
  import { localizeHref } from "$lib/paraglide/runtime";
  import { STATE_NAMES } from "$lib/states";
  import AgencySearch from "$lib/components/AgencySearch.svelte";

  export let data: ModelPageData;

  const { modelName, slug, definition, seeAlso, agencies, snapshotDate } = data;

  const siteUrl = import.meta.env.PUBLIC_SITE_URL ?? "https://tracking287g.com";
  const title = `${modelName} — Tracking 287(g)`;
  const canonicalUrl = `${siteUrl}/model/${slug}`;

  const intFmt = new Intl.NumberFormat();
  const dateFmt = snapshotDate
    ? new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(snapshotDate))
    : null;

  const bgColor = MODEL_COLORS[modelName] ?? "#e2e8f0";
  const textColor = MODEL_TEXT_COLORS[modelName] ?? "#0f172a";
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={definition} />
  <link rel="canonical" href={canonicalUrl} />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={definition} />
  <meta property="og:url" content={canonicalUrl} />
</svelte:head>

<main id="main-content" class="mx-auto max-w-4xl px-4 py-12 sm:px-6">

  <!-- Breadcrumb -->
  <nav class="text-sm text-slate-500" aria-label="Breadcrumb">
    <a href={localizeHref("/")} class="no-underline hover:underline">Home</a>
    <span class="mx-1.5">›</span>
    <span>{modelName}</span>
  </nav>

  <!-- Header -->
  <div
    class="mt-6 overflow-hidden rounded-xl"
    style="background: {bgColor};"
  >
    <div class="px-6 py-8 sm:px-10 sm:py-10">
      <p class="font-sans text-xs font-bold uppercase tracking-widest" style="color: {textColor}; opacity: 0.75;">
        287(g) Agreement Type
      </p>
      <h1 class="mt-2 font-sans text-3xl font-black leading-tight sm:text-4xl" style="color: {textColor};">
        {modelName}
      </h1>
    </div>
  </div>

  <!-- Definition -->
  <section class="mt-8">
    <h2 class="font-serif text-xl font-bold text-slate-900">What this agreement authorizes</h2>
    <p class="mt-3 max-w-2xl leading-relaxed text-slate-700">{definition}</p>
  </section>

  <!-- See also -->
  {#if seeAlso.length > 0}
    <div class="mt-4 flex flex-wrap gap-2">
      {#each seeAlso as term}
        <a
          href={localizeHref(`/glossary#term-${term.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`)}
          class="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 no-underline hover:border-slate-400 hover:text-slate-900"
        >{term}</a>
      {/each}
    </div>
  {/if}

  <!-- Agency count -->
  <div class="mt-10 border-t border-slate-200 pt-8">
    <div class="flex items-baseline gap-3">
      <p class="font-mono text-3xl font-semibold tabular-nums text-slate-900">
        {intFmt.format(agencies.length)}
      </p>
      <p class="text-slate-500">participating agencies</p>
    </div>
    {#if dateFmt}
      <p class="mt-1 text-xs italic text-slate-400">As of {dateFmt}</p>
    {/if}
  </div>

  <!-- Agency list -->
  <div class="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {#each agencies as agency (agency.slug)}
      <a
        href={localizeHref(`/agency/${agency.slug}`)}
        class="group rounded-lg border border-slate-200 bg-white p-4 no-underline hover:border-slate-300 hover:shadow-sm"
      >
        <p class="font-semibold leading-snug text-slate-900 group-hover:text-slate-700">
          {agency.name}
        </p>
        <p class="mt-0.5 text-sm text-slate-500">
          {[agency.city, STATE_NAMES[agency.state] ?? agency.state].filter(Boolean).join(", ")}
        </p>
      </a>
    {/each}
  </div>

</main>
