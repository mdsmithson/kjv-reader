# KJV Reader

An offline desktop Bible reader built with Rust and Tauri 2. The supplied
King James text is displayed in the bundled KJV1611 OpenType font.

## Run

Install Node.js 24.15+ (24 recommended), Rust stable, and the
[Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/).
On Windows, these include the Visual Studio C++ build tools and WebView2.

From this folder:

```sh
npm ci
npm run tauri dev
```

Create a Windows installer:

```sh
npm run tauri build
```

The installer appears in `src-tauri/target/release/bundle/nsis/`.
The configuration currently targets Windows NSIS. On macOS or Linux, use
`npm run tauri build -- --bundles app` or `--bundles appimage`, respectively,
after installing that platform's prerequisites.

## Features

- Choose any book and chapter from dropdowns.
- Previous/next chapter continues across book boundaries.
- Adjust the KJV1611 text size from 20 to 42 pixels.
- Search the whole Bible or one book, with all words or an exact phrase.
- Case-insensitive search with 50 results per page and a total count.
- Highlight matching words or phrases inside search results.
- Find words and phrases occurring exactly a chosen number of times or up to that count.
- Limit phrase length to exactly N words or up to N words (1–32).
- Filter those phrases to exactly N distinct Bible books or up to N books (1–66).
- Filter by exactly or up to N letters across the whole word or phrase.
- Require appearances in at least N neighboring verses within a chapter.
- Require appearances in at least N consecutive chapters within a book.
- Require exactly N appearances in at least one chapter.
- Numeric inputs are disabled and grey when their filter uses Any number.
- Save occurrence indexes on disk and reuse them across requests and app restarts.
- Open a result at its chapter with the selected verse highlighted.
- Use Ctrl+F (Cmd+F on macOS) to open Search.
- All text and font assets are local; no runtime network connection is needed.

The supplied text is preserved, including `#` paragraph markers and brackets.
See [SOURCES.md](SOURCES.md) for the source and font license. The font does not
change the supplied KJV spelling into the spelling of the 1611 edition.

## Occurrence search

Open **Occurrences** in the sidebar. For example, set **Occurrence count: Exactly 7**,
**Phrase length: Exactly**, **Words: 2**, **Number of books: Exactly**, **Books: 3**.
This returns two-word phrases with seven appearances across exactly three
distinct Bible books. Set either length/book selector to **Up to** for a maximum
instead, or choose **Any number** to ignore the distinct-book filter.

Set **Occurrence count** to **Up to** to include every positive count through
the chosen limit (for example, 1–7 appearances). Frequency and phrase size,
books to search, and optional location filters are grouped separately; each
comparison sits beside its numeric value with an explanation.

**Phrase length: Any number** searches all supported lengths, 1–32 words, and
hides the numeric entry. Switching back to **Exactly** or **Up to** restores the
previous value. On wide windows, search settings and results appear as two pages
side by side, each with its own scroll area. Narrow windows stack the pages.

The **Letters in phrase** selector also supports **Exactly**, **Up to**, or
**Any number**. For example: **7 occurrences · exactly 2 words · exactly 3 books ·
exactly 7 letters**. Letters count alphabetic characters across the normalized
phrase; spaces, punctuation (including apostrophes), and digits do not count.
For example, `God's word` has 8 letters. A zero-letter filter can match purely
numeric tokens. Each occurrence result displays its letter count.

**Consecutive verses** requires a run of at least N neighboring verse numbers
in the same chapter, with the phrase in every verse. Repeated appearances in
one verse do not extend the run. Gaps and chapter boundaries reset verse runs.

**Consecutive chapters** requires a run of at least N neighboring chapter
numbers in one book, with the phrase in at least one verse of every chapter.
Missing chapters and book boundaries reset chapter runs. A longer run also
satisfies a shorter requested length.

**Occurrences in one chapter** requires at least one chapter containing exactly N
appearances, including repeats within a verse. It checks individual chapter
counts, not the maximum chapter count. Filters combine with AND, but different
filters may be satisfied at different locations in the Bible. Results display
the longest verse/chapter runs and the maximum appearances in one chapter.

