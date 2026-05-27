<script lang="ts">
  import type { PageData } from "./$types";
  import { MODEL_COLORS, MODEL_TEXT_COLORS, MODEL_SHORT, MODEL_SLUG } from "$lib/colors";
  import { STATE_NAMES } from "$lib/states";
  import { localizeHref, getLocale } from "$lib/paraglide/runtime";
  import { m } from "$lib/paraglide/messages.js";
  import AgencySearch from "$lib/components/AgencySearch.svelte";
  import AgencyMap from "$lib/components/AgencyMap.svelte";

  export let data: PageData;

  // Reactive destructure so navigating between agencies via the sticky search
  // (same dynamic route, same component instance) actually refreshes content.
  $: ({ agency, agencies, muckrock } = data);

  $: agencyBySlug = new Map(agencies.map((a) => [a.slug, a]));

  const MUCKROCK_SIGNUP_URL = "https://accounts.muckrock.com/accounts/signup/";

  const statusLabel = (status: string): string => {
    switch (status) {
      case "done": return m.agency_records_status_done();
      case "ack": return m.agency_records_status_ack();
      case "lawsuit": return m.agency_records_status_lawsuit();
      case "processed": return m.agency_records_status_processed();
      default: return m.agency_records_status_unknown();
    }
  };

  const siteUrl = import.meta.env.PUBLIC_SITE_URL ?? "https://287g.recoveredfactory.net";
  $: title = m.agency_meta_title({ agency_name: agency.name });
  $: description = [
    m.agency_meta_description_base({ agency_name: agency.name, state: agency.state }),
    agency.primary_model ? m.agency_meta_description_model({ model: agency.primary_model }) : "",
    agency.population ? m.agency_meta_description_pop({ pop: intFmt.format(agency.population) }) : "",
  ].filter(Boolean).join(" ");
  $: canonicalUrl = `${siteUrl}/agency/${agency.slug}`;

  $: jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "GovernmentOrganization",
        name: agency.name,
        url: canonicalUrl,
        address: {
          "@type": "PostalAddress",
          addressLocality: agency.city,
          addressRegion: agency.state,
          addressCountry: "US",
        },
        ...(agency.lee?.total_pe_ct
          ? { numberOfEmployees: { "@type": "QuantitativeValue", value: agency.lee.total_pe_ct } }
          : {}),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: m.agency_breadcrumb_home(), item: siteUrl + localizeHref("/") },
          { "@type": "ListItem", position: 2, name: agency.name, item: canonicalUrl },
        ],
      },
    ],
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

<!-- Sticky agency search bar -->
<div
  class="sticky z-40 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6"
  style="top: calc(var(--site-header-height) + var(--staging-banner-height));"
>
  <div class="mx-auto max-w-4xl">
    <AgencySearch {agencies} currentSlug={agency.slug} currentAgencyName={agency.name} />
  </div>
</div>

