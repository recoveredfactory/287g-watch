<script lang="ts">
  import { localizeHref } from "$lib/paraglide/runtime";
  const title = "About — Tracking 287(g)";
  const description = "About this project and how to get involved.";
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
</svelte:head>

<main id="main-content" class="mx-auto max-w-3xl px-4 py-12 sm:px-6">
  <h1 class="text-3xl font-black text-slate-900 sm:text-4xl">About this project</h1>

  <div class="prose-editorial mt-8">
    <p>
      <strong>Tracking 287(g)</strong> is a public interest journalism project documenting local law
      enforcement agencies that have partnered with U.S. Immigration and Customs Enforcement under
      Section 287(g) of the Immigration and Nationality Act.
    </p>

    <p>
      The 287(g) program allows ICE to delegate immigration enforcement authority to state and local
      agencies through a formal Memorandum of Agreement. Officers at participating agencies can be
      trained and authorized to perform immigration enforcement functions — including identifying,
      processing, and detaining people for removal.
    </p>

    <h2 class="mt-10 font-serif text-2xl font-bold text-slate-900">Why this matters</h2>

    <p>
      There is no single, up-to-date, machine-readable public database of 287(g) agreements. ICE
      publishes a list of current participants, but it lacks historical data, contact information,
      agreement terms, and the context needed for accountability journalism and community
      organizing.
    </p>

    <p>
      We built this tool to fill that gap — and to make the data as findable as possible, so that
      people can look up their own local agencies.
    </p>

    <h2 class="mt-10 font-serif text-2xl font-bold text-slate-900">Get involved</h2>

    <p>
      Know something about an agency? Have records? See an error? We want to hear from you.
    </p>

    <ul class="mt-4 space-y-2">
      <li>
        Submit corrections or tips via
        <a href="https://www.muckrock.com/" target="_blank" rel="noreferrer">MuckRock</a>
      </li>
      <li>
        File public records requests to surface local data
      </li>
      <li>
        See <a href={localizeHref("/methodology")}>our methodology</a> for data sources and limitations
      </li>
    </ul>
  </div>
</main>
