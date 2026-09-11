<script lang="ts">
  import type { ModelPageData } from "./+page.server";
  import { MODEL_COLORS, MODEL_TEXT_COLORS, MODEL_DARK_COLORS, MODEL_SLUG } from "$lib/colors";
  import { localizeHref } from "$lib/paraglide/runtime";
  import { ogImage } from "$lib/ogImage";
  import Gloss from "$lib/components/Gloss.svelte";
  import { termSlug, TERMS_MAP } from "$lib/glossary/terms";
  import {
    PROGRAM_FINDINGS,
    DETAINER_NOTE,
    COMPARISON_ROWS,
    MODEL_RICH_CONTENT,
    PRIMARY_SOURCES,
  } from "$lib/model-content";

  export let data: ModelPageData;

  const { modelName, slug, definition, seeAlso, agencies, snapshotDate, stateCount, allModelCounts } = data;

  const siteUrl = import.meta.env.PUBLIC_SITE_URL ?? "https://287g.recoveredfactory.net";
  const title = `${modelName} — 287(g) Watch`;
  const canonicalUrl = siteUrl + localizeHref(`/model/${slug}`);

  const intFmt = new Intl.NumberFormat();
  const dateFmt = snapshotDate
    ? new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(snapshotDate))
    : null;

  const bgColor = MODEL_COLORS[modelName] ?? "#e2e8f0";
  const textColor = MODEL_TEXT_COLORS[modelName] ?? "#0f172a";
  const darkColor = MODEL_DARK_COLORS[modelName] ?? "#1e293b";

  const content = MODEL_RICH_CONTENT[modelName];

  // Backlink to the glossary entry for this model, if one exists. Seeds the
  // page-wide first-mention tracker with the model's own term so the model
  // name in body copy doesn't dot-underline back to a page the reader is
  // already on.
  const glossaryEntryHref = TERMS_MAP.has(modelName.toLowerCase())
    ? `/glossary#term-${termSlug(modelName)}`
    : null;
  const seen = new Set<string>([modelName.toLowerCase()]);
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={definition} />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={definition} />
  <meta property="og:url" content={canonicalUrl} />
  <meta property="og:image" content={ogImage(`model/${slug}.png`)} />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="twitter:card" content="summary_large_image" />
  <meta property="twitter:image" content={ogImage(`model/${slug}.png`)} />
</svelte:head>