For every optional filter, **Any number** immediately disables and greys its
numeric input. Switching to an applicable mode enables it without losing the
form's other unsaved values. Disabled values are ignored during validation and
are omitted from the submitted filter.

Counts are global across the supplied Bible. Repeated and overlapping
appearances within one verse each count. A book is counted once per phrase,
regardless of how many verses in it match. Tokens are case-insensitive Unicode
letters/numbers with internal ASCII apostrophes preserved. Punctuation, brackets,
and paragraph markers separate words without breaking phrase sequences;
phrases never cross verse boundaries. No stemming or stop-word removal is used.

Selecting a phrase opens its matching verses with whole-word, punctuation-insensitive
highlighting. The verse total can be smaller than the occurrence count because
one verse may contain multiple appearances.

The first request for a phrase length counts and saves **every frequency** for
that length, including each phrase's distinct-book count. Changing the requested
frequency, book filter, or letter filter therefore reuses the same saved file. Exactly two words
builds only the two-word index; up to two words builds the one- and two-word
indexes as needed. Results are paged in groups of 50 and ordered by word length,
book count, letter count, then alphabetically. The UI reports whether it built data or reused it.

## Functional architecture

The Bible domain layer is immutable after initialization. Its operations return
values; they do not mutate application state or perform I/O. Occurrence storage
is an explicit effect boundary around an immutable token corpus. Iterator pipelines
compose parsing, selection, projection, and pagination. Named projections
(`to_verse`, `reference`, `verseMarkup`, `resultMarkup`) are passed directly
to transformations wherever that makes the data flow easier to read.

Rust requires explicit arguments for many operations. The code uses tacit
composition where practical, with small explicit functions for validation and
branching, keeping readable names rather than introducing combinator machinery.

| File                           | Responsibility                                                   |
| ------------------------------ | ---------------------------------------------------------------- |
| `src-tauri/src/bible.rs`       | Parse and index the corpus; pure chapter and search operations   |
| `src-tauri/src/text.rs`        | Shared normalization for occurrence counting and phrase lookup   |
| `src-tauri/src/occurrences.rs` | Exact n-gram counting and paged persistent index queries         |
| `src-tauri/src/commands.rs`    | Thin Tauri IPC adapters                                          |
| `src-tauri/src/lib.rs`         | Construct the corpus once and wire Tauri commands                |
| `src/model.ts`                 | Immutable state, exhaustive reducer, chapter navigation          |
| `src/view.ts`                  | Pure markup transformations and HTML escaping                    |
| `src/highlight.ts`             | Pure matching spans, overlap merging, escaped highlighting       |
| `src/occurrence-page.ts`       | Occurrence controls and paged result rendering                   |
| `src/filter-controls.ts`       | Enable optional numeric controls without rerendering form values |
| `src-tauri/src/spatial.rs`     | Stream verse/chapter runs and per-chapter counts                 |
| `src/api.ts`                   | Typed boundary to Tauri commands                                 |
| `src/main.ts`                  | DOM events and asynchronous effects                              |
| `src/style.css`                | Local font and presentation                                      |

The UI has one state value and one reducer. Effects commit through the reducer.
A monotonically increasing request token prevents late responses from replacing
newer chapter/search results. Search normalization is done once per verse at
startup. Matching and pagination stay in Rust; the UI receives at most 50
search results per response. Only the IPC boundary clones returned verses.

No frontend framework, runtime font service, filesystem plugin, shell plugin,
or HTTP plugin is required. The production HTML entry point does not include
the development-only preview fixture.

## Index algorithm and persistence

The corpus is tokenized once into interned 32-bit word IDs. Counting a requested
N-gram length slides a window over each verse and aggregates a hash map keyed by
borrowed ID slices. It avoids allocating a phrase string per window. Full-slice
comparison verifies hash collisions. A 128-bit book mask accumulates membership
for the 66-book corpus with bitwise OR; its population count gives distinct books.

For T tokens and U distinct sequences at a fixed length N, hashing takes
O(T × N) worst-case token work. Sorting takes O(U log U) comparisons; token-sequence
comparison can inspect up to N IDs. Only one requested length is built at a time.
The application does not precompute every possible length on startup.

