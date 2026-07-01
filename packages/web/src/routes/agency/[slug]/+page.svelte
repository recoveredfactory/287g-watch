<script lang="ts">
  import type { PageData } from "./$types";
  import type { Agreement, HistoryEvent } from "$lib/homeData.types";
  import { MODEL_COLORS, MODEL_TEXT_COLORS, MODEL_DARK_COLORS, MODEL_SHORT, MODEL_SLUG } from "$lib/colors";
  import { STATE_NAMES } from "$lib/states";
  import { localizeHref, getLocale } from "$lib/paraglide/runtime";
  import { m } from "$lib/paraglide/messages.js";
  import { ogImage } from "$lib/ogImage";
  import AgencySearch from "$lib/components/AgencySearch.svelte";
  import AgencyMap from "$lib/components/AgencyMap.svelte";
  import Gloss from "$lib/components/Gloss.svelte";

  export let data: PageData;
  const seen = new Set<string>();

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
          ...(agency.state
            ? [{
                "@type": "ListItem", position: 2,
                name: STATE_NAMES[agency.state] ?? agency.state,
                item: siteUrl + localizeHref(`/state/${agency.state.toLowerCase()}`),
              }]
            : []),
          { "@type": "ListItem", position: agency.state ? 3 : 2, name: agency.name, item: canonicalUrl },
        ],
      },
    ],
  });

  const intFmt = new Intl.NumberFormat();
  const dateFmt = (d?: string | null) => {
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

  // Show "First seen in ICE data" only when it actually diverges from the
  // signing date. Since signed_date is now ICE's earliest reported date (#118),
  // the two land within days for most agencies — the tile only earns its space
  // for the cases where they genuinely differ (e.g. long-standing agreements
  // first tracked in 2025). Threshold: more than two weeks apart (empirically
  // chosen). Shared by the key-facts tile and the history "first seen" note so
  // the two can't drift apart.
  const DAY_MS = 86_400_000;
  const FIRST_SEEN_LAG_MS = 14 * DAY_MS;
  $: showFirstSeen =
    !!agency.first_seen_date &&
    (!agency.signed_date ||
      Math.abs(+new Date(agency.first_seen_date) - +new Date(agency.signed_date)) > FIRST_SEEN_LAG_MS);

  // Per-agreement display (#3). An agency can hold several agreements (JEM/TFM/WSO)
  // whose ICE signer / date / public-affairs POC sometimes diverge. We show the
  // grouped "Agreements on file" section when there's more than one agreement, or
  // when the roster lists a model we have no PDF for (partial coverage) — that's
  // when the single-tile view would either hide a divergent POC or imply the
  // archive is complete. A lone, fully-covered agreement still renders "as today".
  $: coverage = agency.agreement_coverage;
  $: isPartial = !!coverage && coverage.onFile < coverage.modelsListed;
  $: showAgreements =
    !!agency.agreements && agency.agreements.length > 0 &&
    (agency.agreements.length > 1 || isPartial);

  // The single-agreement view now renders the same card as the multi view. Prefer
  // the real per-agreement record when we have one; otherwise synthesize an
  // Agreement from the flat primary fields so older/PDF-less agencies still show a
  // card. Null when there's nothing agreement-specific worth carding.
  $: singleAgreement = deriveSingleAgreement(agency);
  function deriveSingleAgreement(a: typeof agency): Agreement | null {
    if (a.agreements && a.agreements.length >= 1) return a.agreements[0];
    const hasContent =
      a.ice_signer_name || a.lea_signer_name || a.ice_field_office ||
      a.moa_poc_name || a.moa_poc_address || a.moa_poc_phone || a.moa_poc_email || a.moa_url;
    if (!hasContent) return null;
    return {
      model: a.primary_model ?? null,
      pdf_url: a.moa_url ?? null,
      date_signed: a.signed_date ?? null,
      date_filename: null,
      ice_signer_name: a.ice_signer_name ?? null,
      ice_signer_title: a.ice_signer_title ?? null,
      ice_field_office: a.ice_field_office ?? null,
      lea_signer_name: a.lea_signer_name ?? null,
      moa_poc_name: a.moa_poc_name ?? null,
      moa_poc_email: a.moa_poc_email ?? null,
      moa_poc_phone: a.moa_poc_phone ?? null,
      moa_poc_address: a.moa_poc_address ?? null,
      addendum_date: null,
      addendum_signer: null,
    };
  }

  // Agreement history, re-keyed on signing dates. ICE's roster snapshots tell us
  // when a model was first *detected* (event.date); the signed MOAs tell us when
  // it was actually *signed*. We show the signing date as the primary date on the
  // timeline — falling back to the detection date when no signed PDF exists.
  //
  // The "first seen in ICE data" note is only worth showing when detection lagged
  // signing past FIRST_SEEN_LAG_MS: ICE publishes 2–3 roster updates a week, so a
  // few days' gap is normal publishing lag, not signal. A longer gap is a real
  // oddity (same threshold as the key-facts tile above).
  type HistoryRow = {
    date: string;          // effective date shown (signed if known, else detected)
    detectionDate: string; // when the model first appeared in ICE's roster
    flagFirstSeen: boolean; // show the "first seen" note (detection lagged >1 week)
    added: string[];
    removed: string[];
  };
  $: signedDatesByModel = buildSignedMap(agency.agreements ?? []);
  function buildSignedMap(ags: Agreement[]): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const a of ags) {
      const d = a.date_signed ?? a.date_filename;
      if (!a.model || !d) continue;
      const list = map.get(a.model);
      if (list) list.push(d);
      else map.set(a.model, [d]);
    }
    for (const list of map.values()) list.sort((x, y) => +new Date(x) - +new Date(y));
    return map;
  }
  // A model can be signed, dropped, and re-signed (e.g. a TFM signed twice). Match
  // an addition detected at `detected` to the most recent signing on or before it
  // — a model can't enter the roster before it's signed — so each appearance keeps
  // its own signing date instead of collapsing to one. Falls back to the earliest.
  function pickSignedDate(dates: string[] | undefined, detected: string): string | null {
    if (!dates || dates.length === 0) return null;
    const dt = +new Date(detected);
    let best: string | null = null;
    for (const d of dates) if (+new Date(d) <= dt) best = d; // sorted asc → last ≤ dt wins
    return best ?? dates[0];
  }
  $: historyRows = buildHistoryRows(agency.history ?? [], signedDatesByModel);
  function buildHistoryRows(history: HistoryEvent[], signed: Map<string, string[]>): HistoryRow[] {
    const rows: HistoryRow[] = [];
    for (const ev of history) {
      // Group this event's added models by their effective (signing) date, so a
      // same-snapshot batch signed on different days splits into separate rows.
      const groups = new Map<string, HistoryRow>();
      for (const model of ev.added) {
        const s = pickSignedDate(signed.get(model), ev.date);
        const date = s ?? ev.date;
        const key = `${date}|${s ? "s" : "d"}`;
        let g = groups.get(key);
        if (!g) {
          const lag = +new Date(ev.date) - +new Date(date);
          g = { date, detectionDate: ev.date, flagFirstSeen: !!s && lag > FIRST_SEEN_LAG_MS, added: [], removed: [] };
          groups.set(key, g);
        }
        g.added.push(model);
      }
      rows.push(...groups.values());
      if (ev.removed.length > 0) {
        rows.push({ date: ev.date, detectionDate: ev.date, flagFirstSeen: false, added: [], removed: ev.removed });
      }
    }
    rows.sort((a, b) => +new Date(a.date) - +new Date(b.date));
    return rows;
  }
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  <link rel="canonical" href={canonicalUrl} />
  <meta property="og:type" content="article" />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:url" content={canonicalUrl} />
  <meta property="og:image" content={ogImage(`agency/${agency.slug}.png`)} />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="twitter:card" content="summary_large_image" />
  <meta property="twitter:title" content={title} />
  <meta property="twitter:description" content={description} />
  <meta property="twitter:image" content={ogImage(`agency/${agency.slug}.png`)} />
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
    {#if agency.state}
      <span class="mx-1.5">›</span>
      <a href={localizeHref(`/state/${agency.state.toLowerCase()}`)} class="no-underline hover:underline">{STATE_NAMES[agency.state] ?? agency.state}</a>
    {/if}
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
          {[agency.agency_type, agency.city, agency.county].filter(Boolean).join(" · ")}
          {#if agency.state}
            {#if agency.agency_type || agency.city || agency.county}<span class="mx-1">·</span>{/if}<a
              href={localizeHref(`/state/${agency.state.toLowerCase()}`)}
              class="text-slate-600 no-underline hover:underline"
            >{agency.state}</a>
          {/if}
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
          <a
            href={localizeHref(`/state/${agency.state.toLowerCase()}`)}
            class="text-slate-900 no-underline hover:underline"
          >{STATE_NAMES[agency.state] ?? agency.state}</a>
        {/if}
        {#if agency.county && agency.city}
          <span class="ml-1 text-sm font-normal text-slate-600">({agency.county} County)</span>
        {/if}
      </p>
      <p class="mt-1 text-xs italic text-slate-500">Coverage may overlap with county, state, or neighboring agencies.</p>
    </div>
  {/if}

  <!-- Ended notice (terminated agencies) -->
  {#if agency.terminated_date}
    <div class="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
      <p class="text-sm font-bold uppercase tracking-wide text-amber-900">{m.agency_ended_heading()}</p>
      <p class="mt-1 text-sm text-amber-800">
        {m.agency_ended_body({ agency_name: agency.name, date: dateFmt(agency.terminated_date) ?? "" })}
      </p>
    </div>
  {/if}

  <!-- One agreement, rendered identically for the single- and multi-agreement
       views. Three labeled blocks — the agency signatory, the ICE signatory (+
       field office), and the public-affairs contact — each collapsing when its
       data is missing. -->
  {#snippet agreementCard(ag: Agreement)}
    {@const agDate = dateFmt(ag.date_signed ?? ag.date_filename)}
    <article class="rounded-xl border border-slate-200 bg-slate-50 p-5 sm:p-6">
      <!-- Model + signed date, with a link straight to the agreement PDF. -->
      <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h3
            class="font-serif text-lg font-bold leading-tight"
            style="color: {MODEL_DARK_COLORS[ag.model ?? ''] ?? '#0f172a'};"
          >{MODEL_SHORT[ag.model ?? ''] ?? ag.model ?? m.agency_agreements_other_model()}</h3>
          {#if agDate}
            <p class="mt-0.5 text-sm text-slate-500">{m.agency_agreements_signed({ date: agDate })}</p>
          {/if}
        </div>
        {#if ag.pdf_url}
          <a
            href={ag.pdf_url}
            target="_blank"
            rel="noreferrer"
            class="shrink-0 text-sm font-semibold text-slate-500 no-underline hover:text-slate-800 hover:underline"
          >{m.agency_moa_view_pdf()}</a>
        {/if}
      </div>

      <!-- Signed by (agency): the local-agency signatory -->
      {#if ag.lea_signer_name}
        <div class="mt-4 border-t border-slate-200 pt-4">
          <p class="text-sm font-semibold text-slate-800">{m.agency_signed_by_party({ party: agency.name })}</p>
          <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt class="whitespace-nowrap text-slate-500">{m.agency_contact_name()}</dt>
            <dd class="min-w-0 font-medium text-slate-900">{ag.lea_signer_name}</dd>
          </dl>
        </div>
      {/if}

      <!-- Signed by (ICE): the ICE signatory + the field office they signed for -->
      {#if ag.ice_signer_name || ag.ice_field_office}
        <div class="mt-4 border-t border-slate-200 pt-4">
          <p class="text-sm font-semibold text-slate-800">{m.agency_signed_by_party({ party: "ICE" })}</p>
          <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            {#if ag.ice_signer_name}
              <dt class="whitespace-nowrap text-slate-500">{m.agency_contact_name()}</dt>
              <dd class="min-w-0">
                <span class="font-medium text-slate-900">{ag.ice_signer_name}</span>
                {#if ag.ice_signer_title}<span class="block text-slate-500">{ag.ice_signer_title}</span>{/if}
              </dd>
            {/if}
            {#if ag.ice_field_office}
              <dt class="whitespace-nowrap text-slate-500">{m.agency_field_office()}</dt>
              <dd class="min-w-0 text-slate-700">{ag.ice_field_office}</dd>
            {/if}
          </dl>
        </div>
      {/if}

      <!-- Public-affairs contact: named in the MOA, distinct from the signatory -->
      {#if ag.moa_poc_name || ag.moa_poc_address || ag.moa_poc_phone || ag.moa_poc_email}
        <div class="mt-4 border-t border-slate-200 pt-4">
          <p class="text-sm font-semibold text-slate-800">{m.agency_agreements_pa_contact()}</p>
          <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            {#if ag.moa_poc_name}
              <dt class="whitespace-nowrap text-slate-500">{m.agency_contact_name()}</dt>
              <dd class="min-w-0 font-medium text-slate-900">{ag.moa_poc_name}</dd>
            {/if}
            {#if ag.moa_poc_address}
              <dt class="whitespace-nowrap text-slate-500">{m.agency_contact_address()}</dt>
              <dd class="min-w-0 text-slate-700">{ag.moa_poc_address}</dd>
            {/if}
            {#if ag.moa_poc_phone}
              <dt class="whitespace-nowrap text-slate-500">{m.agency_contact_phone()}</dt>
              <dd class="min-w-0"><a href="tel:{ag.moa_poc_phone}" class="text-slate-700 hover:underline">{ag.moa_poc_phone}</a></dd>
            {/if}
            {#if ag.moa_poc_email}
              <dt class="whitespace-nowrap text-slate-500">{m.agency_contact_email()}</dt>
              <dd class="min-w-0"><a href="mailto:{ag.moa_poc_email}" class="break-words text-slate-700 hover:underline">{ag.moa_poc_email}</a></dd>
            {/if}
          </dl>
        </div>
      {/if}
    </article>
  {/snippet}

  <!-- Key facts -->
  <dl class="mt-8 grid gap-6 border-y border-slate-200 py-8 sm:grid-cols-3">
    {#if agency.signed_date}
      <div>
        <dt class="text-xs font-semibold uppercase tracking-widest text-slate-500">{m.agency_signed_date()}</dt>
        <dd class="mt-1 text-xl font-bold text-slate-900">{dateFmt(agency.signed_date)}</dd>
      </div>
    {/if}
    {#if showFirstSeen}
      <div>
        <dt class="text-xs font-semibold uppercase tracking-widest text-slate-500">{m.agency_first_seen()}</dt>
        <dd class="mt-1 text-xl font-bold text-slate-900">{dateFmt(agency.first_seen_date)}</dd>
      </div>
    {/if}
    <!-- ICE field office / signer / public-affairs contact now live in the
         agreement card below (single- and multi-agreement views alike). -->
    {#if agency.lee?.population != null}
      <div>
        <dt class="text-xs font-semibold uppercase tracking-widest text-slate-500">{m.agency_population()}</dt>
        <dd class="mt-1 text-xl font-bold text-slate-900">
          {intFmt.format(agency.lee.population)}<a href="https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/downloads" target="_blank" rel="noreferrer" title="FBI Law Enforcement Employees data, {agency.lee.data_year}" class="ml-1.5 text-xs font-normal text-slate-400 no-underline hover:text-slate-600 hover:underline">FBI {agency.lee.data_year}</a>
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
          {intFmt.format(agency.lee.officer_ct)}<a href="https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/downloads" target="_blank" rel="noreferrer" title="FBI Law Enforcement Employees data, {agency.lee.data_year}" class="ml-1.5 text-xs font-normal text-slate-400 no-underline hover:text-slate-600 hover:underline">FBI {agency.lee.data_year}</a>
        </dd>
      </div>
    {/if}
    {#if agency.lee?.civilian_ct != null}
      <div>
        <dt class="text-xs font-semibold uppercase tracking-widest text-slate-500">{m.agency_civilian_staff()}</dt>
        <dd class="mt-1 text-xl font-bold text-slate-900">
          {intFmt.format(agency.lee.civilian_ct)}<a href="https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/downloads" target="_blank" rel="noreferrer" title="FBI Law Enforcement Employees data, {agency.lee.data_year}" class="ml-1.5 text-xs font-normal text-slate-400 no-underline hover:text-slate-600 hover:underline">FBI {agency.lee.data_year}</a>
        </dd>
      </div>
    {/if}
    {#if agency.lee?.total_pe_ct != null}
      <div>
        <dt class="text-xs font-semibold uppercase tracking-widest text-slate-500">{m.agency_total_personnel()}</dt>
        <dd class="mt-1 text-xl font-bold text-slate-900">
          {intFmt.format(agency.lee.total_pe_ct)}<a href="https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/downloads" target="_blank" rel="noreferrer" title="FBI Law Enforcement Employees data, {agency.lee.data_year}" class="ml-1.5 text-xs font-normal text-slate-400 no-underline hover:text-slate-600 hover:underline">FBI {agency.lee.data_year}</a>
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

  <!-- Agreement intro (multi-agreement view only: it sits above the per-model
       cards. The single-agreement view renders its own heading + card below). -->
  {#if showAgreements && agency.moa_url}
    <section class="mt-10">
      <h2 class="font-serif text-xl font-bold text-slate-900">{m.agency_moa_heading()}</h2>
      <p class="mt-2 text-slate-600">
        <Gloss text={m.agency_moa_body({ agency_name: agency.name })} {seen} />
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

  <!-- Single-agreement view: the same card the multi-agreement view uses, under
       the MOA heading. The signatory / ICE / public-affairs contact that used to
       be scattered across key-facts tiles + a separate section now live here. -->
  {#if !showAgreements && singleAgreement}
    <section class="mt-10">
      <h2 class="font-serif text-xl font-bold text-slate-900">{m.agency_moa_heading()}</h2>
      {#if agency.moa_url}
        <p class="mt-2 text-slate-600">
          <Gloss text={m.agency_moa_body({ agency_name: agency.name })} {seen} />
        </p>
      {/if}
      <div class="mt-5">
        {@render agreementCard(singleAgreement)}
      </div>
      <p class="mt-3 text-xs italic text-slate-400">{m.agency_pa_contact_note()}</p>
    </section>
  {/if}

  <!-- Agreements on file (#3): one block per model-agreement (JEM/TFM/WSO). Their
       ICE signer / date / public-affairs POC sometimes diverge, so each is shown
       and attributed separately. Framed as "on file" — the archive is incomplete. -->
  {#if showAgreements && agency.agreements}
    <section class="mt-10">
      <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 class="font-serif text-xl font-bold text-slate-900">{m.agency_agreements_heading()}</h2>
        {#if coverage && coverage.modelsListed > 1}
          <p class="text-xs font-semibold uppercase tracking-wider {isPartial ? 'text-amber-700' : 'text-slate-500'}">
            {m.agency_agreements_coverage({ onFile: coverage.onFile, total: coverage.modelsListed })}
          </p>
        {/if}
      </div>
      <p class="mt-1 text-sm text-slate-500">{m.agency_agreements_caption()}</p>

      <div class="mt-5 space-y-4">
        {#each agency.agreements as ag}
          {@render agreementCard(ag)}
        {/each}
      </div>
      <p class="mt-3 text-xs italic text-slate-400">{m.agency_pa_contact_note()}</p>
    </section>
  {/if}

  <!-- Contact (the agency's own public contact info, sourced separately) -->
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

  <!-- Agreement history (restored in #118 Phase B-min, now on rename-resolved data).
       Re-keyed on signing dates; the detection date rides along as a "first seen" note. -->
  {#if historyRows.length > 0}
    <section class="mt-10">
      <h2 class="font-serif text-xl font-bold text-slate-900">{m.agency_history_heading()}</h2>
      <p class="mt-1 text-sm text-slate-600">{m.agency_history_intro()}</p>
      <ol class="mt-5 space-y-0 border-l-2 border-slate-200 pl-5">
        {#each [...historyRows].reverse() as event}
          {@const isRemoved = event.removed.length > 0 && event.added.length === 0}
          {@const isAdded = event.added.length > 0}
          <li class="relative pb-5 last:pb-0">
            <!-- Timeline dot -->
            <span
              class="absolute -left-[1.8125rem] top-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-white"
              style={`background: ${isRemoved ? '#f87171' : isAdded ? '#4ade80' : '#94a3b8'}; box-shadow: 0 0 0 2px ${isRemoved ? '#fca5a5' : isAdded ? '#86efac' : '#cbd5e1'};`}
            ></span>
            <time class="block text-xs font-semibold uppercase tracking-wider text-slate-500">
              {dateFmt(event.date)}
            </time>
            {#if event.flagFirstSeen}
              <p class="mt-0.5 text-xs text-slate-400">{m.agency_first_seen()} · {dateFmt(event.detectionDate)}</p>
            {/if}
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

  <!-- Data provenance -->
  <p class="mt-6 text-xs text-slate-400">
    {#if agency.snapshot_date}Data last updated {dateFmt(agency.snapshot_date)}.{/if}
    {#if agency.ori} ORI: <span class="font-mono">{agency.ori}</span>.{/if}
  </p>

  <!-- Dive deeper -->
  <section class="mt-10">
    <h2 class="font-serif text-xl font-bold text-slate-900">{m.agency_records_heading()}</h2>
    <p class="mt-2 text-slate-600"><Gloss text={m.agency_records_intro()} {seen} /></p>

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
