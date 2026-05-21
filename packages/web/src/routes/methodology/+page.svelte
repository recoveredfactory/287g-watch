<script lang="ts">
  const title = "Methodology — Tracking 287(g)";
  const description = "Data sources, limitations, and methods used in this project.";
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
</svelte:head>

<main id="main-content" class="mx-auto max-w-3xl px-4 py-12 sm:px-6">
  <h1 class="text-3xl font-black text-slate-900 sm:text-4xl">Methodology</h1>

  <div class="prose-editorial mt-8">
    <h2 class="font-serif text-2xl font-bold text-slate-900">Data sources</h2>

    <p>Agency data is compiled from the following sources:</p>

    <ul>
      <li>
        <strong>ICE 287(g) participants list</strong> — the current official list of participating agencies
        published at ice.gov. Scraped and archived regularly.
      </li>
      <li>
        <strong><a href="https://github.com/appelson/Tracking_287g" target="_blank" rel="noreferrer">
          appelson/Tracking_287g
        </a></strong> — a community archiving effort that maintains historical ICE spreadsheets and
        individual MOA PDFs going back to 2016.
      </li>
      <li>
        <strong>FBI Census of State and Local Law Enforcement Agencies (CSLLEA) 2018</strong> —
        population served, budget, officer counts, and contact information.
      </li>
    </ul>

    <h2 class="mt-10 font-serif text-2xl font-bold text-slate-900">Matching agencies</h2>

    <p>
      Agency names vary across sources. We normalize names and use fuzzy string matching to link
      records across datasets, then hand-review ambiguous matches. Each agency in our index
      includes a confidence score for its cross-source matches.
    </p>

    <h2 class="mt-10 font-serif text-2xl font-bold text-slate-900">Limitations</h2>

    <ul>
      <li>
        Population data is from 2018 CSLLEA and has not been updated. It reflects jurisdiction
        size, not the population directly affected by 287(g) enforcement.
      </li>
      <li>
        Some agencies have had agreements lapse and rejoin. Historical participation dates may
        be incomplete.
      </li>
      <li>
        MOA PDFs are not available for all agencies. We link to the appelson archive where
        available.
      </li>
    </ul>

    <h2 class="mt-10 font-serif text-2xl font-bold text-slate-900">Updates</h2>

    <p>
      The pipeline is re-run regularly to capture new ICE announcements.
      The data snapshot date is shown on each page.
    </p>
  </div>
</main>