The saved index uses fixed-size little-endian records sorted by occurrence count,
distinct-book count, letter count, and token IDs. Alphabetically sorted word IDs provide
deterministic phrase order. Two binary searches find the selected count/book range
in O(log U) record reads. A letter filter selects one contiguous letter range
per eligible book-count group, requiring O(B log U) reads for at most
B = min(66, requested frequency) groups for an exact occurrence count. An **Up to**
occurrence count uses one contiguous frequency range. Combined book/letter filters
scan that range's record metadata once and save matching positions, reusing the
same selection mechanism as location filters. Subsequent pages reuse that selection
without scanning or recounting the Bible. The service reads only the requested page, without
deserializing a full index or constructing all matching phrase strings. **Up to**
length requests query the relevant per-length files and page across their ranges.

Files are saved beneath Tauri's application local data directory in
`occurrences-v5-<SHA256>/words-N.bin`. The SHA-256 fingerprint covers the verse
text, book, chapter, and verse number; the version covers normalization and record format.
Changed corpora or formats therefore use separate indexes. Older indexes
remain intact; each requested length is rebuilt once in version 4 to add
positional summaries, then reused. Incomplete headers
or truncated files are rebuilt. A new file is flushed and synchronized before
rename publishes it, and a mutex coalesces simultaneous builds in one app
process. Index building and disk queries run on a Tauri blocking worker so the
window remains responsive.

Run lengths are computed in the same counting pass. A repeated match in a verse
adds an appearance but does not extend its verse/chapter run. Each record also
points to a packed, sorted list of distinct per-chapter occurrence counts.
An exact chapter-frequency test binary-searches this list, so a chapter count
smaller than the maximum is correctly recognized.

The first query with a run/chapter-frequency filter checks only candidates
selected by the count/book/letter indexes. Its matching record positions are
saved in a `selection-N-<SHA256>.bin` file keyed by the filter values, excluding
the page offset. Later requests, pages, and app restarts directly read the saved
positions. The first selection costs O(M) metadata checks over M candidates,
plus O(log D) reads per candidate for an exact chapter count with D distinct
chapter-frequency values. It never recounts the Bible. At most one length's
matching record positions are collected in memory while writing that selection;
serving a saved selection reads at most 50 positions per page.

The corpus and word dictionary stay in memory; full frequency indexes do not.
Increasing the word limit creates more saved files and takes additional time and
disk space. The supported limit is 32 words. Saved data is derived and can be
regenerated if its application data folder is removed.

To measure the engine on the bundled Bible:

```sh
cargo run --release --manifest-path src-tauri/Cargo.toml --no-default-features --example occurrence_benchmark
```

The example uses a development scratch folder and reports first/repeated requests,
paging, changed frequency/book filters, and reopening the saved index.

## Verification

```sh
npm test
npm run build
npm run format:check
npm run test:rust
npm run format:rust
npm run check:rust
npm run tauri build
```

The Rust tests check corpus totals, canonical order, chapter boundaries,
invalid input, case-insensitive search, pagination, book filtering, and phrase
semantics, independent occurrence counts, distinct-book and letter filters,
verse/chapter boundaries and gaps, repeated matches, exact per-chapter counts,
disabled optional controls, persisted positional selections, cache reuse after
restart, concurrent requests, truncated-file recovery, and cross-length paging.
The DOM integration test runs the real UI code with a fake Tauri
transport and the actual corpus. It checks navigation, delayed replies,
search pagination, highlighting, word/book occurrence modes, saved-data status,
filters, result selection, escaping, and transport failures.
It does not replace a native WebView2 smoke test.

For a development-only browser preview, run `npm run dev` and open
`http://127.0.0.1:1420/tests/preview.html`. This uses a fixture transport, while
the desktop application uses the Rust commands. Opening the regular root URL
in a browser explains that the desktop application must be started.

The Windows GitHub Actions workflow performs the checks and uploads the NSIS
installer when this folder is used as the repository root.

See [VERIFICATION.md](VERIFICATION.md) for the checks performed in the delivery
environment and the native build limitation observed there.

## Books and selected-book searches

