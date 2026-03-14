use anyhow::{anyhow, Context, Result};
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, ACCEPT_LANGUAGE, REFERER, USER_AGENT};
use reqwest::Client;
use scraper::{Html, Selector};
use serde::Serialize;
use url::Url;

#[derive(Debug, Serialize)]
pub struct CatalogChapter {
    pub title: String,
    pub url: String,
    pub number: Option<String>,
}

pub struct WebtoonFetcher {
    client: Client,
}

impl WebtoonFetcher {
    pub fn new() -> Result<Self> {
        let mut headers = HeaderMap::new();
        headers.insert(
            USER_AGENT,
            HeaderValue::from_static(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
            ),
        );
        headers.insert(ACCEPT, HeaderValue::from_static("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"));
        headers.insert(ACCEPT_LANGUAGE, HeaderValue::from_static("fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7"));
        headers.insert(REFERER, HeaderValue::from_static("https://sushiscan.fr/"));

        let client = Client::builder().default_headers(headers).build()?;
        Ok(Self { client })
    }

    pub async fn fetch_catalog(&self, catalog_url: &str) -> Result<Vec<CatalogChapter>> {
        let base = Url::parse(catalog_url).context("URL de catalogue invalide")?;
        let resp = self
            .client
            .get(catalog_url)
            .send()
            .await
            .context("Impossible de charger le catalogue webtoon")?
            .error_for_status()?;
        let body = resp.text().await?;
        let document = Html::parse_document(&body);
        let card_selector = Selector::parse(
            ".eplister ul li a, .list-chapters a, .chapters-wrapper a, .series-chapters a",
        )
        .unwrap();
        let chap_selector = Selector::parse(".chapternum").unwrap();
        let mut chapters = Vec::new();
        for element in document.select(&card_selector) {
            if let Some(href) = element.value().attr("href") {
                let title_node = element
                    .select(&chap_selector)
                    .next()
                    .map(|node| node.text().collect::<String>());
                let fallback = element.text().collect::<Vec<_>>().join(" ");
                let title = title_node.unwrap_or_else(|| fallback.clone()).trim().to_string();
                if title.is_empty() {
                    continue;
                }
                let number = title
                    .split_whitespace()
                    .find(|part| part.chars().any(|c| c.is_numeric()))
                    .map(|s| s.to_string());
                let absolute = base
                    .join(href)
                    .unwrap_or_else(|_| href.parse().unwrap_or_else(|_| base.clone()))
                    .to_string();
                let absolute = base
                    .join(href)
                    .unwrap_or_else(|_| href.parse().unwrap_or_else(|_| base.clone()))
                    .to_string();
                chapters.push(CatalogChapter {
                    title,
                    url: absolute,
                    number,
                });
            }
        }
        chapters.dedup_by(|a, b| a.url == b.url);
        if chapters.is_empty() {
            return Err(anyhow!("Aucun chapitre webtoon détecté"));
        }
        Ok(chapters)
    }

    pub async fn fetch_chapter_images(&self, chapter_url: &str) -> Result<Vec<String>> {
        let base = Url::parse(chapter_url).context("URL de chapitre invalide")?;
        let resp = self
            .client
            .get(chapter_url)
            .send()
            .await
            .context("Impossible de charger le chapitre webtoon")?
            .error_for_status()?;
        let body = resp.text().await?;
        let document = Html::parse_document(&body);
        let img_selector = Selector::parse("article img, .reading-content img").unwrap();
        let mut images = Vec::new();
        for img in document.select(&img_selector) {
            if let Some(src) = img.value().attr("data-src").or_else(|| img.value().attr("src")) {
                let trimmed = src.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if let Ok(full) = base.join(trimmed) {
                    images.push(full.to_string());
                } else if trimmed.starts_with("http") {
                    images.push(trimmed.to_string());
                }
            }
        }
        if images.is_empty() {
            return Err(anyhow!("Aucune image détectée dans ce chapitre"));
        }
        Ok(images)
    }

    pub async fn fetch_image_bytes(&self, url: &str) -> Result<Vec<u8>> {
        let resp = self
            .client
            .get(url)
            .send()
            .await
            .with_context(|| format!("Impossible de télécharger {url}"))?
            .error_for_status()?;
        Ok(resp.bytes().await?.to_vec())
    }
}
