<script lang="ts">
  // Small, always-on caution that rides above the AI-written news summaries — at
  // the top of the state index and above each state page's summary. The parent
  // owns spacing/width (wrap in a `max-w-prose`/`mt-*` div); this is just the
  // note + a link to the methodology write-up.
  import { localizeHref } from "$lib/paraglide/runtime";
  import { m } from "$lib/paraglide/messages.js";
</script>

<aside class="text-xs leading-relaxed text-ink-500">
  <p>
    {m.news_ai_written_by()}
    <a
      href="https://promptql.io"
      target="_blank"
      rel="noopener noreferrer"
      class="underline decoration-paper-200 underline-offset-2 hover:text-ink-900"
    >{m.news_ai_promptql()}</a>.
    {m.news_ai_warning()}
    <a
      href={localizeHref("/about#ai")}
      class="whitespace-nowrap underline decoration-paper-200 underline-offset-2 hover:text-ink-900"
    >{m.news_ai_warning_link()}&nbsp;<span aria-hidden="true">→</span></a>
  </p>
</aside>