The Books page offers all 66 books. Choose one to see its word count, unique word
count, verse count, most common words, and most common words found nowhere else
in the Bible. Ties appear alphabetically; no stop words are removed. All statistics
use the same case-insensitive tokenizer as occurrence search. One corpus pass
builds word counts and book ownership at startup, and subsequent requests use
these immutable statistics.

The **Chapters** section opens a statistics page for every chapter in the selected
book. Each page shows total words, distinct words, and distinct words found only
in that chapter across the entire Bible, including comparison with other chapters
of the same book. Chapter statistics share the book statistics' tokenizer and are
computed at startup. Choose another chapter or open its text with **Read**.
Click **Words only found in this chapter** to see each word and its appearance
count, ordered by count descending with alphabetical ties and 50 words per page.

Enable **Search selected books** in Occurrences to choose one or more books.
Every frequency, distinct-book count, and positional filter is evaluated within
that selection. Numeric book-count filters remain independently available.
Opening a phrase shows matching verses only in the selected books.

Each selection has a persistent index keyed by the corpus fingerprint and a
canonical book bitset. Selection order and duplicate names do not alter the cache;
pages and future application sessions reuse it. Token buffers and dictionaries
are shared, with up to four idle selection indexes retained in memory. Changing
the selected books builds a separate index on first use without retokenizing.

Each book also has a clickable **Words only found in this book** count. It counts
distinct words exclusive to that book. The detail page lists all of them with
appearance counts, ordered by frequency descending and then alphabetically for
ties. Lists show 50 words per page and link back to the book statistics. Rankings
are computed once with the immutable book statistics and reused on navigation.

## Exclusive phrases by book

**Phrases only found in this book** has 32 buttons, one for each exact word
length from 1 through 32. Each button shows the number of distinct exclusive
phrases. Counts load progressively; a length can be opened immediately. Length 1
agrees with the exclusive-word count. Lists show appearance counts, ranked from
most common to least common, with alphabetical ties and 50 results per page.
Case and punctuation normalization match occurrence search, overlapping matches
count, and phrases never cross verse boundaries. Exclusivity always compares
against the entire Bible, independently of occurrence search's selected books.

An exact hash map of borrowed interned token windows computes frequency and book
ownership once per length; equality resolves hash collisions. Only phrases owned
by a single book are saved. All books share each length's index. Its binary header
stores the corpus fingerprint, length, and per-book totals; fixed-width records
are grouped by book and ranked by frequency. Counts read the small header, and a
page seeks directly to at most 50 records. No full list is loaded into the UI or
retained in memory. The build processes one length at a time, runs off the UI
thread, publishes atomically, and rebuilds truncated or incompatible files.
Indexes remain available after restarting, and opening another book reuses them.

The release example `exclusive_benchmark` measures the actual corpus. This
machine built all 32 indexes in approximately 4.5 seconds and read a saved page
in under 1 millisecond; timings depend on hardware and disk.

## Whole-word search and the Words catalogue

Search matches complete words by default, ignoring case and punctuation. Internal
apostrophes remain part of a word: `god` does not match `godhead` or `god's`.
Enable **Partial match** for substring searches. **Exact phrase** requires words
in order; whole-word phrases ignore punctuation between words, while partial
phrase searches match the literal text.

**Words** lists all distinct words alphabetically, with total appearances and the
number of books containing each word. Filter by all or part of a word; the list
shows 50 entries per page. Opening a word shows its total count, letter count,
first-mentioned verse, and every containing book in Bible order, with per-book
appearance counts. Letters exclude punctuation, apostrophes, and digits. The first
mention opens in the reader; book links open whole-word searches scoped to that
book. The catalogue is built once from the bundled Bible and is available offline.

Click the **Books** or **Appearances** header on Words to reveal an exact-count
filter. Enter **66** under Books and submit to list words present in all 66 books.
Both count filters can be combined with the text filter; clear a numeric field
to remove its restriction. Filters remain active while paging or returning from
a word detail page.

## Prebuilt offline data

The release app retains **182,550 phrases** after equal-count rollup, backed by
10,179,800 internal analysis records covering every supported
length from **2 through 90 words**. Word counts, letter counts, total occurrences,
book counts, alphabetical order, filter indexes, and all matching verse locations
are prepared before packaging. Opening a phrase page does not scan the Bible,
recount phrases, sort the catalogue, create indexes, or copy the data pack.

