<script lang="ts">
  import { localizeHref, getLocale } from "$lib/paraglide/runtime";
  import { m } from "$lib/paraglide/messages.js";
  import { env } from "$env/dynamic/public";
  import type { PageData } from "./$types";

  export let data: PageData;

  // Downloadable assets come from the public archive bucket's `-latest-<lang>`
  // copies when configured (PUBLIC_MAP_ASSETS_URL, set by SST), else the bundled
  // /video/ fallback for local dev. The video text is baked per language, so we
  // offer both cuts on every page. See scripts/publish-map-assets.mjs (#118).
  const assetBase = env.PUBLIC_MAP_ASSETS_URL;
  const asset = (ext: string, lang: string) =>
    assetBase ? `${assetBase}/map-latest-${lang}.${ext}` : `/video/map-${lang}.${ext}`;

  // Preview the cut in the page's own language; offer both as downloads.
  const previewLang = getLocale();
  const DOWNLOAD_LANGS = [
    { lang: "en", label: "English" },
    { lang: "es", label: "Español" },
  ];
  const FORMATS = [
    { ext: "mp4", label: () => m.usemap_download_mp4() },
    { ext: "gif", label: () => m.usemap_download_gif() },
    { ext: "png", label: () => m.usemap_download_image() },
  ];

  $: title = m.usemap_meta_title();
  $: description = m.usemap_meta_description();
  const siteUrl = import.meta.env.PUBLIC_SITE_URL ?? "https://287g.recoveredfactory.net";

  const LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/";
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
      src={asset("mp4", previewLang)}
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
    <div class="mt-4 space-y-4">
      {#each DOWNLOAD_LANGS as { lang, label }}
        <div>
          <p class="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
          <div class="mt-2 flex flex-wrap gap-3">
            {#each FORMATS as fmt}
              <a
                href={asset(fmt.ext, lang)}
                download
                class={fmt.ext === "mp4"
                  ? "inline-flex items-center gap-2 rounded bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                  : "inline-flex items-center gap-2 rounded border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 hover:border-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"}
              >
                {fmt.label()}
              </a>
            {/each}
          </div>
        </div>
      {/each}
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
    <p class="mt-3">{m.usemap_license_ask()}</p>

    <h2 class="mt-8 font-serif text-xl font-bold text-slate-900 sm:mt-10 sm:text-2xl">{m.usemap_custom_heading()}</h2>
    <p class="mt-3">
      {m.usemap_custom_body_prefix()}
      <a href="mailto:{LICENSE_EMAIL}">{m.usemap_custom_link()}</a>
      {m.usemap_custom_body_suffix()}
    </p>
  </div>

  <p class="mt-10">
    <a href={localizeHref("/")} class="text-sm font-semibold text-slate-900 hover:underline">{m.usemap_back_to_map()}</a>
  </p>
</main>