<main id="main-content" class="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">

  <!-- Breadcrumb -->
  <nav class="text-sm text-ink-500" aria-label="Breadcrumb">
    <a href={localizeHref("/")} class="no-underline hover:underline">Home</a>
    <span class="mx-1.5">›</span>
    <span>{modelName}</span>
  </nav>

  <!-- Header -->
  <div class="mt-6">
    <p class="text-xs font-semibold uppercase tracking-widest text-ink-500">287(g) Agreement Type</p>
    <h1 class="mt-1 text-3xl font-black leading-tight sm:text-4xl" style="color: {darkColor};">
      {modelName}
    </h1>
    <p class="mt-1.5 text-sm text-ink-500">
      {intFmt.format(agencies.length)} participating agencies
      {#if dateFmt}<span class="italic">· as of {dateFmt}</span>{/if}
    </p>
    {#if glossaryEntryHref}
      <a
        href={localizeHref(glossaryEntryHref)}
        class="mt-2 inline-block text-xs font-semibold text-ink-500 underline underline-offset-2 hover:text-ink-900"
      >See in glossary →</a>
    {/if}
  </div>

  {#if content}
    <!-- Overview -->
    <section class="mt-8">
      <h2 class="font-serif text-xl font-bold text-ink-900">Overview</h2>
      <div class="mt-3 max-w-2xl space-y-3">
        {#each content.overviewParas as para}
          <p class="leading-relaxed text-ink-700"><Gloss text={para} {seen} /></p>
        {/each}
      </div>

      {#if content.keyDistinction}
        <p class="mt-4 max-w-2xl rounded-lg border border-paper-200 bg-paper-100 px-4 py-3 text-sm leading-relaxed text-ink-700">
          <strong class="font-semibold text-ink-900">Key distinction:</strong> <Gloss text={content.keyDistinction} {seen} />
        </p>
      {/if}

      <div class="mt-5">
        <p class="text-sm font-semibold uppercase tracking-wider text-ink-500">Officers can</p>
        <ul class="mt-2 space-y-1">
          {#each content.officerCan as item}
            <li class="flex items-start gap-2 text-sm text-ink-700">
              <span class="mt-0.5 shrink-0 font-bold" style="color: {bgColor};">→</span>
              <Gloss text={item} {seen} />
            </li>
          {/each}
        </ul>
      </div>
    </section>

    <!-- Training -->
    <section class="mt-8 border-t border-paper-200 pt-8">
      <h2 class="font-serif text-xl font-bold text-ink-900">Training requirements</h2>
      <p class="mt-2 max-w-2xl leading-relaxed text-ink-700"><Gloss text={content.trainingText} {seen} /></p>
    </section>

    <!-- Background (JEM only — includes dynamic "as of" line) -->
    {#if content.backgroundParas}
      <section class="mt-8 border-t border-paper-200 pt-8">
        <h2 class="font-serif text-xl font-bold text-ink-900">Background</h2>
        <div class="mt-3 max-w-2xl space-y-3">
          {#each content.backgroundParas as para}
            <p class="leading-relaxed text-ink-700"><Gloss text={para} {seen} /></p>
          {/each}
          {#if dateFmt}
            <p class="leading-relaxed text-ink-700">
              As of {dateFmt}, {intFmt.format(agencies.length)} agencies in {stateCount} states have signed this type of agreement.
            </p>
          {/if}
        </div>
      </section>
    {/if}

    <!-- Major points -->
    {#if content.majorPoints.length > 0}
      <section class="mt-8 border-t border-paper-200 pt-8">
        <h2 class="font-serif text-xl font-bold text-ink-900">Key findings &amp; history</h2>
        <dl class="mt-4 space-y-5">
          {#each content.majorPoints as point}
            <div>
              <dt class="font-semibold text-ink-900">{point.heading}</dt>
              <dd class="mt-1 max-w-2xl text-sm leading-relaxed text-ink-700">{@html point.body}</dd>
            </div>
          {/each}
        </dl>
      </section>
    {/if}
  {/if}

  <!-- Program-wide oversight findings -->
  <section class="mt-8 border-t border-paper-200 pt-8">
    <h2 class="font-serif text-xl font-bold text-ink-900">Program-wide oversight findings</h2>
    <ul class="mt-4 space-y-4">
      {#each PROGRAM_FINDINGS as finding}
        <li class="flex gap-3">
          <span class="mt-0.5 shrink-0 font-bold" style="color: {bgColor};">▪</span>
          <p class="text-sm leading-relaxed text-ink-700">
            <strong class="font-semibold" style="color: {darkColor};">{finding.source}:</strong>
            {finding.text}
          </p>
        </li>
      {/each}
      <li class="flex gap-3">
        <span class="mt-0.5 shrink-0 font-bold" style="color: {bgColor};">▪</span>
        <p class="text-sm leading-relaxed text-ink-700">
          <strong class="font-semibold" style="color: {darkColor};">Detainer authority (legally contested):</strong>
          {@html DETAINER_NOTE}
        </p>
      </li>
    </ul>
  </section>

  <!-- Comparison table — a real <table> at md: and up (768px comfortably
       clears the table's min-w-[480px]); below that, the same data as one
       card per dimension so nothing forces horizontal scroll. Kept as
       hand-rolled markup rather than routed through the shared
       ResponsiveDataTable component: that component is built for
       record-per-row/field-per-column data (agencies), while this table's
       "records" are the 3 models sitting in *columns* — forcing it through
       the generic column/row contract would mean pivoting the data just to
       fit the abstraction, which is more convoluted than this bespoke
       treatment for a ~6-row static table. -->
  <section class="mt-8 border-t border-paper-200 pt-8">
    <h2 class="font-serif text-xl font-bold text-ink-900">How the three models compare</h2>

    <div class="mt-4 hidden overflow-x-auto rounded-lg border border-paper-200 md:block">
      <table class="w-full min-w-[480px] text-sm">
        <thead>
          <tr class="border-b border-paper-200">
            <th class="px-4 py-3 text-left font-semibold text-ink-500"></th>
            <th class="px-4 py-3 text-left font-semibold"
              style="background: {MODEL_COLORS['Warrant Service Officer']}; color: {MODEL_TEXT_COLORS['Warrant Service Officer']};">WSO</th>
            <th class="px-4 py-3 text-left font-semibold"
              style="background: {MODEL_COLORS['Jail Enforcement Model']}; color: {MODEL_TEXT_COLORS['Jail Enforcement Model']};">JEM</th>
            <th class="px-4 py-3 text-left font-semibold"
              style="background: {MODEL_COLORS['Task Force Model']}; color: {MODEL_TEXT_COLORS['Task Force Model']};">TFM</th>
          </tr>
        </thead>
        <tbody>
          {#each COMPARISON_ROWS as row}
            <tr class="border-b border-paper-100 last:border-0">
              <td class="px-4 py-3 font-medium text-ink-700">{row.label}</td>
              <td class="px-4 py-3 text-ink-700">{row.wso}</td>
              <td class="px-4 py-3 text-ink-700">{row.jem}</td>
              <td class="px-4 py-3 text-ink-700">{row.tfm}</td>
            </tr>
          {/each}
          <tr class="bg-paper-100/50">
            <td class="px-4 py-3 font-medium text-ink-700">
              Agencies
              {#if dateFmt}<span class="block text-xs font-normal text-ink-500">as of {dateFmt}</span>{/if}
            </td>
            <td class="px-4 py-3 font-semibold tabular-nums text-ink-900">{intFmt.format(allModelCounts["Warrant Service Officer"] ?? 0)}</td>
            <td class="px-4 py-3 font-semibold tabular-nums text-ink-900">{intFmt.format(allModelCounts["Jail Enforcement Model"] ?? 0)}</td>
            <td class="px-4 py-3 font-semibold tabular-nums text-ink-900">{intFmt.format(allModelCounts["Task Force Model"] ?? 0)}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <dl class="mt-4 grid gap-3 md:hidden">
      {#each COMPARISON_ROWS as row}
        <div class="rounded-lg border p-4" style="border-color: var(--color-paper-200); background: var(--color-paper-50);">
          <dt class="text-sm font-semibold" style="color: var(--color-ink-900);">{row.label}</dt>
          <dd class="mt-2 space-y-1.5">
            <div class="flex items-start justify-between gap-3 text-sm">
              <span class="shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold"
                style="background: {MODEL_COLORS['Warrant Service Officer']}; color: {MODEL_TEXT_COLORS['Warrant Service Officer']};">WSO</span>
              <span class="text-right text-ink-700">{row.wso}</span>
            </div>
            <div class="flex items-start justify-between gap-3 text-sm">
              <span class="shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold"
                style="background: {MODEL_COLORS['Jail Enforcement Model']}; color: {MODEL_TEXT_COLORS['Jail Enforcement Model']};">JEM</span>
              <span class="text-right text-ink-700">{row.jem}</span>
            </div>
            <div class="flex items-start justify-between gap-3 text-sm">
              <span class="shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold"
                style="background: {MODEL_COLORS['Task Force Model']}; color: {MODEL_TEXT_COLORS['Task Force Model']};">TFM</span>
              <span class="text-right text-ink-700">{row.tfm}</span>
            </div>
          </dd>
        </div>
      {/each}
      <div class="rounded-lg border p-4" style="border-color: var(--color-paper-200); background: var(--color-paper-100);">
        <dt class="text-sm font-semibold" style="color: var(--color-ink-900);">
          Agencies
          {#if dateFmt}<span class="block text-xs font-normal" style="color: var(--color-ink-500);">as of {dateFmt}</span>{/if}
        </dt>
        <dd class="mt-2 space-y-1.5">
          <div class="flex items-center justify-between gap-3 text-sm">
            <span class="shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold"
              style="background: {MODEL_COLORS['Warrant Service Officer']}; color: {MODEL_TEXT_COLORS['Warrant Service Officer']};">WSO</span>
            <span class="font-semibold tabular-nums" style="color: var(--color-ink-900);">{intFmt.format(allModelCounts["Warrant Service Officer"] ?? 0)}</span>
          </div>
          <div class="flex items-center justify-between gap-3 text-sm">
            <span class="shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold"
              style="background: {MODEL_COLORS['Jail Enforcement Model']}; color: {MODEL_TEXT_COLORS['Jail Enforcement Model']};">JEM</span>
            <span class="font-semibold tabular-nums" style="color: var(--color-ink-900);">{intFmt.format(allModelCounts["Jail Enforcement Model"] ?? 0)}</span>
          </div>
          <div class="flex items-center justify-between gap-3 text-sm">
            <span class="shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold"
              style="background: {MODEL_COLORS['Task Force Model']}; color: {MODEL_TEXT_COLORS['Task Force Model']};">TFM</span>
            <span class="font-semibold tabular-nums" style="color: var(--color-ink-900);">{intFmt.format(allModelCounts["Task Force Model"] ?? 0)}</span>
          </div>
        </dd>
      </div>
    </dl>
  </section>

  <!-- See also -->
  {#if seeAlso.length > 0}
    <div class="mt-8 border-t border-paper-200 pt-6">
      <p class="text-sm font-semibold uppercase tracking-wider text-ink-500">See also</p>
      <div class="mt-2 flex flex-wrap gap-2">
        {#each seeAlso as term}
          <a
            href={localizeHref(MODEL_SLUG[term] ? `/model/${MODEL_SLUG[term]}` : `/glossary#term-${term.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`)}
            class="rounded border border-paper-200 bg-paper-50 px-3 py-1 text-xs text-ink-700 no-underline hover:border-ink-500 hover:text-ink-900"
          >{term}</a>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Primary sources -->
  <section class="mt-12 border-t border-paper-200 pt-8">
    <h2 class="font-serif text-xl font-bold text-ink-900">Primary sources</h2>
    <ul class="mt-4 space-y-2">
      {#each PRIMARY_SOURCES as source}
        <li class="text-sm">
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            class="text-ink-700 underline underline-offset-2 hover:text-ink-900"
          >{source.label}</a>
        </li>
      {/each}
    </ul>
  </section>

</main>
