# Delivery verification — October 8, 2026

Passed:

- TypeScript strict type checking and Vite production build.
- Twenty-two Rust domain/index tests: 66 books, 1,189 chapters, 31,102 verses;
  chapter boundaries and missing chapters; search paging/filtering/case;
  phrase versus all-words behavior; malformed source handling; independently
  checked occurrence counts; combined exact/up-to word, book, and letter filtering;
  alphabetic letter counting with punctuation/digits excluded; cache reuse
  and positional summaries: gaps, chapter/book boundaries, repeated verse
  appearances, exact per-chapter frequencies, saved selection reuse/paging,
  and recovery from truncated selection files;
  after restart and changed filters; concurrent builds; truncation recovery;
  pagination across phrase lengths; normalized counted-phrase lookup.
- DOM integration tests against the actual frontend bundle and supplied corpus:
  chapter selection, stale-reply rejection, final-chapter boundary, search
  pagination, exact phrase and book filter, result-to-verse navigation,
  HTML escaping, match highlighting, exact/up-to word/book/letter occurrence controls,
  saved-data reuse, occurrence pagination, and transport-error display.
  The UI checks also cover consecutive verse/chapter filters, exact chapter
  frequency, immediate enable/disable behavior, and ignored invalid disabled values.
- Application icons generated with Tauri's icon command.
- Bible file and font copied unmodified with font license and attribution.

Full-corpus occurrence benchmark, release build, in this environment:

| Operation                                                        | Measured time |
| ---------------------------------------------------------------- | ------------- |
| Tokenize and intern corpus                                       | 130 ms        |
| First query, count 7, up to 2 words, build and save both indexes | 256 ms        |
| Repeat query / next page / changed count                         | 1 ms each     |
| Exactly 3 books / up to 3 books                                  | 1 ms each     |
| Exactly 7 letters                                                | 1 ms          |
| Up to 7 letters, up to 3 books                                   | 1 ms          |
| First consecutive-verse query / repeated query                   | 44 ms / 1 ms  |
| First consecutive-chapter query                                  | 43 ms         |
| First exact chapter-frequency query                              | 48 ms         |
| Reopen saved indexes in a new service                            | 1 ms          |

The first query returned 2,178 distinct words/phrases. Restricting it to exactly
three books returned 261, and up to three books returned 504. Exactly seven
letters returned 369; up to seven letters in up to three books returned 145.
Requiring two neighboring verses returned 396; two consecutive chapters returned
490; exactly two appearances in at least one chapter returned 908.
Timings are one
observed run with millisecond-resolution measurements, not a performance guarantee.

Native verification remains incomplete:

- `npm run tauri build -- --no-bundle` could not canonicalize `../dist`
  because this Windows sandbox denies path canonicalization.
- A direct Cargo release build progressed through the Rust dependencies, then
  Tauri 2.12.1's own build script failed canonicalizing its bundled global API
  script with `Access is denied (os error 5)`.
- Clippy encountered the same access error reading `CARGO_MANIFEST_DIR`.
- Rustfmt also failed with the environment's path-resolution error.
- The available in-app browser could not reach the local preview server;
  no visual or native WebView2 smoke test is claimed.

The desktop executable and installer are not included. Build in a normal
Windows development shell using the README commands or run the included
Windows CI workflow. Tauri dependencies were not patched to mask these
environment failures.

Latest additions verified: tied/exclusive word statistics, word and verse totals,
empty exclusive sets, invalid book handling; selected-book recounting, combined
chapter/book filters, saved reuse after restart and reordered/duplicate selections;
Books page navigation, book-selection toggle and scoped result navigation.

Exclusive-word lists verified: exclusion of words appearing in other books,
case-insensitive frequency counts, descending frequency with alphabetical ties,
empty lists, clickable distinct-word count, list pagination, and back navigation.

Exclusive phrases verified: all lengths 1–32 against an independent string
ownership oracle; overlapping matches, global exclusivity, verse boundaries,
frequency/alphabetical ranking, 32-word nonempty lists, missing/invalid inputs,
paging, restart reuse, and truncated-file recovery. DOM tests verify all 32
buttons, progressive counts, opening lists, paging, length changes, empty results,
and back navigation. The full-corpus release benchmark built all lengths in
approximately 4.5 seconds; Genesis has 232 exclusive one-word phrases, 5,007
exclusive two-word phrases, and 2,764 exclusive 32-word phrases. Saved paging
reported 0 ms at millisecond resolution.