The pack also includes whole-Bible occurrence and book-exclusive indexes for
**all 32 lengths**, plus word, book, and chapter statistics. Arbitrary selections
of books and optional occurrence-filter result sets use the existing local cache;
whole-Bible source counts and positional summaries are reused from bundled files.

Run **`npm run prepare:data`** to generate the pack once. Preparation resumes
completed phrase-length chunks and reuses complete analysis indexes. Unchanged
packs and statistics are reused on subsequent runs. The installer build runs
this preparation step automatically. The generated files live in
`src-tauri/data/precomputed/`, are ignored by Git, and are bundled as resources.
The desktop build rejects incomplete data, missing lengths, and data belonging
to another corpus. A corpus or binary-format change requires new prepared data.

The pack is approximately **1.99 GB before installer compression**. The compact
catalogue stores one 32-byte record per phrase and references shared token data,
rather than duplicating every phrase as text. Verse lists contain canonical verse
IDs. Metadata groups store precomputed matching counts and alphabetical phrase
IDs, so combined filters and later pages do not scan the corpus or full records.
Only the small dictionary, token data, and filter IDs are loaded at startup;
phrase records, verse postings, and analysis indexes remain on disk.

Measured release-mode reads on the development machine:

| Operation                                  |    Time |
| ------------------------------------------ | ------: |
| Open prepared phrase data                  |   61 ms |
| First 50 phrases                           |  0.3 ms |
| Page starting at phrase 1,000,000          |  0.3 ms |
| Exact-count filter examples                | 1–19 ms |
| Phrase detail and first 50 matching verses |    3 ms |

These measure backend data reads, excluding UI rendering and installer extraction.

## Phrases and presentation

**Phrases** lists retained phrases alphabetically, with words, letters, occurrences,
and books. Click a header to enter an exact-count filter, then press Enter or
**Filter phrases**. Filters combine, apply before pagination, and remain active
when returning from a phrase page. Clear a field to remove its restriction.

Opening a phrase shows the same counts and every matching verse in Bible order,
50 per page. Verses link to the reader. Matches use complete consecutive words
within one verse, ignoring case and punctuation. Letters exclude spaces,
punctuation, and digits. Occurrences include repetitions and overlapping matches;
the matching verse list includes each verse once.

Every page has **Text size** and **Page width** controls. **A− / A+** resizes
scripture text, and **↔− / ↔+** narrows or widens the presentation within the
available window. Settings carry across sections and preserve unsubmitted
filters and scroll position.

## Verses

**Verses** lists all **31,102 verses** in Bible order with word, letter, and
phrase counts. Choose a book to narrow the list; paging returns 50 verses.
Clicking a verse in the reader or catalogue opens its verse detail page.

Each verse detail shows the original verse with clickable words linking to
Word pages, the three counts, and its consecutive phrases of 2–90 words. Phrases appear alphabetically,
50 per page, with whole-Bible occurrence
and book counts; phrase links open their existing detail pages. Repeated phrases
appear once. A phrase that occurs once is hidden when a longer containing phrase
also occurs once; only the maximal containing phrase remains. Phrases with more
than one occurrence stay visible. The distinct-phrase count still includes all
phrases, and the list reports how many are shown. Labels preserve the verse’s
original capitalization, punctuation, and spelling. Counts and links retain the
existing case-insensitive normalized phrase identity. Word counts include repetitions. Letter counts exclude spaces,
punctuation, and digits. **Read in chapter** returns to the verse in the reader.

All counts, word boundaries, and alphabetical verse-to-phrase references are
prepared once and included in the app. The additional four files are
`verses.json`, `verse-words.bin`, `verse-phrases.bin`, and `verse-display.bin`,
approximately 85 MB in total. They contain 790,406 word links and 10,959,094 distinct verse-to-phrase
links, plus 1,801,735 rolled-up display links. Rollups and original-text display
boundaries are prepared once for every verse, before pagination. Runtime requests
read only the selected verse's saved word boundaries and
at most 50 phrase references. Existing phrase metadata is reused directly; no
verse tokenization, phrase enumeration, Bible scan, or sorting runs on navigation.
Preparation skips unchanged verse data, and packaging checks its corpus,
supported phrase lengths, directory size, and binary file sizes.

