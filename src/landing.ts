import { VERSION } from "./version.js";

const REPO = "https://github.com/ContentWriterco/szkoly-mcp";

export function landingHtml(base: string, stats: boolean): string {
  const mcp = `${base}/mcp`;
  return `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>szkoly-mcp – szkoły, przedszkola i wyniki egzaminów w Polsce dla AI (serwer MCP)</title>
<meta name="description" content="Darmowy serwer MCP z rejestrem szkół i przedszkoli oraz wynikami egzaminu ósmoklasisty i matury dla każdej szkoły. Zapytaj Claude albo ChatGPT, jaka szkoła jest najbliżej i jak wypada na egzaminach.">
<link rel="canonical" href="${base}/">
<meta property="og:title" content="Która szkoła dla dziecka? – szkoły, przedszkola i wyniki egzaminów dla Twojego asystenta AI">
<meta property="og:description" content="Oficjalny wykaz szkół (MEN) i wyniki egzaminów (CKE) w Claude, ChatGPT i każdym kliencie MCP. Bez klucza API.">
<meta property="og:url" content="${base}/"><meta name="twitter:card" content="summary">
<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "szkoly-mcp",
    applicationCategory: "EducationalApplication",
    operatingSystem: "Any",
    softwareVersion: VERSION,
    description: "MCP server with Polish schools and kindergartens and per-school exam results (eighth-grade exam, matura).",
    url: `${base}/`,
    codeRepository: REPO,
    license: "https://opensource.org/licenses/MIT",
    offers: { "@type": "Offer", price: "0", priceCurrency: "PLN" },
    publisher: { "@type": "Organization", name: "Compabase (Content Writer sp. z o.o.)", url: "https://compabase.com" },
  })}</script>
<style>
:root{--bg:#fff;--fg:#1f2328;--mut:#59636e;--card:#f6f8fa;--bd:#d1d9e0;--acc:#1a7f37}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--mut:#9198a1;--card:#151b23;--bd:#3d444d;--acc:#3fb950}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
main{max-width:860px;margin:0 auto;padding:48px 16px 64px}h1{font-size:38px;line-height:1.15;margin:0 0 12px}h1 span{color:var(--acc)}h2{font-size:22px;margin:36px 0 12px}
p.lead{font-size:19px;color:var(--mut);margin:0 0 24px}.ep{display:flex;gap:8px;flex-wrap:wrap;align-items:center;background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:12px 14px;font:15px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.ep code{flex:1;min-width:0;overflow-wrap:anywhere}button{font:600 14px inherit;font-family:inherit;padding:6px 12px;border-radius:8px;border:1px solid var(--bd);background:var(--bg);color:var(--fg);cursor:pointer}
pre{background:var(--card);border:1px solid var(--bd);border-radius:8px;padding:14px;overflow:auto;font-size:13.5px;line-height:1.5;white-space:pre-wrap}li{margin:6px 0}a{color:var(--acc)}.small{color:var(--mut);font-size:14px}
</style></head><body><main>
<h1><span>szkoly</span>-mcp</h1>
<p class="lead">Jaka szkoła albo przedszkole dla dziecka? Oficjalny wykaz szkół i przedszkoli (MEN) z liczbą uczniów i wynikami egzaminu ósmoklasisty oraz matury dla każdej szkoły (CKE) – w Claude, ChatGPT, Cursorze i każdym kliencie MCP. Za darmo, bez klucza API.</p>
<div class="ep"><code id="u">${mcp}</code><button onclick="navigator.clipboard.writeText(document.getElementById('u').textContent);this.textContent='Skopiowano'">Kopiuj adres MCP</button></div>
<h2>Przykład</h2>
<pre>Ty:    Jakie są szkoły podstawowe w gminie Kórnik i jak wypadają na egzaminie ósmoklasisty?
Agent: W gminie jest 6 publicznych podstawówek. Najlepiej z angielskiego wypadło Robakowo (84%),
       z polskiego Szczodrzykowo (68%), z matematyki Kamionki (58%) – średnia w Polsce: 65 / 55 / 73%.
       SP 2 w Kórniku poprawia się od 3 lat: matematyka 43% → 44% → 55%.</pre>
<p class="small">Przykład na podstawie prawdziwych wyników egzaminu ósmoklasisty 2024–2026.</p>
<h2>Jak podłączyć</h2>
<ul>
<li><b>Claude</b>: Ustawienia → Connectors → <i>Add custom connector</i> → wklej adres powyżej.</li>
<li><b>ChatGPT</b>: Settings → Connectors (tryb deweloperski) → dodaj serwer MCP z tym adresem.</li>
<li><b>Claude Code</b>: <code>claude mcp add --transport http szkoly ${mcp}</code></li>
<li><b>Lokalnie</b>: <code>npx -y szkoly-mcp</code></li>
</ul>
<h2>Co potrafi</h2>
<ul>
<li><b>find_schools</b> – szkoły lub przedszkola w miejscowości, gminie albo najbliżej adresu: typ, publiczna czy niepubliczna, adres, liczba uczniów, strona www i najnowsze wyniki egzaminu na tle kraju.</li>
<li><b>school_details</b> – jedna szkoła: dane z rejestru, liczba uczniów na nauczyciela i wyniki z ostatnich lat z każdego przedmiotu (egzamin ósmoklasisty albo matura) na tle powiatu i kraju.</li>
<li><b>data_sources</b> – źródła i zastrzeżenia.</li>
</ul>
<p class="small">Dane: Wykaz szkół i placówek oświatowych (MEN, SIO, dane.gov.pl, CC BY 4.0), wyniki egzaminów – CKE / Mapa wyników egzaminów. Wynik egzaminu nie mierzy wszystkiego, co ważne w szkole. Open source (MIT): <a href="${REPO}">GitHub</a>${stats ? ` · <a href="/stats">statystyki użycia</a> (anonimowe)` : ""} · wersja ${VERSION} · hostowane pro publico bono przez <a href="https://compabase.com">Compabase</a>.</p>
<p class="small" lang="en"><b>English:</b> free MCP server with the official register of Polish schools and kindergartens and per-school results of the eighth-grade exam and the matura, compared with county and national averages. Endpoint: <code>${mcp}</code></p>
</main></body></html>`;
}
