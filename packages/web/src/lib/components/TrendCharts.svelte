<script lang="ts">
  import { MODEL_COLORS, MODEL_SHORT } from "$lib/colors";

  export let timeline: {
    date: string; total: number; jail: number; taskforce: number; wso: number;
  }[];

  const W = 600, H = 220;
  const PL = 52, PR = 16, PT = 10, PB = 36;
  const IH = H - PT - PB;
  const IW = W - PL - PR;
  const Y_STEP = 100;
  const START_DATE = "2024-12-01";
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  function fmtY(v: number): string {
    if (v < 1000) return String(v);
    return (v / 1000).toFixed(1).replace(/\.?0+$/, "") + "k";
  }

  function fmtShort(d: string): string {
    const [y, mo] = d.split("-");
    return `${MONTHS[+mo - 1]} '${y.slice(2)}`;
  }

  function fmtLong(d: string): string {
    const [y, mo, day] = d.split("-");
    return `${MONTHS[+mo - 1]} ${+day}, ${y}`;
  }

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

  $: display = timeline.filter(p => p.date >= START_DATE);
  $: n = display.length;

  $: tMin = n ? Math.min(...display.map(d => +new Date(d.date))) : 0;
  $: tMax = n ? Math.max(...display.map(d => +new Date(d.date))) : 1;
  $: tSpan = Math.max(tMax - tMin, 1);

  // Y-scale: max of any individual model count (not stacked total)
  $: modelMax = n ? Math.max(...display.map(d => Math.max(d.jail, d.taskforce, d.wso))) : 0;
  $: yCeil = Math.ceil(Math.max(modelMax, Y_STEP) / Y_STEP) * Y_STEP;
  $: yTicks = Array.from({ length: yCeil / Y_STEP + 1 }, (_, k) => k * Y_STEP);

  $: dates = display.map(d => d.date);

  $: wsoLine  = n >= 2 ? mkLine(dates, display.map(d => d.wso),       IW, tMin, tSpan, yCeil) : "";
  $: jailLine = n >= 2 ? mkLine(dates, display.map(d => d.jail),      IW, tMin, tSpan, yCeil) : "";
  $: tfLine   = n >= 2 ? mkLine(dates, display.map(d => d.taskforce), IW, tMin, tSpan, yCeil) : "";

  $: xTicks = tSpan > 1
    ? [0, 1, 2, 3, 4].map(k => ({
        x: PL + (k / 4) * IW,
        label: fmtShort(new Date(tMin + (k / 4) * tSpan).toISOString().slice(0, 10)),
      }))
    : [];

  let hoverIdx: number | null = null;
  let hoverFrac = 0;

  function readHover(clientX: number, rect: DOMRect): void {
    const svgX = ((clientX - rect.left) / rect.width) * W;
    if (svgX < PL - 8 || svgX > W - PR + 8) { hoverIdx = null; return; }
    const pct = Math.max(0, Math.min(1, (svgX - PL) / IW));
    const targetMs = tMin + pct * tSpan;
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < display.length; i++) {
      const dist = Math.abs(+new Date(display[i].date) - targetMs);
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
    hoverIdx = best;
    hoverFrac = dateX(display[best].date, IW, tMin, tSpan) / W;
  }

  function onMove(e: MouseEvent) {
    readHover(e.clientX, (e.currentTarget as SVGSVGElement).getBoundingClientRect());
  }
  function onLeave() { hoverIdx = null; }
  function onTouch(e: TouchEvent) {
    if (!e.touches.length) { hoverIdx = null; return; }
    readHover(e.touches[0].clientX, (e.currentTarget as SVGSVGElement).getBoundingClientRect());
  }
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
      <!-- Gridlines + left axis -->
      {#each yTicks as v}
        {@const y = ly(v, yCeil)}
        <line x1={PL} y1={y} x2={W - PR} y2={y} class="gl" />
        <line x1={PL - 5} y1={y} x2={PL} y2={y} class="tick" />
        <text x={PL - 9} y={y + 4} class="al" text-anchor="end">{fmtY(v)}</text>
      {/each}

      <!-- Axis spines -->
      <line x1={PL} y1={PT} x2={PL} y2={H - PB} class="spine" />
      <line x1={PL} y1={H - PB} x2={W - PR} y2={H - PB} class="spine" />

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

      <!-- Layered lines (independent, not stacked) -->
      <path d={wsoLine}  fill="none" stroke={MODEL_COLORS["Warrant Service Officer"]} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
      <path d={jailLine} fill="none" stroke={MODEL_COLORS["Jail Enforcement Model"]}  stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
      <path d={tfLine}   fill="none" stroke={MODEL_COLORS["Task Force Model"]}        stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />

      <!-- Hover cursor + dots -->
      {#if hoverIdx !== null}
        {@const d = display[hoverIdx]}
        {@const hx = dateX(d.date, IW, tMin, tSpan)}
        <line x1={hx} y1={PT} x2={hx} y2={H - PB} class="cursor" />
        <circle cx={hx} cy={ly(d.wso,       yCeil)} r="3" fill={MODEL_COLORS["Warrant Service Officer"]} />
        <circle cx={hx} cy={ly(d.jail,      yCeil)} r="3" fill={MODEL_COLORS["Jail Enforcement Model"]} />
        <circle cx={hx} cy={ly(d.taskforce, yCeil)} r="3" fill={MODEL_COLORS["Task Force Model"]} />
      {/if}
    </svg>

    <!-- Tooltip -->
    {#if hoverIdx !== null}
      {@const d = display[hoverIdx]}
      {@const flip = hoverFrac > 0.6}
      <div
        class="tip"
        style={flip
          ? `right: ${((1 - hoverFrac) * 100).toFixed(1)}%; transform: translateX(8px);`
          : `left: ${(hoverFrac * 100).toFixed(1)}%; transform: translateX(-50%);`}
      >
        <p class="tip-date">{fmtLong(d.date)}</p>
        <ul class="tip-rows">
          {#each [
            { label: MODEL_SHORT["Task Force Model"],        val: d.taskforce, color: MODEL_COLORS["Task Force Model"] },
            { label: MODEL_SHORT["Jail Enforcement Model"],  val: d.jail,      color: MODEL_COLORS["Jail Enforcement Model"] },
            { label: MODEL_SHORT["Warrant Service Officer"], val: d.wso,       color: MODEL_COLORS["Warrant Service Officer"] },
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
    min-width: 140px;
    z-index: 10;
  }
  .tip-date { font-size: 11px; font-weight: 700; color: #0f172a; margin: 0 0 6px; }
  .tip-rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
  .tip-rows li { display: flex; justify-content: space-between; gap: 10px; font-size: 11px; font-weight: 500; }
</style>
