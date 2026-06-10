<script lang="ts">
  import { MODEL_COLORS, MODEL_SHORT } from "$lib/colors";

  export let timeline: {
    date: string; total: number; jail: number; taskforce: number; wso: number;
  }[];

  // When provided, draws a thin national-total line on a secondary right axis
  export let nationalTimeline: { date: string; total: number }[] | undefined = undefined;

  const W = 600, H = 220;
  const PL = 52, PT = 10, PB = 36;
  const IH = H - PT - PB;

  // Right padding widens to fit national axis labels
  $: PR = nationalTimeline ? 50 : 16;
  $: IW = W - PL - PR;

  const Y_STEP = 300;
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  function fmtY(v: number): string {
    if (v < 1000) return String(v);
    return (v / 1000).toFixed(2).replace(/\.?0+$/, "") + "k";
  }

  function fmtShort(d: string): string {
    const [y, mo] = d.split("-");
    return `${MONTHS[+mo - 1]} '${y.slice(2)}`;
  }

  function fmtLong(d: string): string {
    const [y, mo, day] = d.split("-");
    return `${MONTHS[+mo - 1]} ${+day}, ${y}`;
  }

  // Date-based x scale: maps any date string to an x coordinate.
  // Passing iw/tMin/tSpan explicitly so reactive statements can track them.
  function dateX(d: string, iw: number, tMin: number, tSpan: number): number {
    return PL + ((+new Date(d) - tMin) / tSpan) * iw;
  }

  function ly(v: number, yMax: number): number {
    return PT + IH - (v / yMax) * IH;
  }

  function mkLine(
    dates: string[], vals: number[],
    iw: number, tMin: number, tSpan: number, yMax: number,
  ): string {
    return dates
      .map((d, i) => `${i === 0 ? "M" : "L"}${dateX(d, iw, tMin, tSpan).toFixed(1)},${ly(vals[i], yMax).toFixed(1)}`)
      .join(" ");
  }

  function mkArea(
    dates: string[], top: number[], bot: number[],
    iw: number, tMin: number, tSpan: number, yMax: number,
  ): string {
    const pts = dates.map(
      (d, i) => `${i === 0 ? "M" : "L"}${dateX(d, iw, tMin, tSpan).toFixed(1)},${ly(top[i], yMax).toFixed(1)}`
    );
    for (let i = dates.length - 1; i >= 0; i--) {
      pts.push(`L${dateX(dates[i], iw, tMin, tSpan).toFixed(1)},${ly(bot[i], yMax).toFixed(1)}`);
    }
    return pts.join(" ") + " Z";
  }

  $: n = timeline.length;

  // Date range: national covers the full span; state may be a subset
  $: refDates = nationalTimeline?.length ? nationalTimeline.map(d => d.date) : timeline.map(d => d.date);
  $: tMin = refDates.length ? Math.min(...refDates.map(d => +new Date(d))) : 0;
  $: tMax = refDates.length ? Math.max(...refDates.map(d => +new Date(d))) : 1;
  $: tSpan = Math.max(tMax - tMin, 1);

  // Left y-axis (state/national stacked)
  $: stackMax = n ? Math.max(...timeline.map(d => d.wso + d.jail + d.taskforce)) : 0;
  $: yCeil = Math.ceil(Math.max(stackMax, Y_STEP) / Y_STEP) * Y_STEP;
  $: yTicks = Array.from({ length: yCeil / Y_STEP + 1 }, (_, k) => k * Y_STEP);

  // Right y-axis (national total, only when nationalTimeline is provided)
  $: natMax = nationalTimeline?.length ? Math.max(...nationalTimeline.map(d => d.total)) : 0;
  $: natCeil = Math.ceil(Math.max(natMax, Y_STEP) / Y_STEP) * Y_STEP;
  $: natTicks = nationalTimeline ? Array.from({ length: natCeil / Y_STEP + 1 }, (_, k) => k * Y_STEP) : [];

  // Stacked layers (bottom → top: wso, jail, taskforce)
  $: s0 = timeline.map(() => 0);
  $: s1 = timeline.map(d => d.wso);
  $: s2 = timeline.map(d => d.wso + d.jail);
  $: s3 = timeline.map(d => d.wso + d.jail + d.taskforce);
  $: dates = timeline.map(d => d.date);

  $: wsoArea  = n >= 2 ? mkArea(dates, s1, s0, IW, tMin, tSpan, yCeil) : "";
  $: jailArea = n >= 2 ? mkArea(dates, s2, s1, IW, tMin, tSpan, yCeil) : "";
  $: tfArea   = n >= 2 ? mkArea(dates, s3, s2, IW, tMin, tSpan, yCeil) : "";
  $: wsoLine  = n >= 2 ? mkLine(dates, s1, IW, tMin, tSpan, yCeil) : "";
  $: jailLine = n >= 2 ? mkLine(dates, s2, IW, tMin, tSpan, yCeil) : "";
  $: tfLine   = n >= 2 ? mkLine(dates, s3, IW, tMin, tSpan, yCeil) : "";

  // National total line
  $: natLine = nationalTimeline && nationalTimeline.length >= 2
    ? mkLine(nationalTimeline.map(d => d.date), nationalTimeline.map(d => d.total), IW, tMin, tSpan, natCeil)
    : "";

  // X ticks: 5 equally spaced positions across the date range
  $: xTicks = tSpan > 1
    ? [0, 1, 2, 3, 4].map(k => ({
        x: PL + (k / 4) * IW,
        label: fmtShort(new Date(tMin + (k / 4) * tSpan).toISOString().slice(0, 10)),
      }))
    : [];

  // Hover
  let hoverIdx: number | null = null;
  let hoverFrac = 0;

  function readHover(clientX: number, rect: DOMRect): void {
    const svgX = ((clientX - rect.left) / rect.width) * W;
    if (svgX < PL - 8 || svgX > W - PR + 8) { hoverIdx = null; return; }
    const pct = Math.max(0, Math.min(1, (svgX - PL) / IW));
    const targetMs = tMin + pct * tSpan;
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < timeline.length; i++) {
      const dist = Math.abs(+new Date(timeline[i].date) - targetMs);
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
    hoverIdx = best;
    hoverFrac = dateX(timeline[best].date, IW, tMin, tSpan) / W;
  }

  function onMove(e: MouseEvent) {
    readHover(e.clientX, (e.currentTarget as SVGSVGElement).getBoundingClientRect());
  }

  function onLeave() { hoverIdx = null; }

  function onTouch(e: TouchEvent) {
    if (!e.touches.length) { hoverIdx = null; return; }
    readHover(e.touches[0].clientX, (e.currentTarget as SVGSVGElement).getBoundingClientRect());
  }

  // National value at hovered date (nearest national point by date)
  $: natHoverVal = (() => {
    if (hoverIdx === null || !nationalTimeline?.length) return null;
    const targetMs = +new Date(timeline[hoverIdx].date);
    let best = nationalTimeline[0], bestDist = Infinity;
    for (const p of nationalTimeline) {
      const d = Math.abs(+new Date(p.date) - targetMs);
      if (d < bestDist) { bestDist = d; best = p; }
    }
    return best.total;
  })();
