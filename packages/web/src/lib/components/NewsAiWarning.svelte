<script lang="ts">
  // Small, always-on caution that rides above the AI-written news summaries — at
  // the top of the state index and above each state page's summary. The parent
  // owns spacing/width (wrap in a `max-w-prose`/`mt-*` div); this is just the
  // amber note + a link to the methodology write-up.
  import { localizeHref } from "$lib/paraglide/runtime";
  import { m } from "$lib/paraglide/messages.js";
</script>

<aside
  class="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800"
>
  <span class="shrink-0" aria-hidden="true">⚠</span>
  <p>
    {m.news_ai_warning()}
    <a
      href={localizeHref("/methodology#ai")}
      class="font-semibold underline decoration-amber-400 underline-offset-2 hover:decoration-amber-700"
    >{m.news_ai_warning_link()}</a>
  </p>
</aside>
