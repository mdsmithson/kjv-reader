//! Verify the exact packaged resources without generating or changing any data.
use kjv_reader_lib::{
    bible::Bible,
    book_stats::BookStatistics,
    occurrences::{
        catalogue::PhraseFilters,
        prepared::{PreparedPhrases, PreparedVerses},
        OccurrenceIndex, OccurrenceQuery,
    },
    phrase_stats,
    word_stats::WordStatistics,
};
use std::{fs::File, path::PathBuf, time::Instant};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = PathBuf::from(
        std::env::args()
            .nth(1)
            .expect("Provide the packaged precomputed directory"),
    );
    let bible = Bible::bundled()?;
    let store = PreparedPhrases::open(&root, &bible)?;
    let words: WordStatistics = serde_json::from_reader(File::open(root.join("words.json"))?)?;
    let numbers: kjv_reader_lib::number_stats::NumberStatistics = serde_json::from_reader(File::open(root.join("numbers.json"))?)?;
    for number in [1,22,66,63919,999999] {
        let expected = words.list_filtered("",0,None,Some(number));
        let before = Instant::now();
        let actual = numbers.words(number,0);
        println!("Number {number}: {:?}; {} words",before.elapsed(),actual.total);
        assert_eq!(serde_json::to_value(actual)?,serde_json::to_value(expected)?);
    }
    let books: BookStatistics = serde_json::from_reader(File::open(root.join("books.json"))?)?;
    for selected in [vec!["Genesis".to_owned(),"Exodus".to_owned()],vec!["Matthew".to_owned(),"Mark".to_owned(),"Luke".to_owned(),"John".to_owned()],bible.catalog().iter().map(|book|book.name.clone()).collect()] {
        let before=Instant::now();
        let group=books.combined(&selected,&words)?;
        println!("Combined {} books from saved counts: {:?}",selected.len(),before.elapsed());
        let mut counts=std::collections::BTreeMap::<String,usize>::new();
        let mut outside=std::collections::HashSet::<String>::new();
        let mut verses=0;
        for (book,text) in bible.passages() {
            if selected.iter().any(|name|name==book) { verses+=1; for word in kjv_reader_lib::text::words(text) { *counts.entry(word).or_default()+=1; } }
            else { outside.extend(kjv_reader_lib::text::words(text)); }
        }
        let mut exclusive=counts.iter().filter(|(word,_)|!outside.contains(*word)).map(|(word,&count)|kjv_reader_lib::book_stats::CommonWord {word:word.clone(),count}).collect::<Vec<_>>();
        exclusive.sort_by(|a,b|b.count.cmp(&a.count).then_with(||a.word.cmp(&b.word)));
        let maximum=counts.values().max().copied().unwrap_or(0);
        let leaders=counts.iter().filter(|(_,count)|**count==maximum).map(|(word,&count)|kjv_reader_lib::book_stats::CommonWord {word:word.clone(),count}).collect::<Vec<_>>();
        assert_eq!((group.words,group.unique_words,group.verses),(counts.values().sum::<usize>(),counts.len(),verses));
        assert_eq!(group.exclusive_words,exclusive);
        assert_eq!(group.most_common,leaders);
        assert!(group.chapters.is_empty());
    }
    assert_eq!(
        words.get("god")?.count,
        WordStatistics::new(&bible).get("god")?.count
    );
    assert_eq!(
        books.get("Genesis")?.words,
        BookStatistics::new(&bible).get("Genesis")?.words
    );
    let cache =
        std::env::temp_dir().join(format!("kjv-resource-verification-{}", std::process::id()));
    let index = OccurrenceIndex::from_passages(bible.located_passages(), &cache)
        .with_prebuilt(&root.join("occurrences"));
    for (count,count_up_to,length) in [(u32::MAX,true,1),(7,false,2)] {
        let query: OccurrenceQuery=serde_json::from_value(serde_json::json!({"count":count,"countUpTo":count_up_to,"words":length,"upTo":false,"offset":999}))?;
        let expected_total=index.search(&query)?.total;
        let csv=index.csv(&query)?;
        let rows: Vec<_>=csv.lines().skip(1).map(|line|line.rsplit_once(',').unwrap()).collect();
        assert_eq!(csv.lines().next(),Some("phrase/word,count"));
        assert_eq!(rows.len(),expected_total);
        assert!(rows.windows(2).all(|pair|pair[0].0<pair[1].0));
        for &(phrase,count) in rows.iter().step_by((rows.len()/10).max(1)) {
            let actual=count.parse::<usize>()?;
            let expected=if length==1 { words.get(phrase)?.count } else { phrase_stats::details(&bible,phrase,0)?.occurrences };
            assert_eq!(actual,expected);
        }
        println!("Verified full alphabetical CSV: {} rows, {} word length",rows.len(),length);
    }
    let chapter_cache=cache.with_extension("chapters");
    let chapter_index=OccurrenceIndex::from_passages(bible.located_passages(),&chapter_cache).with_prebuilt(&root.join("occurrences"));
    let mut chapter_owners=std::collections::HashMap::<String,std::collections::HashSet<(String,u16)>>::new();
    for (book,chapter,_,text) in bible.located_passages() { for word in kjv_reader_lib::text::words(text) { chapter_owners.entry(word).or_default().insert((book.into(),chapter)); } }
    for chapters in [1,22,1189] {
        let query: OccurrenceQuery=serde_json::from_value(serde_json::json!({"count":4294967295u32,"countUpTo":true,"words":1,"upTo":false,"chapters":chapters,"offset":0}))?;
        let expected=chapter_owners.iter().filter(|(_,owners)|owners.len()==chapters).map(|(word,_)|word.as_str()).collect::<std::collections::BTreeSet<_>>();
        let csv=chapter_index.csv(&query)?;
        let actual=csv.lines().skip(1).map(|line|line.rsplit_once(',').unwrap().0).collect::<std::collections::BTreeSet<_>>();
        assert_eq!(actual,expected);
        let page=chapter_index.search(&query)?;
        assert!(page.built_lengths.is_empty()); assert!(!page.built_filters); assert_eq!(page.total,expected.len()); assert!(page.entries.iter().all(|entry|entry.chapters==chapters as u32));
        println!("Verified {} chapters: {} words",chapters,page.total);
    }
    std::fs::remove_dir_all(chapter_cache)?;
    for length in 1..=32 {
        let query: OccurrenceQuery = serde_json::from_value(
            serde_json::json!({"count":7,"words":length,"upTo":false,"offset":0}),
        )?;
        assert!(index.search(&query)?.built_lengths.is_empty());
        index.exclusive_count("Genesis", length)?;
    }
    assert!(
        !cache.exists(),
        "Reading packaged source indexes must not create a cache"
    );
    for length in [2, 3, 16, 32,36,90] {
        let before = Instant::now();
        let page = store.page(
            0,
            &PhraseFilters {
                words: Some(length),
                ..Default::default()
            },
        )?;
        println!(
            "{length}-word page: {:?}, {} phrases",
            before.elapsed(),
            page.total
        );
        let phrase = &page.entries[0].phrase;
        let actual = store.detail(&bible, phrase, 0)?;
        let saved_books=store.book_counts(phrase)?;
        let tokens=kjv_reader_lib::text::words(phrase);
        let mut expected_books=std::collections::BTreeMap::<String,u32>::new();
        for (book,text) in bible.passages() {
            let count=kjv_reader_lib::text::words(text).windows(tokens.len()).filter(|window| *window==tokens).count() as u32;
            if count>0 { *expected_books.entry(book.to_owned()).or_default() += count; }
        }
        assert_eq!(saved_books.iter().map(|row|(row.book.clone(),row.occurrences)).collect::<std::collections::BTreeMap<_,_>>(),expected_books);
        let exact=store.page(0,&PhraseFilters {text:Some(phrase.to_uppercase()),exact:true,..Default::default()})?;
        assert_eq!(exact.total,1); assert_eq!(exact.entries[0].phrase,*phrase);
        let expected = phrase_stats::details(&bible, phrase, 0)?;
        assert_eq!(
            serde_json::to_value(actual)?,
            serde_json::to_value(expected)?
        );
    }
    for (text,partial) in [("in the beginning",false),("god",false),("god",true)] {
        let filters=PhraseFilters {text:Some(text.into()),partial,..Default::default()};
        let before=Instant::now();
        let page=store.page(0,&filters)?;
        println!("Search {text:?}, partial={partial}: {:?}; {} phrases",before.elapsed(),page.total);
        assert!(page.total>0);
        let query=kjv_reader_lib::text::words(text);
        for entry in &page.entries {
            let tokens=kjv_reader_lib::text::words(&entry.phrase);
            assert!(tokens.windows(query.len()).any(|window|window.iter().zip(&query).all(|(word,term)|if partial {word.contains(term)} else {word==term})));
        }
        let before=Instant::now();
        let later=store.page(50,&filters)?;
        println!("Cached search page: {:?}",before.elapsed());
        assert_eq!(later.total,page.total);
        if page.total>50 {assert!(page.entries.last().unwrap().phrase < later.entries[0].phrase);} else {assert!(later.entries.is_empty());}
    }
    let numeric_phrases = store.page(0,&PhraseFilters {occurrences:Some(22),..Default::default()})?;
    assert!(numeric_phrases.total > 50);
    for entry in &numeric_phrases.entries {
        assert_eq!(entry.occurrences,22);
        assert_eq!(phrase_stats::details(&bible,&entry.phrase,0)?.occurrences,22);
    }
    let later_phrases = store.page(50,&PhraseFilters {occurrences:Some(22),..Default::default()})?;
    assert!(numeric_phrases.entries.last().unwrap().phrase < later_phrases.entries[0].phrase);
    println!("Number 22: {} persisted phrases",numeric_phrases.total);
    let verses = PreparedVerses::open(&root, &bible, &store)?;
    for (chapter,verse) in [(Some(3),None),(None,Some(16)),(Some(3),Some(16))] {
        let filters=kjv_reader_lib::occurrences::prepared::VerseFilters {chapter,verse,text:Some("God".into()),..Default::default()};
        let expected=bible.located_passages().filter(|(_,ch,v,text)|chapter.is_none_or(|n|n==*ch as usize)&&verse.is_none_or(|n|n==*v as usize)&&kjv_reader_lib::text::words(text).iter().any(|word|word=="god")).map(|(book,ch,v,_)|(book.to_owned(),ch,v)).collect::<Vec<_>>();
        let page=verses.page_filtered(None,0,&filters)?; assert_eq!(page.total,expected.len());
        assert_eq!(page.entries.iter().map(|entry|(entry.verse.book.clone(),entry.verse.chapter,entry.verse.number)).collect::<Vec<_>>(),expected.into_iter().take(50).collect::<Vec<_>>());
        println!("Saved reference filters: chapter={chapter:?}, verse={verse:?}; {} matching verses",page.total);
    }

    let chained=kjv_reader_lib::occurrences::prepared::VerseFilters {text:Some("God".into()),searches:vec![kjv_reader_lib::occurrences::prepared::VerseSearchFilter {text:"heaven".into(),partial:false},kjv_reader_lib::occurrences::prepared::VerseSearchFilter {text:"created".into(),partial:false}],..Default::default()};
    let page=verses.page_filtered(None,0,&chained)?;
    let expected=bible.passages().filter(|(_,text)| {let words=kjv_reader_lib::text::words(text);["god","heaven","created"].iter().all(|term|words.iter().any(|word|word==term))}).count();
    assert_eq!(page.total,expected);assert_eq!(page.total,2);
    println!("Saved chained searches: God, heaven, created; {} verses",page.total);

    for (text,partial) in [("God",false),("od",true),("In the beginning",false)] {
        let filters=kjv_reader_lib::occurrences::prepared::VerseFilters {text:Some(text.into()),partial,..Default::default()};
        let query=kjv_reader_lib::bible::SearchQuery {text:text.into(),book:None,phrase:true,partial,offset:0,normalized_words:false,included_books:None,count_sort:None};
        let expected=bible.search(&query);
        let before=Instant::now(); let page=verses.page_filtered(None,0,&filters)?;
        assert_eq!(page.total,expected.total);
        assert_eq!(page.entries.iter().map(|entry|(&entry.verse.book,entry.verse.chapter,entry.verse.number)).collect::<Vec<_>>(),expected.verses.iter().map(|entry|(&entry.verse.book,entry.verse.chapter,entry.verse.number)).collect::<Vec<_>>());
        println!("Saved verse search {text:?}, partial={partial}: {:?}, {} verses",before.elapsed(),page.total);
    }

    assert_eq!(verses.page(None, 0)?.total, 31_102);
    let frequencies=[1usize,2,7,22,63919];
    let expected_frequency_rows:Vec<_>=bible.located_passages().map(|(book,chapter,number,text)| {
        let mut counts=[0usize;5];
        for word in kjv_reader_lib::text::words(text) {
            let frequency=words.find_normalized(&word).unwrap().count;
            if let Some(index)=frequencies.iter().position(|&value|value==frequency) {counts[index]+=1;}
        }
        (format!("{book} {chapter}:{number}"),counts)
    }).collect();
    for frequency in [1usize,22,63919] {
        let column=frequencies.iter().position(|&n|n==frequency).unwrap();
        for direction in ["asc","desc"] {
            let mut expected:Vec<_>=(0..expected_frequency_rows.len()).collect();
            expected.sort_by(|&left,&right| {
                let cmp=expected_frequency_rows[left].1[column].cmp(&expected_frequency_rows[right].1[column]);
                (if direction=="desc"{cmp.reverse()}else{cmp}).then(left.cmp(&right))
            });
            for offset in [0usize,50] {
                let query=serde_json::from_value::<kjv_reader_lib::occurrences::prepared::VerseFrequencyQuery>(serde_json::json!({"frequencies":frequencies,"sort":{"frequency":frequency,"direction":direction},"offset":offset}))?;
                let before=Instant::now();let page=verses.frequency_page(&query)?;
                println!("Verse frequency {frequency} {direction}, offset {offset}: {:?}",before.elapsed());
                assert_eq!(page.total,expected.len());
                for (entry,&id) in page.entries.iter().zip(expected.iter().skip(offset)) {
                    assert_eq!(format!("{} {}:{}",entry.verse.book,entry.verse.chapter,entry.verse.number),expected_frequency_rows[id].0);
                    assert_eq!(entry.frequency_counts,expected_frequency_rows[id].1);
                }
            }
        }
    }


    // Independent text oracle for phrase frequencies in representative verses.
    let samples:Vec<_>=bible.located_passages().enumerate().filter(|(_, (book,chapter,number,_))| (*book=="Genesis" && *chapter==1 && *number==1) || (*book=="John" && *chapter==11 && *number==35) || (*book=="Psalms" && *chapter==136 && *number==1)).map(|(id,(_,_,_,text))|(id,kjv_reader_lib::text::words(text))).collect();
    let maximum=samples.iter().map(|(_,tokens)|tokens.len().min(90)).max().unwrap();
    let mut candidate_counts=std::collections::HashMap::<Vec<String>,usize>::new();
    for (_,tokens) in &samples {for length in 2..=tokens.len().min(90) {for window in tokens.windows(length) {candidate_counts.entry(window.to_vec()).or_insert(0);}}}
    for (_,text) in bible.passages() {
        let tokens=kjv_reader_lib::text::words(text);
        for length in 2..=maximum.min(tokens.len()) {for window in tokens.windows(length) {if let Some(count)=candidate_counts.get_mut(window) {*count+=1;}}}
    }
    let phrase_frequencies=[1usize,2,7,22,6268];
    for (id,tokens) in samples {
        let mut distinct=std::collections::HashSet::new();
        for length in 2..=tokens.len().min(90) {distinct.extend(tokens.windows(length).map(|window|window.to_vec()));}
        let parents:Vec<_>=distinct.iter().cloned().collect();
        distinct.retain(|phrase|!parents.iter().any(|parent|candidate_counts.get(parent)==candidate_counts.get(phrase) && parent.len()>phrase.len() && parent.windows(phrase.len()).any(|window|window==phrase.as_slice())));
        let expected:Vec<_>=phrase_frequencies.iter().map(|frequency|distinct.iter().filter(|phrase|candidate_counts.get(*phrase)==Some(frequency)).count()).collect();
        let query=serde_json::from_value::<kjv_reader_lib::occurrences::prepared::VerseFrequencyQuery>(serde_json::json!({"offset":id,"phraseFrequencies":phrase_frequencies}))?;
        let page=verses.frequency_page(&query)?;
        assert_eq!(page.entries[0].phrase_frequency_counts,expected);
        println!("Verified phrase frequency counts for {} {}:{}",page.entries[0].verse.book,page.entries[0].verse.chapter,page.entries[0].verse.number);
    }
    let canonical_phrases:Vec<_>=(0..31_102).step_by(50).flat_map(|offset| {
        let query=serde_json::from_value::<kjv_reader_lib::occurrences::prepared::VerseFrequencyQuery>(serde_json::json!({"offset":offset,"phraseFrequencies":[1,22]})).unwrap();
        verses.frequency_page(&query).unwrap().entries
    }).collect();
    for (column,frequency) in [(0usize,1usize),(1,22)] {
        for direction in ["asc","desc"] {
            let mut expected:Vec<_>=(0..canonical_phrases.len()).collect();
            expected.sort_by(|&a,&b| {
                let cmp=canonical_phrases[a].phrase_frequency_counts[column].cmp(&canonical_phrases[b].phrase_frequency_counts[column]);
                (if direction=="desc"{cmp.reverse()}else{cmp}).then(a.cmp(&b))
            });
            for offset in [0usize,50] {
                let query=serde_json::from_value::<kjv_reader_lib::occurrences::prepared::VerseFrequencyQuery>(serde_json::json!({"offset":offset,"phraseFrequencies":[1,22],"sort":{"kind":"phrases","frequency":frequency,"direction":direction}}))?;
                let before=Instant::now();let page=verses.frequency_page(&query)?;
                println!("Phrase column {frequency} {direction}, offset {offset}: {:?}",before.elapsed());
                for (entry,&id) in page.entries.iter().zip(expected.iter().skip(offset)) {
                    assert_eq!(serde_json::to_value(entry)?,serde_json::to_value(&canonical_phrases[id])?);
                }
            }
        }
    }
    for letters in [22,44,100,999999] {
        let page = verses.page_filtered(None,0,&kjv_reader_lib::occurrences::prepared::VerseFilters {letters:Some(letters),..Default::default()})?;
        let expected = bible.passages().filter(|(_,text)|text.chars().filter(|c|c.is_alphabetic()).count()==letters).count();
        assert_eq!(page.total,expected);
        assert!(page.entries.iter().all(|entry|entry.letters==letters));
        println!("Number {letters}: {} verses with that letter count",page.total);
    }

    for (book, chapter, number) in [
        ("Genesis", 1, 1),
        ("Genesis", 1, 2),
        ("John", 11, 35),
        ("Esther", 8, 9),
    ] {
        let before = Instant::now();
        let detail = verses.detail(&store, book, chapter, number, 0)?;
        println!(
            "{book} {chapter}:{number} details: {:?}; {} phrases",
            before.elapsed(),
            detail.summary.phrases
        );
        let tokens = kjv_reader_lib::text::words(&detail.summary.verse.text);
        assert_eq!(detail.summary.words, tokens.len());
        assert_eq!(
            detail.summary.letters,
            detail
                .summary
                .verse
                .text
                .chars()
                .filter(|c| c.is_alphabetic())
                .count()
        );
        let expected: std::collections::BTreeSet<_> = (2..=tokens.len().min(90))
            .flat_map(|length| tokens.windows(length).map(|window| window.join(" ")))
            .collect();
        let visible_total = detail.phrase_results.total;
        assert_eq!(detail.summary.phrases, visible_total);
        let actual: Vec<_> = (0..visible_total)
            .step_by(50)
            .flat_map(|offset| {
                verses
                    .detail(&store, book, chapter, number, offset)
                    .unwrap()
                    .phrase_results
                    .entries
            })
            .collect();
        assert_eq!(actual.len(), visible_total);
        assert!(actual
            .windows(2)
            .all(|pair| pair[0].phrase < pair[1].phrase));
        assert!(actual.iter().all(|entry| expected.contains(&entry.phrase)));
        let present: std::collections::HashSet<_> =
            actual.iter().map(|entry| entry.phrase.as_str()).collect();
        // Every hidden phrase must have a longer retained parent with the same count.
        let parents: Vec<_> = actual.iter().collect();
        for missing in expected
            .iter()
            .filter(|phrase| !present.contains(phrase.as_str()))
        {
            let occurrences=store.detail(&bible,missing,0)?.occurrences;
            assert!(parents.iter().any(|parent| parent.occurrences as usize==occurrences && parent.words as usize
                > kjv_reader_lib::text::words(missing).len()
                && format!(" {} ", parent.phrase).contains(&format!(" {missing} "))));
        }
        for entry in &actual {
            assert!(detail
                .summary
                .verse
                .text
                .contains(entry.display.as_ref().unwrap()));
            assert_eq!(
                kjv_reader_lib::text::words(entry.display.as_ref().unwrap()).join(" "),
                entry.phrase
            );
        }
        // Every sort is applied to the complete saved list before pagination.
        use kjv_reader_lib::detail_lists::{PhraseSort, PhraseSortField, SortDirection};
        for field in [
            PhraseSortField::Phrase,
            PhraseSortField::Occurrences,
            PhraseSortField::Books,
        ] {
            for direction in [SortDirection::Asc, SortDirection::Desc] {
                let mut expected_order: Vec<_> = actual.iter().collect();
                expected_order.sort_by(|a, b| {
                    let value = match field {
                        PhraseSortField::Phrase => a.phrase.cmp(&b.phrase),
                        PhraseSortField::Occurrences => a.occurrences.cmp(&b.occurrences),
                        PhraseSortField::Books => a.books.cmp(&b.books),
                    };
                    let order = value.then_with(|| a.phrase.cmp(&b.phrase));
                    if matches!(direction, SortDirection::Desc) {
                        order.reverse()
                    } else {
                        order
                    }
                });
                let sorted_page = verses.detail_sorted(
                    &store,
                    book,
                    chapter,
                    number,
                    0,
                    PhraseSort { field, direction },
                )?;
                assert_eq!(
                    sorted_page
                        .phrase_results
                        .entries
                        .iter()
                        .map(|entry| entry.phrase.as_str())
                        .collect::<Vec<_>>(),
                    expected_order
                        .iter()
                        .take(50)
                        .map(|entry| entry.phrase.as_str())
                        .collect::<Vec<_>>()
                );
            }
        }
        assert_eq!(detail.summary.phrases,actual.len());
        let parent = actual.iter().max_by_key(|entry| entry.words).unwrap();
        let parent_text = parent.display.as_ref().unwrap();
        let before = Instant::now();
        let contents = store.contents(parent_text, &words)?;
        assert!(contents.subphrase_results.entries.iter().all(|entry|entry.occurrences>1));
        println!(
            "Saved words and subphrases: {:?}; {} words, {} subphrases",
            before.elapsed(),
            contents.word_entries.len(),
            contents.subphrase_results.total
        );
        let before = Instant::now();
        let reused = store.contents(parent_text, &words)?;
        println!("Reused phrase contents: {:?}", before.elapsed());
        assert_eq!(
            serde_json::to_value(contents)?,
            serde_json::to_value(reused)?
        );
        let utf16: Vec<_> = detail.summary.verse.text.encode_utf16().collect();
        let word_links: Vec<_> = detail
            .word_parts
            .iter()
            .map(|part| {
                String::from_utf16(&utf16[part.start as usize..part.end as usize])
                    .unwrap()
                    .to_lowercase()
            })
            .collect();
        assert_eq!(word_links, tokens);
        assert_eq!(
            detail
                .word_parts
                .iter()
                .map(|part| part.word.clone())
                .collect::<Vec<_>>(),
            tokens
        );
    }
    let mut last_words=std::collections::HashMap::<String,(String,u16,u16,usize)>::new();
    for (book,chapter,number,text) in bible.located_passages() {
        for (position,word) in kjv_reader_lib::text::words(text).into_iter().enumerate() {last_words.insert(word,(book.into(),chapter,number,position));}
    }
    for (book, chapter) in [("Genesis", 1), ("Genesis", 2), ("John", 11),("Revelation",22),("Daniel",4)] {
        let before = Instant::now();
        let highlights = verses.highlights(&store, &words, &books, book, chapter)?;
        println!(
            "{book} {chapter} saved highlight metadata: {:?}",
            before.elapsed()
        );
        let saved_book = books.get(book)?;
        let saved_chapter = saved_book
            .chapters
            .iter()
            .find(|entry| entry.chapter == chapter)
            .unwrap();
        for verse in &highlights.verses {
            let detail=verses.detail(&store,book,chapter,verse.number,0)?;
            assert_eq!(verse.phrases.len(),detail.summary.phrases);
            let listed:Vec<_>=(0..detail.phrase_results.total).step_by(50).flat_map(|offset|verses.detail(&store,book,chapter,verse.number,offset).unwrap().phrase_results.entries).collect();
            let mut expected_counts:Vec<_>=listed.iter().map(|phrase|phrase.occurrences as usize).collect();let mut actual_counts:Vec<_>=verse.phrases.iter().map(|phrase|phrase.count).collect();expected_counts.sort();actual_counts.sort();assert_eq!(actual_counts,expected_counts);
            let text=detail.summary.verse.text;let units:Vec<_>=text.encode_utf16().collect();
            for phrase in &verse.phrases {let text=String::from_utf16(&units[phrase.start as usize..phrase.end as usize])?;assert_eq!(store.detail(&bible,&text,0)?.occurrences,phrase.count);}

            let mut seen = std::collections::HashSet::new();
            for (position,word) in verse.words.iter().enumerate() {
                let expected = words.get(&word.word)?;
                assert_eq!(word.count, expected.count);
                assert_eq!(
                    word.exclusive,
                    saved_chapter
                        .exclusive_words
                        .iter()
                        .any(|entry| entry.word == word.word)
                );
                let first = &expected.first_mention;
                assert_eq!(word.last_mention,last_words.get(&word.word)==Some(&(book.to_owned(),chapter,verse.number,position)));
                assert_eq!(
                    word.first_mention,
                    first.book == book
                        && first.chapter == chapter
                        && first.number == verse.number
                        && seen.insert(word.word.clone())
                );
            }
        }
    }

    let example="band of iron and brass in the tender grass of the field and let it be";
    let longest="in the earth even with a band of iron and brass in the tender grass of the field and let it be wet with the dew of heaven and let his portion be with the beasts";
    assert_eq!(store.detail(&bible,example,0)?.occurrences,2);
    let page=store.page(0,&PhraseFilters {text:Some(example.into()),occurrences:Some(2),..Default::default()})?;
    assert_eq!(page.total,1);assert_eq!(page.entries[0].phrase,longest);assert_eq!(page.entries[0].words,36);
    for number in [15u16,23] {
        let detail=verses.detail(&store,"Daniel",4,number,0)?;
        let listed:Vec<_>=(0..detail.phrase_results.total).step_by(50).flat_map(|offset|verses.detail(&store,"Daniel",4,number,offset).unwrap().phrase_results.entries).collect();
        assert_eq!(detail.summary.phrases,listed.len());assert!(listed.iter().any(|entry|entry.phrase==longest));
        assert!(!listed.iter().any(|entry|entry.phrase==example));
    }
    println!("Verified Daniel equal-count rollup: one 36-word phrase, two occurrences.");
    let total = store.page(0, &PhraseFilters::default())?.total;
    assert_eq!(total, 182_550);
    assert_eq!(store.page(0,&PhraseFilters {occurrences:Some(1),..Default::default()})?.total,30_560);
    println!("Verified packaged data: {total} phrases, every analysis length, statistics, and matching verses. No files generated.");
    Ok(())
}
