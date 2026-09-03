# TikTokHelper

[Simplified Chinese](README.zh-CN.md)

Provide Feedback: [supportURL](https://github.com/zimabx/TikTokHelper/issues)

TikTokHelper is a browser userscript for TikTok Web. It adds a compact action panel to TikTok pages so you can save media, capture video frames, inspect post metadata, and customize filenames without leaving the current page.

<p align="left">
  <img width="200" alt="image" src="https://raw.githubusercontent.com/zimabx/TikTokHelper/main/src/img/th_download_btn.png" />
</p>

---

## Features

- Download the current video or photo post.
- Capture the current video frame.
- View media information for the current post.
- Batch-download posts from profile pages.
- Translate comments.
- Save images from the comments section.
- Choose a preferred video source.
- Customize download filenames with templates.
- Configure keyboard shortcuts.

<p align="left">
  <img width="300" alt="image" src="https://raw.githubusercontent.com/zimabx/TikTokHelper/main/src/img/th_homepage_dlbtn.png" />
</p>

## Installation

To open the [TikTokHelper](https://greasyfork.org/zh-CN/scripts/586881-tiktokhelper) file, you'll need to install the Tampermonkey extension first.

## Usage

After installation, TikTokHelper adds a small floating button near the active TikTok media area. Open it to access:

- **Download**: saves the current video, or all images from a photo post.
- **Video Frame**: captures the currently visible video frame and lets you copy or save it.
- **Details**: opens a tabbed inspector for media resources, author data, post data, and raw JSON.
- **Settings**: changes language, automatic theme behavior, video quality preference, filename rules, source columns, and shortcuts.
- **Translate**: Click the translate button to the right of the input field to translate the current comment.

The default download shortcut is `M`. Other shortcuts are disabled by default and can be configured in Settings.

## Release Notes

<details>
  <summary>1.1.X</summary>

<h3>1.1.3 Upcoming</h3>
<ul>
<li>Optimized the black splash screen to reduce white flickering during loading. </li>
<li>Relaxed the download host restrictions to prevent download failures caused by newly added or switched CDN domains. </li>
</ul>
<h3>1.1.2</h3>
<ul>
<li>Added settings for comment translation activation, supporting manual and automatic activation.</li>
<li>The startup page settings have been changed to a drop-down menu, supporting the original and dark startup pages.</li>
<li>Unified the “Batch Download” button on user profiles with the download icon on video pages.</li>
<li>Added a feature to download comment stickers; tapping a sticker allows you to download the original file directly.</li>
<li>Fixed an issue where live stream content was not recognized on the Recommendations page.</li>
</ul>
<h3>1.1.1</h3>
<ul>
<li>Adjusted the download button position in fullscreen mode. It now appears below the More button.</li>
<li>Added a dark startup page that changes the initial white loading background to black.</li>
</ul>
<h3>1.1.0</h3>
<ul>
<li>Added PNG / JPG / WEBP formats for frame saving, with an improved frame copy and save workflow.</li>
<li>Added retry support for failed profile bulk downloads, retrying only failed posts or album images.</li>
<li>Added --Continue Download-</li>
<li>after cancelling a profile bulk download, automatically skipping completed posts and images.</li>
<li>Downloads can now abort the active network transfer instead of only stopping subsequent tasks.</li>
<li>Improved comment translation with batch translation and better caching, reducing duplicate requests and improving performance for large comment sections.</li>
<li>Improved translation result detection and caching for unchanged or untranslated text.</li>
<li>Improved album download and retry logic so only failed or unfinished images are downloaded again.</li>
<li>Improved profile post resolution by reusing available local page data before performing additional scans.</li>
<li>Fixed frame capture occasionally targeting a neighboring video instead of the current post.</li>
<li>Fixed incorrect Live frame filenames and the accidental use of regular post metadata for Live captures.</li>
<li>Fixed inconsistent file extensions between main downloads and downloads from the details panel.</li>
<li>Fixed incorrect fallback handling for some image file extensions.</li>
<li>Fixed duplicate shortcut conflicts and added clear conflict warnings.</li>
<li>Improved status and progress feedback for downloads, cancellations, partial failures, retries, and resumed downloads.</li>
<li>Improved filename generation, album numbering, and multiple UI interaction details.</li>
<li>Removed redundant code and unnecessary work to improve overall performance and stability.</li>
</ul>
</details>

## Other

This is not an official TikTok product. Use it only for content you have the right to save.

## License

MIT
