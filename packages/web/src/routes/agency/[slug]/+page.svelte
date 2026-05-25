<script lang="ts">
  import type { PageData } from "./$types";
  import { MODEL_COLORS, MODEL_TEXT_COLORS, MODEL_SHORT } from "$lib/colors";
  import { localizeHref, getLocale } from "$lib/paraglide/runtime";
  import { m } from "$lib/paraglide/messages.js";

  export let data: PageData;

  const { agency } = data;

  const siteUrl = import.meta.env.PUBLIC_SITE_URL ?? "https://tracking287g.com";
  $: title = m.agency_meta_title({ agency_name: agency.name });
  $: description = [
    m.agency_meta_description_base({ agency_name: agency.name, state: agency.state }),
    agency.primary_model ? m.agency_meta_description_model({ model: agency.primary_model }) : "",
    agency.population ? m.agency_meta_description_pop({ pop: intFmt.format(agency.population) }) : "",
  ].filter(Boolean).join(" ");
  $: canonicalUrl = `${siteUrl}/agency/${agency.slug}`;

  $: jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "GovernmentOrganization",
    name: agency.name,
    url: canonicalUrl,
    address: {
      "@type": "PostalAddress",
      addressLocality: agency.city,
      addressRegion: agency.state,
      addressCountry: "US",
    },
    ...(agency.population
      ? { numberOfEmployees: { "@type": "QuantitativeValue", value: agency.population } }
      : {}),
  });

  const intFmt = new Intl.NumberFormat();
  const dateFmt = (d?: string) => {
    if (!d) return null;
    try {
      const localeTag = getLocale() === "es" ? "es-MX" : "en-US";
      return new Intl.DateTimeFormat(localeTag, {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      }).format(new Date(d));
    } catch {
      return d;
    }
  };
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  <link rel="canonical" href={canonicalUrl} />
  <meta property="og:type" content="article" />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:url" content={canonicalUrl} />
  <meta property="twitter:card" content="summary" />
  <meta property="twitter:title" content={title} />
  <meta property="twitter:description" content={description} />
  {@html `<script type="application/ld+json">${jsonLd}</script>`}
</svelte:head>

<main id="main-content" class="mx-auto max-w-4xl px-4 py-12 sm:px-6">
  <!-- Breadcrumb -->
  <nav class="text-sm text-slate-500" aria-label="Breadcrumb">
    <a href={localizeHref("/")} class="no-underline hover:underline">{m.agency_breadcrumb_home()}</a>
    <span class="mx-1.5">›</span>
    <span>{agency.name}</span>
  </nav>

  <!-- Header -->
  <div class="mt-6">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-3xl font-black leading-tight text-slate-900 sm:text-4xl">
          {agency.name}
        </h1>
        <p class="mt-1 text-base text-slate-500">
          {[agency.agency_type, agency.city, agency.county, agency.state]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <div class="flex flex-wrap gap-1.5">
        {#each agency.models as model}
          <span
            class="rounded px-2.5 py-1 text-sm font-semibold"
            style="background: {MODEL_COLORS[model] ?? '#e2e8f0'}; color: {MODEL_TEXT_COLORS[model] ?? '#0f172a'};"
          >
            {MODEL_SHORT[model] ?? model}
          </span>
        {/each}
      </div>
    </div>
  </div>

  <!-- Key facts -->
  <dl class="mt-8 grid gap-4 border-y border-slate-200 py-8 sm:grid-cols-3">
    {#if agency.signed_date}
      <div>
        <dt class="text-xs font-semibold uppercase tracking-wider text-slate-400">{m.agency_signed_date()}</dt>
        <dd class="mt-1 font-semibold text-slate-900">{dateFmt(agency.signed_date)}</dd>
      </div>
    {/if}
    {#if agency.population}
      <div>
        <dt class="text-xs font-semibold uppercase tracking-wider text-slate-400">{m.agency_population()}</dt>
        <dd class="mt-1 font-semibold text-slate-900">{intFmt.format(agency.population)}</dd>
      </div>
    {/if}
    <div>
      <dt class="text-xs font-semibold uppercase tracking-wider text-slate-400">{m.agency_program_models()}</dt>
      <dd class="mt-1 font-semibold text-slate-900">{agency.models.join(", ") || "—"}</dd>
    </div>
  </dl>

  <!-- Agreement -->
  {#if agency.moa_url}
    <section class="mt-10">
      <h2 class="font-serif text-xl font-bold text-slate-900">{m.agency_moa_heading()}</h2>
      <p class="mt-2 text-slate-600">
        {m.agency_moa_body({ agency_name: agency.name })}
      </p>
      <a
        href={agency.moa_url}
        target="_blank"
        rel="noreferrer"
        class="mt-3 inline-block rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 no-underline hover:bg-slate-50"
      >
        {m.agency_moa_view_pdf()}
      </a>
    </section>
  {/if}

</main>