<main id="main-content" class="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
  <!-- Breadcrumb -->
  <nav class="text-sm text-slate-600" aria-label="Breadcrumb">
    <a href={localizeHref("/")} class="no-underline hover:underline">{m.agency_breadcrumb_home()}</a>
    <span class="mx-1.5">›</span>
    <span>{agency.name}</span>
  </nav>

  <!-- Header -->
  <div class="mt-6">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-black leading-tight text-slate-900 sm:text-3xl">
          {agency.name}
        </h1>
        <p class="mt-1 text-base text-slate-600">
          {[agency.agency_type, agency.city, agency.county, agency.state]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <div class="flex flex-wrap gap-1.5">
        {#each agency.models as model}
          <a
            href={localizeHref(`/model/${MODEL_SLUG[model] ?? ''}`)}
            class="rounded px-2.5 py-1 text-sm font-semibold no-underline hover:opacity-85"
            style="background: {MODEL_COLORS[model] ?? '#e2e8f0'}; color: {MODEL_TEXT_COLORS[model] ?? '#0f172a'};"
          >
            {MODEL_SHORT[model] ?? model}
          </a>
        {/each}
      </div>
      <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {#each agency.models as model}
          {#if MODEL_SLUG[model]}
            <a
              href={localizeHref(`/model/${MODEL_SLUG[model]}`)}
              class="text-xs font-semibold no-underline hover:underline"
              style="color: {MODEL_COLORS[model] ?? '#64748b'};"
            >About the {MODEL_SHORT[model] ?? model} agreement →</a>
          {/if}
        {/each}
      </div>
    </div>
  </div>

  <!-- Editorial notes -->
  {#if agency.notes && agency.notes.length > 0}
    <aside class="mt-6 rounded-lg border-l-4 border-amber-400 bg-amber-50 p-4 text-sm text-amber-900">
      <ul class="space-y-2">
        {#each agency.notes as note}
          <li>
            {note.text}
            {#if note.related_slug}
              {@const related = agencyBySlug.get(note.related_slug)}
              {#if related}
                <a
                  href={localizeHref(`/agency/${related.slug}`)}
                  class="ml-1 font-semibold no-underline hover:underline"
                >View {related.name} →</a>
              {/if}
            {/if}
          </li>
        {/each}
      </ul>
    </aside>
  {/if}

  <!-- Location map -->
  <div class="mt-6 h-[260px] overflow-hidden rounded-lg border border-slate-200 shadow-sm sm:h-[320px]">
    {#key agency.slug}
      <AgencyMap
        lat={agency.lat}
        lng={agency.lng}
        state={agency.state}
        primaryModel={agency.primary_model}
        {agencies}
        currentSlug={agency.slug}
      />
    {/key}
  </div>

  <!-- Jurisdiction -->
  {#if agency.city || agency.county || agency.state}
    <div class="mt-6 rounded border border-slate-200 bg-slate-50 px-4 py-3">
      <p class="text-sm font-semibold uppercase tracking-wider text-slate-700">Jurisdiction</p>
      <p class="mt-1 font-semibold text-slate-900">
        {#if agency.city}
          {agency.city}{#if agency.county || agency.state},{/if}
        {/if}
        {#if agency.county && !agency.city}
          {agency.county}{#if agency.state},{/if}
        {/if}
        {#if agency.state}
          {STATE_NAMES[agency.state] ?? agency.state}
        {/if}
        {#if agency.county && agency.city}
          <span class="ml-1 text-sm font-normal text-slate-600">({agency.county} County)</span>
        {/if}
      </p>
      <p class="mt-1 text-xs italic text-slate-500">Coverage may overlap with county, state, or neighboring agencies.</p>
    </div>
  {/if}

  <!-- Key facts -->
  <dl class="mt-8 grid gap-6 border-y border-slate-200 py-8 sm:grid-cols-3">
    {#if agency.signed_date}
      <div>
        <dt class="text-xs font-semibold uppercase tracking-widest text-slate-500">{m.agency_signed_date()}</dt>
        <dd class="mt-1 text-xl font-bold text-slate-900">{dateFmt(agency.signed_date)}</dd>
      </div>
    {/if}
    {#if agency.lee?.population != null}
      <div>
        <dt class="text-xs font-semibold uppercase tracking-widest text-slate-500">{m.agency_population()}</dt>
        <dd class="mt-1 text-xl font-bold text-slate-900">
          {intFmt.format(agency.lee.population)}<span class="ml-1.5 text-xs font-normal text-slate-400">FBI {agency.lee.data_year}</span>
        </dd>
      </div>
    {:else if agency.population != null}
      <div>
        <dt class="text-xs font-semibold uppercase tracking-widest text-slate-500">{m.agency_population()}</dt>
        <dd class="mt-1 text-xl font-bold text-slate-900">{intFmt.format(agency.population)}</dd>
      </div>
    {/if}
    {#if agency.lee?.officer_ct != null}
      <div>
        <dt class="text-xs font-semibold uppercase tracking-widest text-slate-500">{m.agency_officers()}</dt>
        <dd class="mt-1 text-xl font-bold text-slate-900">
          {intFmt.format(agency.lee.officer_ct)}<span class="ml-1.5 text-xs font-normal text-slate-400">FBI {agency.lee.data_year}</span>
        </dd>
      </div>
    {/if}
    {#if agency.lee?.civilian_ct != null}
      <div>
        <dt class="text-xs font-semibold uppercase tracking-widest text-slate-500">{m.agency_civilian_staff()}</dt>
        <dd class="mt-1 text-xl font-bold text-slate-900">
          {intFmt.format(agency.lee.civilian_ct)}<span class="ml-1.5 text-xs font-normal text-slate-400">FBI {agency.lee.data_year}</span>
        </dd>
      </div>
    {/if}
    {#if agency.lee?.total_pe_ct != null}
      <div>
        <dt class="text-xs font-semibold uppercase tracking-widest text-slate-500">{m.agency_total_personnel()}</dt>
        <dd class="mt-1 text-xl font-bold text-slate-900">
          {intFmt.format(agency.lee.total_pe_ct)}<span class="ml-1.5 text-xs font-normal text-slate-400">FBI {agency.lee.data_year}</span>
        </dd>
      </div>
    {/if}
    {#if agency.lee?.pe_ct_per_1000 != null}
      <div>
        <dt class="text-xs font-semibold uppercase tracking-widest text-slate-500">Officers per 1,000</dt>
        <dd class="mt-1 text-xl font-bold text-slate-900">
          {agency.lee.pe_ct_per_1000.toFixed(2)}<span class="ml-1.5 text-xs font-normal text-slate-400">FBI {agency.lee.data_year}</span>
        </dd>
      </div>
    {/if}
    {#if agency.agreement?.population_policed != null}
      <div>
        <dt class="text-xs font-semibold uppercase tracking-widest text-slate-500">{m.agency_population_policed()}</dt>
        <dd class="mt-1 text-xl font-bold text-slate-900">{intFmt.format(agency.agreement.population_policed)}</dd>
        <dd class="mt-0.5 text-xs text-slate-400">{m.agency_source_moa()}</dd>
      </div>
    {/if}
    {#if agency.agreement?.operating_budget != null}
      <div>
        <dt class="text-xs font-semibold uppercase tracking-widest text-slate-500">{m.agency_operating_budget()}</dt>
        <dd class="mt-1 text-xl font-bold text-slate-900">${intFmt.format(agency.agreement.operating_budget)}</dd>
        <dd class="mt-0.5 text-xs text-slate-400">{m.agency_source_moa()}</dd>
      </div>
    {/if}
    {#if agency.moa_url}
      <div>
        <dt class="text-xs font-semibold uppercase tracking-widest text-slate-500">{m.agency_moa_heading()}</dt>
        <dd class="mt-1">
          <a
            href={agency.moa_url}
            target="_blank"
            rel="noreferrer"
            class="text-sm font-semibold no-underline hover:underline"
          >{m.agency_moa_view_pdf()}</a>
        </dd>
      </div>
    {/if}
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

  <!-- Contact -->
  <section class="mt-10">
    <h2 class="font-serif text-xl font-bold text-slate-900">{m.agency_contact_heading()}</h2>
    {#if agency.contact_address || agency.contact_phone || agency.contact_email || agency.contact_website}
      <dl class="mt-4 space-y-3">
        {#if agency.contact_address}
          <div class="flex gap-4">
            <dt class="w-20 shrink-0 pt-0.5 text-xs font-semibold uppercase tracking-wider text-slate-500">{m.agency_contact_address()}</dt>
            <dd class="text-slate-700">{agency.contact_address}</dd>
          </div>
        {/if}
        {#if agency.contact_phone}
          <div class="flex gap-4">
            <dt class="w-20 shrink-0 pt-0.5 text-xs font-semibold uppercase tracking-wider text-slate-500">{m.agency_contact_phone()}</dt>
            <dd><a href="tel:{agency.contact_phone}">{agency.contact_phone}</a></dd>
          </div>
        {/if}
        {#if agency.contact_email}
          <div class="flex gap-4">
            <dt class="w-20 shrink-0 pt-0.5 text-xs font-semibold uppercase tracking-wider text-slate-500">{m.agency_contact_email()}</dt>
            <dd><a href="mailto:{agency.contact_email}">{agency.contact_email}</a></dd>
          </div>
        {/if}
        {#if agency.contact_website}
          <div class="flex gap-4">
            <dt class="w-20 shrink-0 pt-0.5 text-xs font-semibold uppercase tracking-wider text-slate-500">{m.agency_contact_website()}</dt>
            <dd class="min-w-0 break-all"><a href={agency.contact_website} target="_blank" rel="noreferrer">{agency.contact_website}</a></dd>
          </div>
        {/if}
      </dl>
    {:else}
      <p class="mt-3 text-sm italic text-slate-600">{m.agency_contact_none()}</p>
    {/if}
  </section>

  <!-- Data provenance -->
  <p class="mt-6 text-xs text-slate-400">
    {#if agency.snapshot_date}Data last updated {dateFmt(agency.snapshot_date)}.{/if}
    {#if agency.ori} ORI: <span class="font-mono">{agency.ori}</span>.{/if}
  </p>

  <!-- Agreement history -->
  {#if agency.history && agency.history.length > 0}
    <section class="mt-10">
      <h2 class="font-serif text-xl font-bold text-slate-900">Agreement History</h2>
      <p class="mt-1 text-sm text-slate-600">Changes recorded since tracking began. Gaps between entries mean no changes were detected that week.</p>
      <ol class="mt-5 space-y-0 border-l-2 border-slate-200 pl-5">
        {#each [...agency.history].reverse() as event, i}
          {@const isRemoved = event.removed.length > 0 && event.added.length === 0}
          {@const isAdded = event.added.length > 0}
          <li class="relative pb-5 last:pb-0">
            <!-- Timeline dot -->
            <span
              class="absolute -left-[1.4375rem] top-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-white"
              style={`background: ${isRemoved ? '#f87171' : isAdded ? '#4ade80' : '#94a3b8'}; box-shadow: 0 0 0 2px ${isRemoved ? '#fca5a5' : isAdded ? '#86efac' : '#cbd5e1'};`}
            ></span>
            <time class="block text-xs font-semibold uppercase tracking-wider text-slate-500">
              {new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(event.date))}
            </time>
            <ul class="mt-1 space-y-0.5">
              {#each event.added as model}
                <li class="flex items-center gap-1.5 text-sm text-slate-700">
                  <span class="text-green-500 font-bold">+</span>
                  <span>{model}</span>
                </li>
              {/each}
              {#each event.removed as model}
                <li class="flex items-center gap-1.5 text-sm text-slate-500 line-through">
                  <span class="text-red-400 font-bold no-underline" style="text-decoration: none;">−</span>
                  <span>{model}</span>
                </li>
              {/each}
            </ul>
          </li>
        {/each}
      </ol>
    </section>
  {/if}

  <!-- Dive deeper -->
  <section class="mt-10">
    <h2 class="font-serif text-xl font-bold text-slate-900">{m.agency_records_heading()}</h2>
    <p class="mt-2 text-slate-600">{m.agency_records_intro()}</p>

    {#if muckrock.requests.length > 0}
      <div class="mt-5">
        <p class="text-sm font-semibold text-slate-700">{m.agency_records_matched_intro()}</p>
        <ul class="mt-3 space-y-3">
          {#each muckrock.requests as req}
            <li class="overflow-hidden rounded-lg border border-slate-200 shadow-sm">
              <div class="flex items-baseline justify-between gap-4 bg-slate-100 px-4 py-2">
                <p class="font-sans text-xs font-bold uppercase tracking-widest text-slate-700">
                  {req.status === "done" && req.datetime_done
                    ? m.agency_records_completed_on({ date: dateFmt(req.datetime_done) ?? "" })
                    : statusLabel(req.status)}
                </p>
                <p class="text-xs text-slate-500">MuckRock #{req.foia_id}</p>
              </div>
              <div class="bg-white px-4 py-3">
                <a
                  href={req.absolute_url}
                  target="_blank"
                  rel="noreferrer"
                  class="text-sm font-semibold leading-relaxed text-slate-800 no-underline hover:underline"
                >"{req.title}"</a>
                <p class="mt-1.5">
                  <a
                    href={req.absolute_url}
                    target="_blank"
                    rel="noreferrer"
                    class="text-xs font-semibold no-underline hover:underline"
                  >{m.agency_records_view_on_muckrock()}</a>
                </p>
              </div>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <ul class="mt-5 space-y-2 text-sm">
      <li>
        <a
          href={muckrock.reporter_guide.absolute_url}
          target="_blank"
          rel="noreferrer"
          class="font-semibold no-underline hover:underline"
        >{m.agency_records_guide_label()} →</a>
      </li>
      <li>
        <a
          href={MUCKROCK_SIGNUP_URL}
          target="_blank"
          rel="noreferrer"
          class="font-semibold no-underline hover:underline"
        >{m.agency_records_diy_cta()} →</a>
      </li>
    </ul>
  </section>

</main>
