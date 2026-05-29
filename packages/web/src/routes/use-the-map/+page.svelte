<script lang="ts">
  import { localizeHref } from "$lib/paraglide/runtime";
  import { m } from "$lib/paraglide/messages.js";
  import type { PageData } from "./$types";

  export let data: PageData;

  $: title = m.usemap_meta_title();
  $: description = m.usemap_meta_description();
  const siteUrl = import.meta.env.PUBLIC_SITE_URL ?? "https://287g.recoveredfactory.net";

  const LICENSE_URL = "https://creativecommons.org/licenses/by-nd/4.0/";
  const LICENSE_EMAIL = "davideads@recoveredfactory.net";

  $: asOf = data.snapshotDate
    ? new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      }).format(new Date(data.snapshotDate))
    : null;
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:image" content="{siteUrl}/og/home.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="twitter:card" content="summary_large_image" />
  <meta property="twitter:image" content="{siteUrl}/og/home.png" />
</svelte:head>

<main id="main-content" class="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
  <h1 class="text-2xl font-black text-slate-900 sm:text-4xl">{m.usemap_heading()}</h1>

  <div class="prose-editorial mt-6 sm:mt-8">
    <p>{m.usemap_intro()}</p>
  </div>

  <!-- Map preview -->
  <figure class="mt-8">
    <video
      class="w-full rounded-lg border border-slate-200 shadow-sm"
      src="/video/map.mp4"
      autoplay
      loop
      muted
      playsinline
      aria-label={m.usemap_video_label()}
    ></video>
    {#if asOf}
      <figcaption class="mt-2 text-xs italic text-slate-400">
        {m.usemap_asof({ date: asOf })}
      </figcaption>
    {/if}
  </figure>

  <!-- Download -->
  <div class="mt-8 sm:mt-10">
    <h2 class="font-serif text-xl font-bold text-slate-900 sm:text-2xl">{m.usemap_download_heading()}</h2>
    <div class="mt-4 flex flex-wrap gap-3">
      <a
        href="/video/map.mp4"
        download
        class="inline-flex items-center gap-2 rounded bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
      >
        {m.usemap_download_mp4()}
      </a>
      <a
        href="/video/map.gif"
        download
        class="inline-flex items-center gap-2 rounded border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 hover:border-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
      >
        {m.usemap_download_gif()}
      </a>
    </div>
    <p class="mt-3 text-sm text-slate-500">{m.usemap_download_note()}</p>
    <p class="mt-2 text-sm text-slate-500">{m.usemap_aspect_note()}</p>
  </div>

  <!-- License -->
  <div class="prose-editorial mt-8 sm:mt-10">
    <h2 class="font-serif text-xl font-bold text-slate-900 sm:text-2xl">{m.usemap_license_heading()}</h2>
    <p class="mt-3">
      {m.usemap_license_body_prefix()}
      <a href={LICENSE_URL} target="_blank" rel="noreferrer">{m.usemap_license_link()}</a>
      {m.usemap_license_body_suffix()}
    </p>

    <h2 class="mt-8 font-serif text-xl font-bold text-slate-900 sm:mt-10 sm:text-2xl">{m.usemap_custom_heading()}</h2>
    <p class="mt-3">
      {m.usemap_custom_body_prefix()}
      <a href="mailto:{LICENSE_EMAIL}">{LICENSE_EMAIL}</a>
      {m.usemap_custom_body_suffix()}
    </p>
  </div>

  <p class="mt-10">
    <a href={localizeHref("/")} class="text-sm font-semibold text-slate-900 hover:underline">{m.usemap_back_to_map()}</a>
  </p>
</main>