</script>

{#if n < 2}
  <p class="text-sm text-slate-400">Not enough data.</p>
{:else}
  <div class="relative">
    <svg
      viewBox="0 0 {W} {H}"
      class="w-full select-none"
      role="img"
      aria-label="Participation trend chart"
      on:mousemove={onMove}
      on:mouseleave={onLeave}
      on:touchmove|preventDefault={onTouch}
      on:touchend={onLeave}
    >
      <!-- Left y-axis gridlines + ticks + labels -->
      {#each yTicks as v}
        {@const y = ly(v, yCeil)}
        <line x1={PL} y1={y} x2={W - PR} y2={y} class="gl" />
        <line x1={PL - 5} y1={y} x2={PL} y2={y} class="tick" />
        <text x={PL - 9} y={y + 4} class="al" text-anchor="end">{fmtY(v)}</text>
      {/each}

      <!-- Right y-axis ticks + labels (national) -->
      {#if nationalTimeline}
        {#each natTicks as v}
          {@const y = ly(v, natCeil)}
          <line x1={W - PR} y1={y} x2={W - PR + 5} y2={y} class="tick" />
          <text x={W - PR + 9} y={y + 4} class="al nat-label" text-anchor="start">{fmtY(v)}</text>
        {/each}
      {/if}

      <!-- Axis spines -->
      <line x1={PL} y1={PT} x2={PL} y2={H - PB} class="spine" />
      <line x1={PL} y1={H - PB} x2={W - PR} y2={H - PB} class="spine" />
      {#if nationalTimeline}
        <line x1={W - PR} y1={PT} x2={W - PR} y2={H - PB} class="spine nat-spine" />
      {/if}

      <!-- X ticks + labels -->
      {#each xTicks as { x, label }, pos}
        <line x1={x} y1={H - PB} x2={x} y2={H - PB + 5} class="tick" />
        <text
          x={x}
          y={H - PB + 17}
          class="al"
          text-anchor={pos === 0 ? "start" : pos === 4 ? "end" : "middle"}
        >{label}</text>
      {/each}

      <!-- Stacked fills -->
      <path d={wsoArea}  fill={MODEL_COLORS["Warrant Service Officer"]} opacity="0.4" />
      <path d={jailArea} fill={MODEL_COLORS["Jail Enforcement Model"]} opacity="0.4" />
      <path d={tfArea}   fill={MODEL_COLORS["Task Force Model"]} opacity="0.4" />

      <!-- Boundary lines -->
      <path d={wsoLine}  fill="none" stroke={MODEL_COLORS["Warrant Service Officer"]} stroke-width="1.5" stroke-linejoin="round" />
      <path d={jailLine} fill="none" stroke={MODEL_COLORS["Jail Enforcement Model"]} stroke-width="1.5" stroke-linejoin="round" />
      <path d={tfLine}   fill="none" stroke={MODEL_COLORS["Task Force Model"]} stroke-width="1.5" stroke-linejoin="round" />

      <!-- National total line -->
      {#if natLine}
        <path d={natLine} class="nat-line" />
      {/if}

      <!-- Hover cursor + dots -->
      {#if hoverIdx !== null}
        {@const hx = dateX(timeline[hoverIdx].date, IW, tMin, tSpan)}
        <line x1={hx} y1={PT} x2={hx} y2={H - PB} class="cursor" />
        <circle cx={hx} cy={ly(s1[hoverIdx], yCeil)} r="3" fill={MODEL_COLORS["Warrant Service Officer"]} />
        <circle cx={hx} cy={ly(s2[hoverIdx], yCeil)} r="3" fill={MODEL_COLORS["Jail Enforcement Model"]} />
        <circle cx={hx} cy={ly(s3[hoverIdx], yCeil)} r="3" fill={MODEL_COLORS["Task Force Model"]} />
        {#if natHoverVal !== null}
          <circle cx={hx} cy={ly(natHoverVal, natCeil)} r="3" fill="#64748b" />
        {/if}
      {/if}
    </svg>

    <!-- Tooltip -->
    {#if hoverIdx !== null}
      {@const d = timeline[hoverIdx]}
      {@const flip = hoverFrac > 0.6}
      <div
        class="tip"
        style={flip
          ? `right: ${((1 - hoverFrac) * 100).toFixed(1)}%; transform: translateX(8px);`
          : `left: ${(hoverFrac * 100).toFixed(1)}%; transform: translateX(-50%);`}
      >
        <p class="tip-date">{fmtLong(d.date)}</p>
        <p class="tip-total">{d.total.toLocaleString()} agencies</p>
        {#if natHoverVal !== null}
          <p class="tip-nat">{natHoverVal.toLocaleString()} nationally</p>
        {/if}
        <ul class="tip-rows">
          {#each [
            { label: MODEL_SHORT["Task Force Model"],        val: d.taskforce, color: MODEL_COLORS["Task Force Model"] },
            { label: MODEL_SHORT["Warrant Service Officer"], val: d.wso,       color: MODEL_COLORS["Warrant Service Officer"] },
            { label: MODEL_SHORT["Jail Enforcement Model"],  val: d.jail,      color: MODEL_COLORS["Jail Enforcement Model"] },
          ] as row}
            <li style="color: {row.color};">
              <span>{row.label}</span>
              <span>{row.val.toLocaleString()}</span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </div>
{/if}

<style>
  .gl    { stroke: #cbd5e1; stroke-width: 1; }
  .spine { stroke: #64748b; stroke-width: 1; }
  .tick  { stroke: #cbd5e1; stroke-width: 1; }
  .al    { font-size: 10px; fill: #475569; font-family: inherit; }

  .nat-spine { stroke-dasharray: 3 3; stroke: #94a3b8; }
  .nat-label { fill: #94a3b8; }
  .nat-line  {
    fill: none;
    stroke: #94a3b8;
    stroke-width: 1.5;
    stroke-dasharray: 4 3;
    stroke-linejoin: round;
  }

  .cursor {
    stroke: #64748b;
    stroke-width: 1;
    stroke-dasharray: 3 3;
    pointer-events: none;
  }

  .tip {
    position: absolute;
    top: 10px;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 10px 12px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
    pointer-events: none;
    min-width: 148px;
    z-index: 10;
  }
  .tip-date  { font-size: 11px; font-weight: 700; color: #0f172a; margin: 0 0 3px; }
  .tip-total { font-size: 11px; color: #64748b; margin: 0 0 2px; }
  .tip-nat   { font-size: 11px; color: #94a3b8; margin: 0 0 6px; }
  .tip-rows  { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
  .tip-rows li { display: flex; justify-content: space-between; gap: 10px; font-size: 11px; font-weight: 500; }
</style>
