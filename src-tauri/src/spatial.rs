//! Streaming positional summaries. Repeated matches in one verse do not extend runs.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct Position {
    pub book: u128,
    pub chapter: u16,
    pub verse: u16,
}

#[derive(Default)]
pub struct Spatial {
    last: Option<Position>,
    verse_run: u16,
    chapter_run: u16,
    pub chapters: u32,
    pub max_verse_run: u16,
    pub max_chapter_run: u16,
    current_chapter_count: u32,
    pub chapter_frequencies: Vec<u32>,
}

impl Spatial {
    pub fn observe(&mut self, position: Position) {
        let same_chapter = self.last.is_some_and(|last| {
            last.book == position.book && last.chapter == position.chapter
        });
        if self.last != Some(position) {
            let neighboring_verse = self.last.is_some_and(|last| {
                same_chapter && last.verse.checked_add(1) == Some(position.verse)
            });
            self.verse_run = if neighboring_verse { self.verse_run + 1 } else { 1 };
            self.max_verse_run = self.max_verse_run.max(self.verse_run);
        }
        if !same_chapter {
            self.chapters += 1;
            if self.current_chapter_count > 0 {
                self.chapter_frequencies.push(self.current_chapter_count);
            }
            self.current_chapter_count = 0;
            let neighboring_chapter = self.last.is_some_and(|last| {
                last.book == position.book && last.chapter.checked_add(1) == Some(position.chapter)
            });
            self.chapter_run = if neighboring_chapter { self.chapter_run + 1 } else { 1 };
            self.max_chapter_run = self.max_chapter_run.max(self.chapter_run);
        }
        self.current_chapter_count += 1;
        self.last = Some(position);
    }

    pub fn finish(&mut self) {
        if self.current_chapter_count > 0 {
            self.chapter_frequencies.push(self.current_chapter_count);
            self.current_chapter_count = 0;
        }
        self.chapter_frequencies.sort_unstable();
        self.chapter_frequencies.dedup();
    }
}
