# TikTokHelper

[简体中文](README.zh-CN.md)

TikTokHelper is a browser userscript for TikTok Web. It adds a compact action panel to TikTok pages so you can save media, capture video frames, inspect post metadata, and customize filenames without leaving the current page.

> TikTokHelper is an independent userscript and is not affiliated with TikTok. Use it only for content you are allowed to access and save.

---

## Features

- Download the current video.
- Capture the current video frame.
- View media information for the current post.
- Choose a preferred video source.
- Customize download filenames with templates.
- Configure keyboard shortcuts.
- Use the browser download flow.

## Installation

Save the `TikTokHelper.js` file and use it in Tampermonkey.

## Usage

After installation, TikTokHelper adds a small floating button near the active TikTok media area. Open it to access:

- **Download**: saves the current video, or all images from a photo post.
- **Video Frame**: captures the currently visible video frame and lets you copy or save it.
- **Details**: opens a tabbed inspector for media resources, author data, post data, and raw JSON.
- **Settings**: changes language, theme, video quality preference, filename rules, source columns, and shortcuts.

The default download shortcut is `M`. Other shortcuts are disabled by default and can be configured in Settings.

## License

MIT
