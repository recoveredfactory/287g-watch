<script lang="ts">
  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import { getLocale } from "$lib/paraglide/runtime";
  import { m } from "$lib/paraglide/messages.js";

  // A/B test (#93): random pick per page-view, equal weight. SSR renders the
  // 'email' variant deterministically; onMount may swap to 'support' before
  // firing the impression event, so half the time the button href/target
  // updates after hydration.
  const VARIANTS = ["email", "support"] as const;
  type Variant = (typeof VARIANTS)[number];

  let variant: Variant = "email";

  $: href =
    variant === "email"
      ? "mailto:davideads@recoveredfactory.net"
      : `https://recoveredfactory.net/${getLocale()}/support`;

  function track(event: string) {
    if (!browser) return;
    const w = window as unknown as { umami?: { track?: (e: string) => void } };
    w.umami?.track?.(event);
  }

  onMount(() => {
    variant = VARIANTS[Math.floor(Math.random() * VARIANTS.length)];
    track(`conversion_impression_${variant}`);
  });

  function onClick() {
    track(`conversion_click_${variant}`);
  }
</script>

<section class="border-b border-slate-200 bg-gray-100 px-4 py-5 sm:px-6">
  <div
    class="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
  >
    <p class="text-sm text-slate-700">
      {m.home_support_prefix()}
      <a
        href="https://vsr.recoveredfactory.net/en"
        target="_blank"
        rel="noreferrer"
        class="font-semibold text-slate-900">Recovered Factory</a
      >{m.home_support_suffix()}
    </p>
    <a
      {href}
      target={variant === "email" ? "_self" : "_blank"}
      rel={variant === "email" ? null : "noreferrer"}
      on:click={onClick}
      data-variant={variant}
      class="self-start rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 no-underline hover:border-slate-400 hover:text-slate-900 hover:no-underline sm:shrink-0 sm:self-auto"
    >
      {m.home_support_hire_us()}
    </a>
  </div>
</section>