## Detail-page word lists and sorting

Verse detail pages have a **Words in this verse** list. Phrase detail pages have
clickable words in their headings, a **Words in this phrase** list, and proper
subphrases excluding the phrase itself. Each distinct normalized word appears
once, with its original display spelling, whole-Bible occurrences, letter count,
and number of containing books. Every word opens its Word page.

Click **Phrase**, **Occurrences**, or **Books** to sort verse phrases or phrase
subphrases. Click **Word**, **Occurrences**, **Letters**, or **Books** to sort
word lists. Clicking the same header again reverses ascending/descending order;
the arrow and accessible column status indicate the current order. Sorting
applies to the complete list before paging. Ties follow alphabetical phrase or
word order in the same direction. The equal-count phrase rollups
also apply among proper subphrases, and displayed labels retain punctuation
and capitalization.

The app ships `verse-order.bin`, containing both numeric sort orders for every
verse's complete displayed phrase list, plus `phrase-children.bin` and its
manifest. The latter stores two prefix/suffix references per phrase, a compact
shared graph covering all 10,179,800 analysis phrases. Proper subphrase lists follow saved
references and read existing counts; they do not scan the Bible or count phrases.
Saved phrase lengths cover complete verses (up to 90 words). A bounded cache
reuses the last 16 phrase content responses while matching-verse pages change.
Word metadata comes from the saved Words catalogue, and the small word and
subphrase lists sort locally. These indexes add approximately 91 MB and are
prepared once, verified before packaging, and reused unchanged on later builds.

## Reader highlights

Use **Edit Highlights** above a chapter to open the dedicated Highlights page.
Add up to ten filters, choose a color for each, enable or disable them, and save.
Filters include chapter-exclusive words, first/final word mentions, words appearing
exactly X times, and retained phrases occurring exactly X times across the Bible.
Overlapping filters render as vertical color segments. Existing preferences migrate
automatically. Returning to the reader preserves the chapter and reading position.

First/final word flags and retained phrase counts are prepared once in reader
metadata files. Chapter requests use saved word/phrase boundaries and statistics;
filter edits do not scan or recount the Bible. Unsaved edits stay active for the
current session; Save Highlights remembers them across app restarts.

## Verse count filters

On **Verses**, click the **Words**, **Letters**, or **Phrases** header to reveal
an exact-count filter, then press Enter or **Filter verses**. Count filters
combine with each other and the selected book, apply before pagination, and
remain active when returning from a verse detail page. Clear a numeric field
to remove its restriction. Phrases filter the retained distinct-phrase count after equal-count rollup. Header controls remain
available even when no verses match. The filters read precomputed verse summary
numbers directly; no Bible scan or phrase enumeration is needed.

The Numbers section lists numeric profiles in ascending order. Each profile shows the alphabetically ordered words with that exact whole-Bible appearance count. Word detail appearance, book, and letter counts link to the corresponding numeric profile. The number-to-word index is prepared once in `numbers.json` and loaded directly; number pages never recount the Bible.

Number profiles also show phrases with the exact whole-Bible occurrence count and verses with the exact letter count. Each list has independent pagination and links to its detail page. These lists use the bundled phrase indexes and saved verse summaries without recounting the Bible.

Phrases search finds complete, consecutive words anywhere in a saved phrase, ignoring case and punctuation. An optional Partial match toggle searches parts of words. Text and count filters combine before pagination; the search index is prepared once and searches reuse cached matching phrase IDs.

On Verses, Add filter adds up to five frequency columns. Each counts every appearance in a verse of words that occur exactly X times in the whole Bible, ignoring case. Click a new column heading for descending order, then again for ascending. Counts and full-catalogue sort orders are prepared once and bundled; book and count filters apply before pagination. Columns can be removed, and Restore Bible order returns to canonical ordering.

Add filter on Verses also offers phrase frequency columns. X is the whole-Bible occurrence count; each verse cell counts distinct phrases of 2–90 words with that global count, after equal-count segments have been rolled into their longest containing phrase. Word and phrase columns share the five-column limit and can be sorted or removed independently. Phrase histograms and sort orders are prepared once from saved phrase postings.

