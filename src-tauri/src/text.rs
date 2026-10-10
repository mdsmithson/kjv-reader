//! Shared normalization for frequency counting and opening counted phrases.
pub fn words(text: &str) -> Vec<String> {
    text.split(|character: char| !character.is_alphanumeric() && character != '\'')
        .map(|word| word.trim_matches('\''))
        .filter(|word| !word.is_empty())
        .map(str::to_lowercase)
        .collect()
}

pub fn word_text(text: &str) -> String {
    format!(" {} ", words(text).join(" "))
}
