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
`occurrences-v4-<SHA256>/words-N.bin`. The SHA-256 fingerprint covers the verse
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
