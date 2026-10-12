//! Export the entire current selection from saved records, independent of UI paging.
use super::*;
impl OccurrenceIndex {
    pub(super) fn read_csv(&self, query: &OccurrenceQuery) -> io::Result<String> {
        let lengths = if query.up_to {
            1..=query.words
        } else {
            query.words..=query.words
        };
        let mut rows = Vec::<(String, u32)>::new();
        for length in lengths {
            let (mut file, records, _) = self.ensure(length)?;
            let mut ranges = Vec::new();
            for (from, to) in query_ranges(query) {
                let start = lower_bound(&mut file, length, records, from)?;
                let end = lower_bound(&mut file, length, records, to)?;
                if start != end {
                    ranges.push((start, end));
                }
            }
            let (mut selection, _) = self.selection(&mut file, records, length, query, ranges)?;
            let mut offset = 0;
            while offset < selection.total() {
                let indices = selection.page(offset, 4096)?;
                offset += indices.len() as u64;
                for id in indices {
                    if id >= records {
                        return Err(invalid("Invalid saved occurrence selection"));
                    }
                    file.seek(SeekFrom::Start(HEADER_SIZE + id * stride(length)))?;
                    let record = Record::read(&mut file)?;
                    let phrase = (0..length)
                        .map(|_| {
                            let token = read_u32(&mut file)?;
                            self.dictionary
                                .get(token as usize)
                                .map(String::as_str)
                                .ok_or_else(|| invalid("Invalid token ID"))
                        })
                        .collect::<io::Result<Vec<_>>>()?
                        .join(" ");
                    rows.push((phrase, record.count));
                }
            }
        }
        rows.sort_unstable_by(|a, b| a.0.cmp(&b.0));
        let mut csv = String::from("phrase/word,count\n");
        for (phrase, count) in rows {
            // Saved token text contains no commas, quotes or line breaks.
            csv.push_str(&phrase);
            csv.push(',');
            csv.push_str(&count.to_string());
            csv.push('\n');
        }
        Ok(csv)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn export_is_alphabetical_complete_across_pages_and_respects_every_filter() {
        let root = std::env::temp_dir().join(format!(
            "kjv-csv-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let source: BTreeMap<String, String> = (1..=80)
            .map(|n| (format!("Genesis 1:{n}"), format!("alpha word{n} alpha")))
            .chain([
                ("Exodus 1:1".into(), "alpha word1".into()),
                ("Exodus 1:2".into(), "alpha word1".into()),
            ])
            .collect();
        let bible =
            crate::bible::Bible::from_json(&serde_json::to_string(&source).unwrap()).unwrap();
        let index = OccurrenceIndex::from_passages(bible.located_passages(), &root);
        let base: OccurrenceQuery=serde_json::from_value(serde_json::json!({"count":4294967295u32,"countUpTo":true,"words":2,"upTo":true,"offset":999})).unwrap();
        for request in [
            base.clone(),
            OccurrenceQuery {
                count: 1,
                count_up_to: false,
                ..base.clone()
            },
            OccurrenceQuery {
                books: Some(2),
                letters: Some(10),
                letters_up_to: true,
                ..base.clone()
            },
            OccurrenceQuery {
                included_books: Some(vec!["Genesis".into()]),
                chapter_frequency: Some(2),
                ..base.clone()
            },
            OccurrenceQuery {
                consecutive_verses: Some(2),
                ..base.clone()
            },
            OccurrenceQuery {
                letters: Some(0),
                ..base.clone()
            },
        ] {
            let total = index
                .search(&OccurrenceQuery {
                    offset: 0,
                    ..request.clone()
                })
                .unwrap()
                .total;
            let mut expected = Vec::new();
            for offset in (0..total).step_by(PAGE_SIZE) {
                expected.extend(
                    index
                        .search(&OccurrenceQuery {
                            offset,
                            ..request.clone()
                        })
                        .unwrap()
                        .entries
                        .into_iter()
                        .map(|entry| (entry.phrase, entry.count)),
                );
            }
            expected.sort_unstable_by(|a, b| a.0.cmp(&b.0));
            let csv = index.csv(&request).unwrap();
            assert_eq!(csv.lines().next(), Some("phrase/word,count"));
            let actual = csv
                .lines()
                .skip(1)
                .map(|line| {
                    let (phrase, count) = line.rsplit_once(',').unwrap();
                    (phrase.to_owned(), count.parse::<u32>().unwrap())
                })
                .collect::<Vec<_>>();
            assert_eq!(actual, expected);
        }
        assert!(index.csv(&OccurrenceQuery { count: 0, ..base }).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
