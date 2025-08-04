> [!WARNING]  
> **Archived**: As of July 2025, YouTube no longer provides transcripts through any publicly accessible or legitimate means. This extension is currently non-functional and has been archived. It may be unarchived in the future if legitimate access to transcripts becomes available again.

<h1 align="center">
YouTube CC Fuzzy Search
</h1>

<p align="center">
<a href="https://chromewebstore.google.com/detail/youtube-cc-fuzzy-search/mgendgdloioichnbdggieldkibmkdkjp"><img src="https://github.com/user-attachments/assets/b8cc71d2-a47c-4d48-9da5-fd1203362a4f" width="206" height="58" alt="Get YouTube CC Fuzzy Search for Chrome"></a>
<a href="https://addons.mozilla.org/firefox/addon/youtube-cc-fuzzy-search/"><img src="https://github.com/user-attachments/assets/6fd35390-5b9f-441a-ba6a-e1a90b4d540b" width="206" height="58" alt="Get YouTube CC Fuzzy Search for Firefox"></a>
</p>

***

A browser extension that enables fuzzy search through YouTube video subtitles (Closed Captions).

- The **Fuzzy Search** find words and phrases in video captions even with typos or partial matches
- Clicking on search results te video automatically **Jump to Timestamp** 
- Search results are shown with surrounding **Caption Context** for better understanding
- **Real-time Search** update results as you type with minimal delay

## Feature Roadmap
- [x] Custom ordering
- [x] Dark mode
- [x] Shortcut to open extension (Ctrl+Shift+U)
- [ ] Add settings for parameters

## Installation

### Chromium
[Chrome Web Store][Chrome]

### Firefox (Gecko)
[Firefox Add-ons][Firefox]

### Manual Installation

#### Chrome / Edge / Chromium-based browsers
1. Download this repository as ZIP and extract it
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" using the toggle in the top-right corner
4. Click "Load unpacked" button in the top-left
5. Select the `chrome` directory from the extracted files

#### Firefox / Zen
1. Download this repository as ZIP and extract it
2. Navigate inside of the `firefox` folder and ZIP all the files in there
2. Open Firefox and navigate to `about:addons`
3. Click "Install add-on from file" using the settings icon on the top-right
4. Navigate to the `firefox` folder and select the ZIP file created earlier

## Contribution

The extension is built using vanilla JavaScript and HTML/CSS without external dependencies (except for the fuzzy search library).

Any kind of contributions are welcomed!

- Open an [issue][GitHub Issues] with detailed information to **Report Bugs**.
- Create an [issue][GitHub Issues] to discuss **New Features**.
- Fork the repository, make your changes, and submit a **pull request**.

When contributing code, please maintain the vanilla structure of the project without introducing additional frameworks or unnecessary dependencies.

## Acknowledgements

The fuzzy search is powered by [fuzzysort](https://github.com/farzher/fuzzysort), a fast and powerful JavaScript fuzzy search library.



<!-------------------------------------------------->
[Chrome]: https://chromewebstore.google.com/detail/youtube-cc-fuzzy-search/mgendgdloioichnbdggieldkibmkdkjp
[Firefox]: https://addons.mozilla.org/firefox/addon/youtube-cc-fuzzy-search/
[GitHub Issues]: https://github.com/lorenzozane/youtube-cc-fuzzy-search/issues