The persisted phrase catalogue omits a shorter phrase whenever a containing phrase has the same Bible-wide occurrence count. This applies to every count, including repeated phrases. The catalogue includes all verse-bounded phrase lengths, so rollups reach the true longest phrase instead of stopping at 32 words. Saved rollup indexes apply before searching, filtering, and pagination. Verse phrase totals and phrase-frequency columns use the same retained dataset, so counts agree with the displayed verse phrase list.

Run `npm run prepare:data` before the UI integration tests or visual preview; they also verify the prepared verse and phrase-frequency totals. Existing complete indexes are reused.

Reader highlighting is edited on a separate Highlights page using Edit Highlights above each chapter. Add up to ten saved filters with independent colors and enabled states: word occurrence count, phrase occurrence count, first mention, last mention, and chapter-exclusive words. Word and phrase counts cover the whole Bible. First and last mention mark only the first or final token; phrase filters use the retained equal-count-rollup catalogue. When filters overlap on a word, their colors form vertical segments from left to right. Existing highlight preferences migrate to the new format. Reader mention flags and phrase occurrence counts are prepared once, then retrieved directly for each chapter.

Phrase search offers Exact Match (the complete phrase, ignoring case and punctuation) and Partial Match (consecutive text anywhere in the phrase, including word fragments). Phrase profiles link their counts to Numbers and display a saved per-book occurrence breakdown, including repeated appearances within a verse. Book counts are generated once during data preparation and reused on subsequent builds and app launches.

Occurrence filters all hide their number input while Any number is selected, preserving its value when switching back. Copy data beside Results copies every match for the last completed occurrence search as alphabetical CSV with the header `phrase/word,count`, across all result pages. The desktop app exports from saved records directly to the system clipboard.

Occurrence searches can restrict the number of distinct chapters containing a word or phrase: Any Number, Every Chapter of the Bible (1,189), or Exactly X Chapters. Each chapter counts once, even when the phrase repeats. Selected books determine the appearances being counted; Every Chapter still requires all Bible chapters. Chapter coverage is saved in occurrence records and reused by searches and CSV copying.

Books supports selecting multiple books. Its combined view shows word and verse totals, distinct words, common words, and words exclusive to the selected set; chapter and single-book phrase sections are hidden. Group exclusivity includes words shared within the selection when none occur outside it. Statistics combine persisted per-book word frequencies and reuse recent selections.

Bible search results include a sortable Occurrences column for matches within each verse. Phrase counts include overlapping consecutive matches; any-order word searches count occurrences of all distinct search words. Partial matches follow the partial-search setting. Sorting covers the full result set before pagination, keeps canonical Bible order for ties, and preserves scroll position.

The Verses catalogue supports verse-text search combined with book and numeric filters and saved frequency-column sorting. Exact Match finds complete consecutive words anywhere in a verse, ignoring case and punctuation; Partial Match finds the literal entered text within words. Normalized search text is prepared once in `verse-search.json` and loaded for immediate retrieval.

Add search on the Verses page adds another independently configurable word or phrase condition. Searches narrow results cumulatively, in displayed order, and combine with book and numeric filters and frequency sorting. Blank conditions are ignored; removing a condition broadens the selection while preserving the remaining searches. Every condition uses the saved verse search text.

Add filter on the Verses page also offers Chapter number and Verse number. These exact reference filters can be combined, edited, or removed and narrow the current text searches and count filters across the selected books. They use the saved verse references and do not consume the five frequency-column slots.

Chapters lists all 1,189 chapters with sortable word, distinct-word, first-mention-word, and chapter-exclusive-word totals. Chapter profiles contain paged sortable word and distinct saved-phrase tables with Word and Phrase page links. Word counts are provided for both the chapter and the Bible; phrase tables include words, letters, books, occurrences, and distinct words first mentioned in that chapter. Chapter profiles are prepared once and read from `chapters.json` and `chapter-profiles/`, with recent profiles reused in memory. Phrase lists follow the same global equal-count rollup as Phrases.
