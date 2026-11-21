# The World in One Day — Saturday 21 November 2026

[![make.fun · news-image-20261121](https://make.fun/badge/news-image-20261121.svg)](https://make.fun/bounty/news-image-20261121?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261121)
[![rank](https://make.fun/badge/news-image-20261121/adzinsyariif/news-image-20261121/rank.svg)](https://make.fun/bounty/news-image-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261121)
[![reward](https://make.fun/badge/news-image-20261121/adzinsyariif/news-image-20261121/reward.svg)](https://make.fun/bounty/news-image-20261121?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261121)

A one-image front page of the world's news of **Saturday 21 November 2026**,
drawn entirely in code for the make.fun bounty
[news-image-20261121](https://make.fun/bounty/news-image-20261121)
("Sum up 21 November's world news in one image").

`main.ts` (Node 22, standard library only) is the whole entry: it rasterises
the page pixel by pixel — a hand-rolled stroke font, per-story drawn motifs
and a plunging markets chart — and writes a deterministic 1024×1024 PNG to
`/output/entry.png`. No image file is shipped; the program draws it, and two
runs produce byte-identical output (sha256
`00c6093888577aa6ba72e223dbcf1ec474bde9585cd3ffd7e663d967146b328a`,
162,235 bytes).

## The day's stories, as chosen

One lead, four panels, two bottom stories and an in-brief strip — picked for
consequence and breadth across regions and fields, from the day's reporting:

1. **Economy (lead).** An AI-led sell-off sinks world markets: Wall Street
   slides into correction, the S&P 500 falls 3.7%, the Nasdaq 5.3% and
   Tokyo's Nikkei 5.1%, as doubts grow over AI spending; the SEC examines
   Nvidia. — One Turn's 21 November edition; CNBC figures via The Daily Brief.
2. **War in Europe.** A Russian Kh-101 cruise missile crashes in south-east
   Poland during a mass attack on Ukraine and NATO jets scramble; a strike
   on Kryvyi Rih, President Zelenskyy's hometown, kills 2 and injures 60.
   — One Turn; Al Jazeera.
3. **Climate.** The COP31 summit in Antalya, Türkiye overruns its Friday
   deadline; the draft text drops fossil fuels amid splits on energy and
   finance. — One Turn; The Daily Brief.
4. **World Court.** The International Court of Justice's landmark 9–6
   verdict holds Myanmar responsible for genocide against the Rohingya;
   Bangladesh vows to pursue compensation for the displaced. — ICJ reporting
   via TBS News and Asia Daily; One Turn.
5. **Mexico.** Special forces capture Fausto Isidro Meza Flores, "El Chapo
   Isidro", an FBI most-wanted cartel boss, in Guasave, Sinaloa; violence
   follows. — PBS NewsHour; One Turn.
6. **Science.** ESA and JAXA's BepiColombo enters orbit around Mercury
   after an eight-year voyage — only the second spacecraft ever to orbit
   the innermost planet. — ESA; Nature; Sky & Telescope.
7. **Sport.** Leeds United stun Chelsea 4–1 at Stamford Bridge, their first
   win there since 1999; PSG edge Nice 3–2 and Dortmund go top of the
   Bundesliga. — Reuters.
8. **In brief.** A magnitude 6.8 earthquake in the Banda Sea near
   Timor-Leste; Brazil's ex-president Bolsonaro taken to intensive care in
   Brasília; marches across France and in Lisbon over living costs.
   — Reuters.

### Sources

- One Turn, world news of Saturday 21 November 2026 — https://oneturn.news/news/
- ESA, BepiColombo's arrival at Mercury — https://www.esa.int/articles/about-us/directorates/science/bepicolombo/latest-updates-bepicolombo-s-arrival-at-mercury
- Sky & Telescope, "BepiColombo Arrives at Mercury After 8-Year Odyssey" — https://skyandtelescope.org/astronomy-news/bepicolombo-arrives-at-mercury-after-8-year-odyssey/
- TBS News, "ICJ rules Myanmar committed genocide against Rohingya in historic ruling" — https://www.tbsnews.net/world/south-asia/icj-rules-myanmar-committed-genocide-against-rohingya-historic-ruling-1609166
- Reuters, Leeds–Chelsea — https://www.reuters.com/sports/soccer/leeds-bare-their-teeth-batter-old-foes-chelsea-2026-11-21/
- Reuters, Banda Sea earthquake — https://www.reuters.com/business/environment/magnitude-68-earthquake-strikes-banda-sea-near-timor-leste-gfz-says-2026-11-21/
- Reuters, Bolsonaro to ICU — https://www.reuters.com/world/americas/brazil-ex-president-jair-bolsonaro-taken-icu-2026-11-21/
- Reuters, France marches — https://www.reuters.com/world/lower-turnout-largely-peaceful-marches-across-france-2026-11-21/
- Reuters, Lisbon march — https://www.reuters.com/world/europe/thousands-march-lisbon-living-costs-fuel-anger-2026-11-21/

## Reproduce

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
sha256sum out/entry.png   # deterministic: the same bytes on every run
```

## License

MIT — see `LICENSE`.
