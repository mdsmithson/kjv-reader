//! Prepared verse text forms let arbitrary searches reuse saved normalization.
use super::*;
#[derive(Default, Serialize, Deserialize)]
pub(super) struct VerseSearchIndex {
    format: u32,
    fingerprint: String,
    words: Vec<String>,
    texts: Vec<String>,
}
pub(super) struct TextQuery { needle: String, partial: bool }
impl VerseSearchIndex {
    pub(super) fn read(root: &Path, manifest: &VerseManifest) -> io::Result<Self> {
        let index:Self=read_json(&root.join("verse-search.json"))?;
        if index.format!=1 || index.fingerprint!=manifest.fingerprint || index.words.len()!=manifest.total || index.texts.len()!=manifest.total { return Err(invalid("Incomplete saved verse search data")); }
        Ok(index)
    }
    pub(super) fn query(filters: &VerseFilters) -> Vec<TextQuery> {
        filters.text.as_deref().map(|text|(text,filters.partial)).into_iter().chain(filters.searches.iter().map(|filter|(filter.text.as_str(),filter.partial))).filter_map(|(text,partial)| {
            let text=text.trim(); if text.is_empty() {return None;}
            Some(TextQuery {needle:if partial {text.to_lowercase()} else {crate::text::word_text(text)},partial})
        }).collect()
    }
    pub(super) fn matches(&self,id:usize,queries:&[TextQuery])->bool {
        queries.iter().all(|query| {
            if !query.partial && query.needle=="  " {return false;}
            let text=if query.partial {&self.texts[id]} else {&self.words[id]};
            text.contains(&query.needle)
        })
    }
}
pub(super) fn prepare(root:&Path)->io::Result<()> {
    let manifest:VerseManifest=read_json(&root.join("verses.json"))?;
    if VerseSearchIndex::read(root,&manifest).is_ok() {return Ok(());}
    let index=VerseSearchIndex {format:1,fingerprint:manifest.fingerprint,words:manifest.entries.iter().map(|entry|crate::text::word_text(&entry.summary.verse.text)).collect(),texts:manifest.entries.iter().map(|entry|entry.summary.verse.text.to_lowercase()).collect()};
    let temporary=root.join("verse-search.tmp");
    json_file(&temporary,&index)?;
    fs::rename(temporary,root.join("verse-search.json"))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_partial_search_reuses_saved_text_and_combines_with_paging_and_counts() {
        let root=std::env::temp_dir().join(format!("kjv-verse-text-{}",SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        let source:serde_json::Map<String,serde_json::Value>=(1..=80).map(|n|(format!("Genesis 1:{n}"),serde_json::json!(if n%2==0 {"God, word!"} else {"godhead words"}))).chain([("Exodus 1:1".into(),serde_json::json!("God word God word"))]).collect();
        let bible=Bible::from_json(&serde_json::to_string(&source).unwrap()).unwrap();
        let index=OccurrenceIndex::from_passages(bible.located_passages(),&root.join("cache"));
        let saved=root.join("saved"); index.prepare_phrases(&saved,4).unwrap();
        let phrases=PreparedPhrases::open(&saved,&bible).unwrap(); phrases.prepare_verses(&bible).unwrap();
        let verify=|| {
            let verses=PreparedVerses::open(&saved,&bible,&phrases).unwrap();
            for (text,partial,total) in [("GOD",false,41),("god",true,81),("God, WORD",false,41),("od",false,0),("od",true,81),("!!!",false,0),("",false,81)] {
                let filters=VerseFilters {text:Some(text.into()),partial,..Default::default()};
                assert_eq!(verses.page_filtered(None,0,&filters).unwrap().total,total);
                assert_eq!(verses.page_filtered(None,50,&filters).unwrap().entries.len(),total.saturating_sub(50));
                let query=VerseFrequencyQuery {filters:filters.clone(), frequencies:vec![1],..Default::default()};
                assert_eq!(verses.frequency_page(&query).unwrap().total,total);
            }
            let reference=VerseFilters {chapter:Some(1),verse:Some(1),..Default::default()};
            let matching=verses.page_filtered(None,0,&reference).unwrap(); assert_eq!(matching.total,2);
            assert!(matching.entries.iter().all(|entry|entry.verse.chapter==1&&entry.verse.number==1));
            assert_eq!(verses.page_filtered(Some("Exodus"),0,&reference).unwrap().total,1);
            let text_reference=VerseFilters {text:Some("God".into()),..reference.clone()}; assert_eq!(verses.page_filtered(None,0,&text_reference).unwrap().total,1);
            assert_eq!(verses.frequency_page(&VerseFrequencyQuery {filters:reference.clone(),frequencies:vec![1],sort:Some(VerseFrequencySort {kind:frequency::FrequencyKind::Words,frequency:1,direction:frequency::Direction::Desc}),..Default::default()}).unwrap().total,2);
            assert_eq!(verses.page_filtered(None,0,&VerseFilters {chapter:Some(2),..reference.clone()}).unwrap().total,0);
            assert_eq!(verses.page_filtered(None,0,&VerseFilters {verse:Some(999),..reference}).unwrap().total,0);
            let mut chain=VerseFilters {text:Some("god".into()),partial:true, searches:vec![VerseSearchFilter {text:"word".into(),partial:false}],..Default::default()};
            assert_eq!(verses.page_filtered(None,0,&chain).unwrap().total,41);
            chain.searches.push(VerseSearchFilter {text:"God word God word".into(),partial:false});
            let narrow=verses.page_filtered(None,0,&chain).unwrap(); assert_eq!(narrow.total,1); assert_eq!(narrow.entries[0].verse.book,"Exodus");
            assert_eq!(verses.frequency_page(&VerseFrequencyQuery {filters:chain.clone(),frequencies:vec![1],..Default::default()}).unwrap().total,1);
            chain.searches.push(VerseSearchFilter {text:"   ".into(),partial:true}); assert_eq!(verses.page_filtered(None,0,&chain).unwrap().total,1);
            chain.words=Some(2); assert_eq!(verses.page_filtered(None,0,&chain).unwrap().total,0);
            let excluded=VerseFilters {text:Some("god".into()),searches:vec![VerseSearchFilter {text:"words".into(),partial:false}],..Default::default()};
            assert_eq!(verses.page_filtered(None,0,&excluded).unwrap().total,0);
            let filters=VerseFilters {text:Some("god".into()),words:Some(4),..Default::default()};
            assert_eq!(verses.page_filtered(None,0,&filters).unwrap().total,1);
            assert_eq!(verses.page_filtered(Some("Genesis"),0,&filters).unwrap().total,0);
            let filters=VerseFilters {text:Some("god".into()),..Default::default()};
            let asc=verses.frequency_page(&VerseFrequencyQuery {filters:filters.clone(),frequencies:vec![1],sort:Some(VerseFrequencySort {kind:frequency::FrequencyKind::Words,frequency:1,direction:frequency::Direction::Asc}),..Default::default()}).unwrap();
            assert_eq!(asc.total,41);
            assert!(asc.entries.iter().all(|entry|entry.verse.text.to_lowercase().contains("god")));
        };
        verify(); let stamp=fs::metadata(saved.join("verse-search.json")).unwrap().modified().unwrap();
        phrases.prepare_verses(&bible).unwrap(); assert_eq!(stamp,fs::metadata(saved.join("verse-search.json")).unwrap().modified().unwrap());
        fs::write(saved.join("verse-search.json"),b"{}").unwrap(); assert!(PreparedVerses::open(&saved,&bible,&phrases).is_err());
        phrases.prepare_verses(&bible).unwrap(); verify(); fs::remove_dir_all(root).unwrap();
    }
}
