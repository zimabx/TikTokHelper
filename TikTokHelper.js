// ==UserScript==
// @name            TikTokHelper
// @namespace       https://github.com/zimabx/TikTokHelper
// @version         0.4.0
// @description     Add download tools to TikTok web pages.
// @author          zimabx
// @match           https://*.tiktok.com/*
// @icon            https://www.google.com/s2/favicons?sz=64&domain=tiktok.com
// @license         MIT
// @require         https://cdn.jsdelivr.net/npm/htm@3/preact/standalone.umd.js
// @grant           GM_xmlhttpRequest
// @connect         *
// @run-at          document-start
// ==/UserScript==

(function (root) {
  "use strict";

  const SCRIPT_PREFIX = "tthelper";
  const CONFIG_KEY = "__tthelper-user-js__";
  const gmXmlHttpRequest =
    typeof GM_xmlhttpRequest !== "undefined"
      ? GM_xmlhttpRequest
      : root?.GM_xmlhttpRequest;
  const MEDIA_READY_ATTEMPTS = 6;
  const MEDIA_READY_INTERVAL_MS = 120;
  const MEDIA_READY_COLD_START_ATTEMPTS = 24;
  const MEDIA_READY_COLD_START_INTERVAL_MS = 200;
  const MEDIA_READY_COLD_START_WINDOW_MS = 8000;
  
  const DEFAULT_VIDEO_SOURCE_COLUMNS = ["quality", "resolution", "codec", "fps", "bitrate", "size"];
  const VIDEO_SOURCE_COLUMN_DEFINITIONS = [
    { key: "quality", messageKey: "quality" },
    { key: "resolution", messageKey: "resolution" },
    { key: "codec", messageKey: "codec" },
    { key: "fps", messageKey: "fps" },
    { key: "bitrate", messageKey: "bitrate_kbps" },
    { key: "size", messageKey: "size" },
    { key: "gearName", messageKey: "gear_name" },
    { key: "qualityType", messageKey: "quality_type" },
    { key: "width", messageKey: "width" },
    { key: "height", messageKey: "height" },
    { key: "format", messageKey: "format" },
    { key: "urlId", messageKey: "url_id" },
  ];

  const DEFAULT_CONFIG = {
    filename_template: "${nickname}_${short_id}_${tags}_${desc}",
    filename_max_length: 80,
    album_index_format: "_01",
    video_quality: "highest_resolution",
    video_source_columns: [...DEFAULT_VIDEO_SOURCE_COLUMNS],
    download_method: "browser",
    language: "auto",
    theme: "auto",
    shortcut_download: "M",
    shortcut_frame: "",
    shortcut_details: "",
    shortcut_settings: "",
  };

  const FILENAME_TEMPLATE_FIELDS = [
    {
      name: "id",
      en: "Video ID",
      zh: "视频 ID",
      description_en: "The full TikTok video identifier.",
      description_zh: "完整的 TikTok 视频 ID。",
    },
    {
      name: "video_id",
      en: "Video ID alias",
      zh: "视频 ID 别名",
      description_en: "Alias of id, kept for readable templates.",
      description_zh: "id 的别名，便于模板表达。",
    },
    {
      name: "short_id",
      en: "Short ID",
      zh: "短 ID",
      description_en: "A compact base36 version of the video ID.",
      description_zh: "视频 ID 的短 base36 形式。",
    },
    {
      name: "nickname",
      en: "Nickname",
      zh: "昵称",
      description_en: "Creator display name; falls back to unique_id.",
      description_zh: "作者显示昵称；没有昵称时使用 unique_id。",
    },
    {
      name: "unique_id",
      en: "Unique ID",
      zh: "账号名",
      description_en: "Creator handle from the TikTok URL/profile.",
      description_zh: "作者 TikTok 主页或 URL 中的账号名。",
    },
    {
      name: "desc",
      en: "Description",
      zh: "描述",
      description_en: "Video caption text.",
      description_zh: "视频文案描述。",
    },
    {
      name: "tags",
      en: "Tags",
      zh: "标签",
      description_en: "Hashtags joined with hyphens.",
      description_zh: "视频标签，多个标签会用连字符连接。",
    },
    {
      name: "music_name",
      en: "Music",
      zh: "音乐名",
      description_en: "The audio track title when TikTok exposes it.",
      description_zh: "TikTok 提供的音乐标题。",
    },
    {
      name: "create_date_YYYYMMDD",
      en: "Create date",
      zh: "发布日期",
      description_en: "Video creation date formatted as YYYYMMDD.",
      description_zh: "视频发布日期，格式为 YYYYMMDD。",
    },
    {
      name: "create_date_YYYY_MM_DD",
      en: "Create date dashed",
      zh: "发布日期-横线",
      description_en: "Video creation date formatted as YYYY-MM-DD.",
      description_zh: "视频发布日期，格式为 YYYY-MM-DD。",
    },
    {
      name: "now_YYYYMMDD_HHmmss",
      en: "Download time",
      zh: "下载时间",
      description_en: "Current time when the filename is generated.",
      description_zh: "生成文件名时的当前时间。",
    },
    {
      name: "media",
      en: "Raw media object",
      zh: "原始媒体对象",
      description_en: "Raw media object serialized if inserted into a filename.",
      description_zh: "插入文件名时会序列化的原始媒体对象。",
    },
  ];

  const FILENAME_TEMPLATE_SEPARATORS = [
    { value: "_", display: "_", en: "Underscore", zh: "下划线" },
    { value: "-", display: "-", en: "Hyphen", zh: "连字符" },
    { value: ".", display: ".", en: "Dot", zh: "点" },
    { value: " ", display: "Space", en: "Space", zh: "空格" },
  ];

  // Values only: display labels always come from t(`quality_${value}`) via getMessage(),
  // never from a second tuple element (unlike LANGUAGE_OPTIONS/THEME_OPTIONS below, whose
  // labels are shown as-is without translation).
  const VIDEO_QUALITY_OPTIONS = [
    "highest_resolution",
    "highest_bitrate",
    "1080p",
    "720p",
    "540p",
    "lowest",
  ];

  const LANGUAGE_OPTIONS = [
    ["auto", "Auto / 自动"],
    ["en", "English"],
    ["zh", "中文"],
  ];

  const THEME_OPTIONS = [
    ["auto", "Auto / 自动"],
    ["dark", "Dark / 暗黑"],
    ["light", "Light / 白天"],
  ];

  // Values only, same reasoning as VIDEO_QUALITY_OPTIONS above: label comes from
  // t(`download_method_${value}`).
  const DOWNLOAD_METHOD_OPTIONS = ["browser"];

  const ALBUM_INDEX_FORMAT_OPTIONS = [
    { value: "_01", label: "_01", template: "_{nn}" },
    { value: "_1", label: "_1", template: "_{n}" },
    { value: "-01", label: "-01", template: "-{nn}" },
    { value: "-1", label: "-1", template: "-{n}" },
    { value: "(01)", label: "(01)", template: "({nn})" },
    { value: "(1)", label: "(1)", template: "({n})" },
  ];

  const MESSAGES = {
    en: {
      menu: "TikTok Helper menu",
      download: "Download",
      download_video: "Download Video",
      download_album: "Download Album",
      download_image: "Download Image",
      details: "Details",
      settings: "Settings",
      close: "Close",
      video: "Video",
      cover: "Cover",
      dynamic_cover: "Dynamic Cover",
      music: "Music",
      copy_json: "Copy JSON",
      no_media: "No TikTok media found on this page.",
      asset_empty: "Asset URL is empty.",
      download_started: "Download started",
      download_failed: "Download failed",
      settings_saved: "Settings saved.",
      media_json_copied: "Media JSON copied.",
      settings_title: "TikTok Helper Settings",
      settings_subtitle: "Appearance, video quality, and filename rules.",
      details_title: "TikTok Helper Details",
      appearance_section: "Appearance",
      download_section: "Download",
      filename_section: "Filename",
      language: "Language",
      theme: "Theme",
      video_resolution: "Video Resolution",
      downloader: "Downloader",
      download_method_browser: "Browser",
      browser_downloads_only: "Downloader: browser",
      details_tab_json: "JSON",
      media_resources: "Media Resources",
      video_sources: "Video Sources",
      image_album: "Image Album",
      post_info: "Post Info",
      raw_json: "Raw JSON",
      url: "URL",
      open: "Open",
      quality: "Quality",
      resolution: "Resolution",
      codec: "Codec",
      bitrate: "Bitrate",
      size: "Size",
      source: "Source",
      actions: "Actions",
      duration: "Duration",
      created_at: "Created",
      unique_id: "Unique ID",
      stats: "Stats",
      hashtags: "Hashtags",
      play_count: "Views",
      digg_count: "Likes",
      comment_count: "Comments",
      share_count: "Shares",
      collect_count: "Favorites",
      no_items: "No data",
      template_mode: "Template Mode",
      available_fields: "Available attributes",
      filename_template: "Filename Template",
      filename_max_length: "Filename Max Length",
      album_index_format: "Album Increment",
      copy: "Copy",
      remove: "Remove",
      reset: "Reset",
      save: "Save",
      cancel: "Cancel",
      id: "ID",
      author: "Author",
      description: "Description",
      time: "Time",
      file: "File",
      tooltip_language: "Choose the interface language. Auto follows your browser language.",
      tooltip_theme: "Choose the script theme. Auto follows your system color scheme.",
      tooltip_video_resolution: "Pick which TikTok video source should be preferred when multiple qualities are available.",
      tooltip_available_fields: "All filename attributes supported by this script. Click one to append its `${name}` token to the filename template.",
      tooltip_custom_template: "Plain filename template. Click an available attribute below to append it at the end. Example: `${nickname}_${short_id}_${desc}`.",
      tooltip_filename_max_length: "Maximum filename length before the extension is added. Invalid filename characters are replaced automatically.",
      tooltip_album_index_format: "Numbering style appended to each image in an album.",
      tooltip_browser_downloads_only: "Downloads use the browser flow with a userscript request fallback. Additional host settings are intentionally omitted.",
      quality_highest_resolution: "Highest resolution",
      quality_highest_bitrate: "Highest bitrate",
      quality_1080p: "1080p",
      quality_720p: "720p",
      quality_540p: "540p",
      quality_lowest: "Lowest resolution",
      // -- merged from former Object.assign(MESSAGES.en, {...}) patch blocks --
      details_tab_media: "Media Resources",
      details_tab_author: "Author Info",
      details_tab_post: "Post Info",
      video_cover: "Video Cover",
      background_music: "Background Music",
      author_info: "Author Info",
      data_stats: "Data Stats",
      id_info: "ID Info",
      permissions_status: "Permissions / Status",
      new_tab_open: "Open in new tab",
      download_cover: "Download cover",
      fps: "Frame Rate",
      bitrate_kbps: "Bitrate (kbps)",
      select_all: "Select all",
      console_log: "Console Log",
      json_logged: "JSON written to console.",
      copied: "Copied.",
      uid: "UID",
      sec_uid: "SecUID",
      nickname: "Nickname",
      avatar: "Avatar",
      visit_profile: "Visit profile",
      verification: "Verification",
      followers: "Followers",
      likes_received: "Likes received",
      share_link: "Share link",
      video_id: "Video ID",
      group_id: "Group ID",
      allow_comment: "Allow comments",
      allow_share: "Allow share",
      allow_download: "Allow download",
      allow_duet: "Allow duet",
      allow_stitch: "Allow Stitch",
      private_video: "Private video",
      yes: "Yes",
      no: "No",
      frame_capture: "Video Frame",
      frame_title: "Video Frame",
      copy_frame: "Copy image",
      save_frame: "Save image",
      frame_copied: "Frame copied.",
      frame_copy_failed: "Frame copy failed.",
      frame_failed: "Could not capture the current frame.",
      frame_copy_unsupported: "Image clipboard copy is unavailable in this browser.",
      filename_preview: "Current filename",
      downloader_config: "Downloader",
      video_download_settings: "Video Download Settings",
      browser_downloader_note: "Only browser downloads are enabled. External downloader host settings are hidden.",
      source_properties: "Available source properties",
      source_columns: "Video source columns",
      shortcut_section: "Shortcuts",
      shortcut_download: "Download shortcut",
      shortcut_frame: "Video frame shortcut",
      shortcut_details: "Details shortcut",
      shortcut_settings: "Settings shortcut",
      shortcut_hint: "Focus a shortcut field and press a key combination. Backspace clears it.",
      gear_name: "Gear name",
      quality_type: "Quality type",
      width: "Width",
      height: "Height",
      format: "Format",
      url_id: "URL ID",
      template: "Template",
    },
    zh: {
      menu: "TikTok Helper 菜单",
      download: "下载",
      download_video: "下载视频",
      download_album: "下载图集",
      download_image: "下载图片",
      details: "详情",
      settings: "设置",
      close: "关闭",
      video: "视频",
      cover: "封面",
      dynamic_cover: "动态封面",
      music: "音乐",
      copy_json: "复制 JSON",
      no_media: "当前页面未找到 TikTok 媒体。",
      asset_empty: "资源链接为空。",
      download_started: "已开始下载",
      download_failed: "下载失败",
      settings_saved: "设置已保存。",
      media_json_copied: "媒体 JSON 已复制。",
      settings_title: "TikTok Helper 设置",
      settings_subtitle: "外观、视频质量和文件名规则。",
      details_title: "TikTok Helper 详情",
      appearance_section: "外观",
      download_section: "下载",
      filename_section: "文件名",
      language: "语言",
      theme: "主题",
      video_resolution: "视频分辨率",
      downloader: "下载器",
      download_method_browser: "浏览器",
      browser_downloads_only: "下载器：浏览器",
      details_tab_json: "JSON",
      media_resources: "媒体资源",
      video_sources: "视频源",
      image_album: "图集",
      post_info: "作品信息",
      raw_json: "原始 JSON",
      url: "链接",
      open: "打开",
      quality: "清晰度",
      resolution: "分辨率",
      codec: "编码",
      bitrate: "码率",
      size: "大小",
      source: "来源",
      actions: "操作",
      duration: "时长",
      created_at: "发布时间",
      unique_id: "账号名",
      stats: "数据",
      hashtags: "标签",
      play_count: "播放",
      digg_count: "点赞",
      comment_count: "评论",
      share_count: "分享",
      collect_count: "收藏",
      no_items: "无数据",
      template_mode: "模板模式",
      available_fields: "可用属性",
      filename_template: "文件名模板",
      filename_max_length: "文件名最大长度",
      album_index_format: "图集递增",
      copy: "复制",
      remove: "移除",
      reset: "重置",
      save: "保存",
      cancel: "取消",
      id: "ID",
      author: "作者",
      description: "描述",
      time: "时间",
      file: "文件",
      tooltip_language: "选择界面语言。自动会跟随浏览器语言。",
      tooltip_theme: "选择脚本主题。自动会跟随系统颜色模式。",
      tooltip_video_resolution: "当 TikTok 提供多个视频源时，优先选择哪一种清晰度。",
      tooltip_available_fields: "脚本支持的全部文件名属性。点击属性会把 `${name}` 追加到文件名模板末尾。",
      tooltip_custom_template: "手动填写普通文件名模板。点击下方可用属性会追加到末尾。示例：`${nickname}_${short_id}_${desc}`。",
      tooltip_filename_max_length: "扩展名前的文件名最大长度。非法文件名字符会自动替换。",
      tooltip_album_index_format: "图集中每张图片追加的序号样式。",
      tooltip_browser_downloads_only: "只使用浏览器下载，并保留用户脚本请求兜底。不显示额外主机设置。",
      quality_highest_resolution: "最高分辨率",
      quality_highest_bitrate: "最高码率",
      quality_1080p: "1080p",
      quality_720p: "720p",
      quality_540p: "540p",
      quality_lowest: "最低分辨率",
      // -- merged from former Object.assign(MESSAGES.zh, {...}) patch blocks --
      details_tab_media: "媒体资源",
      details_tab_author: "作者信息",
      details_tab_post: "作品信息",
      video_cover: "视频封面",
      background_music: "背景音乐",
      author_info: "作者信息",
      data_stats: "数据统计",
      id_info: "ID 信息",
      permissions_status: "权限 / 状态",
      new_tab_open: "新标签打开",
      download_cover: "下载封面",
      fps: "帧率",
      bitrate_kbps: "码率 (kbps)",
      select_all: "全选",
      console_log: "Console Log",
      json_logged: "JSON 已输出到控制台。",
      copied: "已复制。",
      uid: "UID",
      sec_uid: "SecUID",
      nickname: "昵称",
      avatar: "头像",
      visit_profile: "访问主页",
      verification: "认证",
      followers: "粉丝数",
      likes_received: "获赞数",
      share_link: "分享链接",
      video_id: "Video ID",
      group_id: "Group ID",
      allow_comment: "允许评论",
      allow_share: "允许分享",
      allow_download: "允许下载",
      allow_duet: "允许合拍",
      allow_stitch: "允许 Stitch",
      private_video: "私密视频",
      yes: "是",
      no: "否",
      frame_capture: "视频帧",
      frame_title: "视频帧",
      copy_frame: "复制图片",
      save_frame: "保存图片",
      frame_copied: "视频帧已复制。",
      frame_copy_failed: "复制视频帧失败。",
      frame_failed: "无法获取当前视频帧。",
      frame_copy_unsupported: "当前浏览器不可用图片剪贴板复制。",
      filename_preview: "当前文件名",
      downloader_config: "下载器",
      video_download_settings: "视频下载设置",
      browser_downloader_note: "当前仅启用浏览器下载，外部下载器主机配置已隐藏。",
      source_properties: "可用源属性",
      source_columns: "视频源列",
      shortcut_section: "快捷键",
      shortcut_download: "下载快捷键",
      shortcut_frame: "视频帧快捷键",
      shortcut_details: "详情快捷键",
      shortcut_settings: "设置快捷键",
      shortcut_hint: "聚焦快捷键输入框后按组合键。Backspace 可清空。",
      gear_name: "档位名",
      quality_type: "清晰度类型",
      width: "宽度",
      height: "高度",
      format: "格式",
      url_id: "URL ID",
      template: "模板",
    },
  };

  function resolveLanguage(config = {}, navigatorLike = root?.navigator) {
    const value = String(config.language || DEFAULT_CONFIG.language);
    if (value === "zh" || value === "en") return value;
    const language = String(navigatorLike?.language || navigatorLike?.userLanguage || "");
    return language.toLowerCase().startsWith("zh") ? "zh" : "en";
  }

  function resolveTheme(config = {}, mediaQuery = null) {
    const value = String(config.theme || DEFAULT_CONFIG.theme);
    if (value === "dark" || value === "light") return value;
    if (mediaQuery && typeof mediaQuery.matches === "boolean") {
      return mediaQuery.matches ? "dark" : "light";
    }
    try {
      return root?.matchMedia?.("(prefers-color-scheme: dark)")?.matches
        ? "dark"
        : "light";
    } catch (_err) {
      return "dark";
    }
  }

  function getMessage(key, config = {}, navigatorLike = root?.navigator) {
    const language = resolveLanguage(config, navigatorLike);
    return MESSAGES[language]?.[key] || MESSAGES.en[key] || key;
  }

  function getFilenameField(name) {
    return FILENAME_TEMPLATE_FIELDS.find((field) => field.name === name) || null;
  }

  function stripTemplateBackticks(template = "") {
    // Pure sanitizer: strips a single pair of wrapping backticks (and any stray backticks)
    // from whatever string is given. Deliberately does NOT fall back to the default
    // template when `template` is empty/falsy — callers that are editing a live textarea
    // value (appendFilenameTemplateToken/appendFilenameTemplateLiteral) need an empty
    // input to stay empty, otherwise clicking an available-field chip while the template
    // box is empty would silently prepend the default template before appending the token.
    // Callers that want "the effective template, falling back to default when unset"
    // should use getFilenameTemplate() below instead.
    const value = String(template ?? "").trim();
    let next = value;
    if (value.length >= 2 && value.startsWith("`") && value.endsWith("`")) {
      next = value.slice(1, -1);
    }
    return next.replace(/`/g, "");
  }

  function getFilenameTemplate(config = {}) {
    return stripTemplateBackticks(config.filename_template) || DEFAULT_CONFIG.filename_template;
  }

  function appendFilenameTemplateToken(template = "", field = "") {
    const name = String(field || "");
    const current = stripTemplateBackticks(template);
    if (!getFilenameField(name)) return current;
    return `${current}\${${name}}`;
  }

  function appendFilenameTemplateLiteral(template = "", literal = "") {
    return `${stripTemplateBackticks(template)}${String(literal ?? "")}`;
  }

  function getVideoSourceColumnDefinition(key) {
    return VIDEO_SOURCE_COLUMN_DEFINITIONS.find((column) => column.key === key) || null;
  }

  function normalizeVideoSourceColumns(value = DEFAULT_VIDEO_SOURCE_COLUMNS) {
    const rawColumns = Array.isArray(value)
      ? value
      : String(value || "")
          .split(",")
          .map((item) => item.trim());
    const result = [];
    for (const key of rawColumns) {
      const normalized = String(key || "").trim();
      if (!getVideoSourceColumnDefinition(normalized)) continue;
      if (!result.includes(normalized)) result.push(normalized);
    }
    return result.length ? result : [...DEFAULT_VIDEO_SOURCE_COLUMNS];
  }

  function normalizeHotkey(value = "") {
    const parts = String(value || "")
      .split("+")
      .map((part) => part.trim())
      .filter(Boolean);
    if (!parts.length) return "";
    const modifiers = new Set();
    let key = "";
    for (const part of parts) {
      const lower = part.toLowerCase();
      if (["ctrl", "control"].includes(lower)) modifiers.add("Ctrl");
      else if (lower === "shift") modifiers.add("Shift");
      else if (lower === "alt" || lower === "option") modifiers.add("Alt");
      else if (["meta", "cmd", "command", "win"].includes(lower)) modifiers.add("Meta");
      else key = part.length === 1 ? part.toUpperCase() : part;
    }
    if (!key) return "";
    return [
      modifiers.has("Ctrl") ? "Ctrl" : "",
      modifiers.has("Shift") ? "Shift" : "",
      modifiers.has("Alt") ? "Alt" : "",
      modifiers.has("Meta") ? "Meta" : "",
      key,
    ]
      .filter(Boolean)
      .join("+");
  }

  function hotkeyFromEvent(event = {}) {
    const rawKey = String(event.key || "");
    if (!rawKey || ["Control", "Shift", "Alt", "Meta"].includes(rawKey)) return "";
    if (rawKey === "Backspace" || rawKey === "Delete") return "";
    const key = rawKey.length === 1 ? rawKey.toUpperCase() : rawKey;
    return [
      event.ctrlKey ? "Ctrl" : "",
      event.shiftKey ? "Shift" : "",
      event.altKey ? "Alt" : "",
      event.metaKey ? "Meta" : "",
      key,
    ]
      .filter(Boolean)
      .join("+");
  }

  function eventMatchesHotkey(event = {}, hotkey = "") {
    const normalized = normalizeHotkey(hotkey);
    if (!normalized) return false;
    return normalizeHotkey(hotkeyFromEvent(event)) === normalized;
  }

  function captureShortcutInputKey(input, event = {}) {
    event.preventDefault?.();
    event.stopPropagation?.();
    if (!input) return "";
    if (event.key === "Backspace" || event.key === "Delete") {
      input.value = "";
      input.blur?.();
      return "";
    }
    if (event.key === "Escape") {
      input.blur?.();
      return input.value || "";
    }
    const value = hotkeyFromEvent(event);
    if (!value) return input.value || "";
    input.value = value;
    input.blur?.();
    return value;
  }

  function sanitizeConfig(config = {}) {
    const merged = { ...DEFAULT_CONFIG, ...(config || {}) };
    const next = {};
    for (const key of Object.keys(DEFAULT_CONFIG)) {
      next[key] = merged[key];
    }
    next.filename_template = getFilenameTemplate(next);
    next.filename_max_length = Number(next.filename_max_length || 80);
    next.album_index_format = normalizeAlbumIndexFormat(next.album_index_format);
    next.video_source_columns = normalizeVideoSourceColumns(next.video_source_columns);
    next.shortcut_download = normalizeHotkey(next.shortcut_download);
    next.shortcut_frame = normalizeHotkey(next.shortcut_frame);
    next.shortcut_details = normalizeHotkey(next.shortcut_details);
    next.shortcut_settings = normalizeHotkey(next.shortcut_settings);
    if (!DOWNLOAD_METHOD_OPTIONS.includes(next.download_method)) {
      next.download_method = DEFAULT_CONFIG.download_method;
    }
    return next;
  }

  function normalizeAlbumIndexFormat(format) {
    const value = String(format || "");
    return ALBUM_INDEX_FORMAT_OPTIONS.some((option) => option.value === value)
      ? value
      : DEFAULT_CONFIG.album_index_format;
  }

  function getAlbumIndexFormatOption(format) {
    const value = normalizeAlbumIndexFormat(format);
    return (
      ALBUM_INDEX_FORMAT_OPTIONS.find((option) => option.value === value) ||
      ALBUM_INDEX_FORMAT_OPTIONS[0]
    );
  }

  function formatAlbumIndex(index = 0, format = DEFAULT_CONFIG.album_index_format) {
    const numericIndex = Math.floor(Number(index || 0));
    const number = Number.isFinite(numericIndex) ? Math.max(1, numericIndex + 1) : 1;
    const padded = String(number).padStart(2, "0");
    return getAlbumIndexFormatOption(format).template
      .replace("{nn}", padded)
      .replace("{n}", String(number));
  }

  function unique(values) {
    const result = [];
    const seen = new Set();
    for (const value of values) {
      if (!value || typeof value !== "string") continue;
      if (seen.has(value)) continue;
      seen.add(value);
      result.push(value);
    }
    return result;
  }

  function ensureArray(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  }

  function firstString(...values) {
    for (const value of values.flatMap(ensureArray)) {
      if (typeof value === "string" && value.trim()) return value;
    }
    return "";
  }

  function firstDefined(...values) {
    return values.find((value) => value !== undefined && value !== null && value !== "");
  }

  function firstPositiveNumber(...values) {
    for (const value of values.flatMap(ensureArray)) {
      const number = Number(value);
      if (Number.isFinite(number) && number > 0) return number;
    }
    return 0;
  }

  function normalizeBoolFlag(value) {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value > 0;
    const text = String(value).trim().toLowerCase();
    if (["true", "yes", "1", "allow", "allowed"].includes(text)) return true;
    if (["false", "no", "0", "deny", "denied"].includes(text)) return false;
    return null;
  }

  function getNested(obj, path) {
    return path.reduce((current, key) => {
      if (!current || typeof current !== "object") return undefined;
      return current[key];
    }, obj);
  }

  function parseJsonScriptText(text) {
    if (!text || typeof text !== "string") return null;
    try {
      return JSON.parse(text);
    } catch (_err) {
      const decoded = text
        .replace(/&quot;/g, '"')
        .replace(/&#34;/g, '"')
        .replace(/&#x22;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&#x2F;/g, "/")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
      try {
        return JSON.parse(decoded);
      } catch (_decodedErr) {
        return null;
      }
    }
  }

  function parsePageDataFromDocument(doc) {
    if (!doc || !doc.querySelector) return null;
    const universalScript = doc.querySelector(
      'script#__UNIVERSAL_DATA_FOR_REHYDRATION__[type="application/json"]',
    );
    const universal = parseJsonScriptText(universalScript?.textContent || "");
    if (universal) return universal;

    const sigiScript = doc.querySelector(
      'script#SIGI_STATE[type="application/json"]',
    );
    return parseJsonScriptText(sigiScript?.textContent || "");
  }

  function getWindowDataCandidates(win) {
    return [
      win?.__UNIVERSAL_DATA_FOR_REHYDRATION__,
      win?.SIGI_STATE,
      win?.__NEXT_DATA__,
      win?.__INITIAL_STATE__,
    ].filter((value) => value && typeof value === "object");
  }

  function parsePageDataFromWindow(win) {
    return getWindowDataCandidates(win)[0] || null;
  }

  function getAddressUrls(address) {
    return unique(
      ensureArray(address).flatMap((value) => {
        if (typeof value === "string") return [value];
        if (!value || typeof value !== "object") return [];
        return [
          ...ensureArray(value.UrlList),
          ...ensureArray(value.urlList),
          ...ensureArray(value.url_list),
          value.Url,
          value.url,
          value.uri,
        ];
      }),
    );
  }

  function firstUrl(...addresses) {
    return getAddressUrls(addresses.flatMap(ensureArray))[0] || firstString(...addresses);
  }

  function getUrlResourceKeys(url = "") {
    const text = String(url || "").trim();
    if (!text || text.startsWith("blob:")) return [];
    const keys = [text, text.split("#")[0].split("?")[0]];
    try {
      const parsed = new URL(text, "https://www.tiktok.com");
      if (/^https?:$/i.test(parsed.protocol)) {
        keys.push(parsed.pathname);
        const parts = parsed.pathname.split("/").filter(Boolean);
        keys.push(parts.slice(-3).join("/"));
        keys.push(parts.slice(-2).join("/"));
      }
    } catch (_err) {}
    return unique(keys.filter((key) => key && key.length > 8));
  }

  function urlsShareResource(leftUrls = [], rightUrls = []) {
    const rightKeys = new Set(rightUrls.flatMap(getUrlResourceKeys));
    if (!rightKeys.size) return false;
    return leftUrls.flatMap(getUrlResourceKeys).some((key) => rightKeys.has(key));
  }

  function getVideoElementResourceUrls(videoElement) {
    if (!videoElement) return [];
    return unique([
      pickVideoElementSource(videoElement),
      videoElement.poster || "",
      videoElement.getAttribute?.("poster") || "",
    ]);
  }

  function getMediaResourceUrls(media = {}) {
    const sources = ensureArray(media?.video?.sources);
    const images = ensureArray(media?.images);
    return unique([
      media?.video?.primaryUrl || "",
      ...ensureArray(media?.video?.fallbackUrls),
      ...sources.flatMap((source) => [
        source?.url || "",
        ...ensureArray(source?.fallbackUrls),
      ]),
      media?.cover?.url || "",
      media?.cover?.dynamicUrl || "",
      ...images.flatMap((image) => [
        image?.url || "",
        ...ensureArray(image?.fallbackUrls),
      ]),
    ]);
  }

  function compactMatchText(value = "") {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function contextContainsText(contextText = "", value = "") {
    const text = compactMatchText(contextText);
    const needle = compactMatchText(value);
    if (!text || needle.length < 3) return false;
    if (text.includes(needle)) return true;
    return needle.length > 24 && text.includes(needle.slice(0, 24));
  }

  function scoreItemAgainstContextText(item = {}, contextText = "") {
    if (!compactMatchText(contextText)) return 0;
    const author = item.author || item.authorInfo || {};
    const values = [
      { value: item.desc || item.description || "", score: 55 },
      { value: author.uniqueId || author.unique_id || "", score: 35 },
      { value: author.nickname || author.nickName || "", score: 28 },
      { value: author.secUid || author.sec_uid || "", score: 16 },
    ];
    return values.reduce(
      (score, entry) => score + (contextContainsText(contextText, entry.value) ? entry.score : 0),
      0,
    );
  }

  function getItemPageUrl(item = {}, fallbackUrl = "") {
    const id = getVideoItemId(item);
    const author = item.author || item.authorInfo || {};
    const uniqueId = author.uniqueId || author.unique_id || "";
    if (getVideoIdFromUrl(fallbackUrl) === id) return fallbackUrl;
    if (id && uniqueId) {
      return `https://www.tiktok.com/@${uniqueId}/${getImagePostPayload(item) ? "photo" : "video"}/${id}`;
    }
    return fallbackUrl || "";
  }

  function getAddressDimension(address, key) {
    const first = ensureArray(address).find(
      (value) => value && typeof value === "object",
    );
    if (!first) return 0;
    return Number(first[key] || first[key.toLowerCase()] || 0);
  }

  function getAddressNumber(address, keys = []) {
    const first = ensureArray(address).find(
      (value) => value && typeof value === "object",
    );
    if (!first) return 0;
    for (const key of keys) {
      const value = first[key] ?? first[String(key).toLowerCase()];
      if (value !== undefined && value !== null && value !== "") {
        const number = Number(value);
        if (Number.isFinite(number)) return number;
      }
    }
    return 0;
  }

  function getAddressString(address, keys = []) {
    const first = ensureArray(address).find(
      (value) => value && typeof value === "object",
    );
    if (!first) return "";
    for (const key of keys) {
      const value = first[key] ?? first[String(key).toLowerCase()];
      if (value !== undefined && value !== null && value !== "") return String(value);
    }
    return "";
  }

  function firstNumber(...values) {
    for (const value of values) {
      if (value === undefined || value === null || value === "") continue;
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }
    return 0;
  }

  function readNumberPath(source = {}, paths = []) {
    for (const path of paths) {
      const value = getNested(source, path.split("."));
      const number = firstNumber(value);
      if (number) return number;
    }
    return 0;
  }

  function getPropertyValuePreview(value) {
    if (value === undefined || value === null || value === "") return "";
    if (Array.isArray(value)) {
      return value
        .map((item) => (typeof item === "object" ? JSON.stringify(item) : String(item)))
        .join(", ")
        .slice(0, 240);
    }
    if (typeof value === "object") {
      try {
        return JSON.stringify(value).slice(0, 240);
      } catch (_err) {
        return "";
      }
    }
    return String(value).slice(0, 240);
  }

  function flattenSourceProperties(value, prefix = "", result = [], seen = new Set(), depth = 0) {
    if (!value || typeof value !== "object" || seen.has(value) || depth > 4) return result;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (child && typeof child === "object" && !Array.isArray(child)) {
        result.push({ key: path, value: getPropertyValuePreview(child) });
        flattenSourceProperties(child, path, result, seen, depth + 1);
      } else {
        result.push({ key: path, value: getPropertyValuePreview(child) });
      }
      if (result.length >= 180) return result;
    }
    return result;
  }

  function collectSourceProperties(...values) {
    const byKey = new Map();
    for (const value of values.flatMap(ensureArray)) {
      for (const property of flattenSourceProperties(value)) {
        if (!property.key || byKey.has(property.key)) continue;
        byKey.set(property.key, property);
      }
    }
    return [...byKey.values()];
  }

  function qualityFromText(...values) {
    const text = values.map((value) => String(value || "")).join(" ");
    const match = text.match(/(?:^|[_\s-])(\d{3,4})(?:p|[_\s-]|$)/i);
    return match ? `${Number(match[1])}p` : "";
  }

  function getSourceResolution(source = {}) {
    const qualityText = `${source.quality || ""} ${source.gearName || ""}`;
    const qualityMatch = qualityText.match(/(?:^|[_\s-])(\d{3,4})(?:p|[_\s-]|$)/i);
    if (qualityMatch) return Number(qualityMatch[1]);
    const width = Number(source.width || 0);
    const height = Number(source.height || 0);
    if (width && height) return Math.min(width, height);
    return Math.max(width, height, 0);
  }

  function sourceLabel(source = {}) {
    const parts = [];
    const quality = source.quality || (source.resolution ? `${source.resolution}p` : "");
    if (quality) parts.push(quality);
    if (source.codec) parts.push(source.codec);
    if (source.bitrate) parts.push(`${Math.round(source.bitrate / 1000)}kbps`);
    return parts.join(" ") || source.gearName || source.qualityType || "video";
  }

  function makeVideoSource(input = {}) {
    const urls = getAddressUrls(input.address || input.url || input.urls);
    const qualityType = firstDefined(input.qualityType, input.quality_type);
    const gearName = input.gearName || input.gear_name || "";
    const quality =
      input.quality ||
      qualityFromText(gearName, input.definition, input.label) ||
      (qualityType !== undefined ? String(qualityType) : "");
    const source = {
      url: urls[0] || "",
      fallbackUrls: urls.slice(1),
      width: Number(input.width || getAddressDimension(input.address, "Width") || 0),
      height: Number(input.height || getAddressDimension(input.address, "Height") || 0),
      bitrate: Number(input.bitrate || 0),
      codec: input.codec || "",
      quality,
      gearName,
      qualityType: qualityType !== undefined ? String(qualityType) : "",
      format: input.format || "",
      urlId:
        input.urlId ||
        getAddressString(input.address, ["Uri", "uri", "URLKey", "urlKey", "url_key"]) ||
        "",
      fps: firstNumber(input.fps),
      size: Number(
        input.size ||
          getAddressNumber(input.address, [
            "DataSize",
            "dataSize",
            "data_size",
            "FileSize",
            "fileSize",
            "file_size",
            "Size",
            "size",
          ]) ||
          0,
      ),
      rawProperties: collectSourceProperties(input.raw, input.address),
    };
    source.resolution = getSourceResolution(source);
    source.label = sourceLabel(source);
    return source.url ? source : null;
  }

  function getVideoSourceFromBitrateInfo(info = {}, video = {}) {
    const playAddr =
      info.PlayAddr ||
      info.playAddr ||
      info.play_addr ||
      info.UrlList ||
      info.urlList ||
      info.url_list;
    const quality = firstDefined(
      info.Definition,
      info.definition,
      info.quality,
      info.Quality,
      info.videoQuality,
      info.video_quality,
    );
    return makeVideoSource({
      raw: info,
      address: playAddr,
      width:
        info.Width ||
        info.width ||
        getAddressNumber(playAddr, ["Width", "width"]) ||
        video.width,
      height:
        info.Height ||
        info.height ||
        getAddressNumber(playAddr, ["Height", "height"]) ||
        video.height,
      bitrate: info.Bitrate || info.bitrate,
      codec: info.CodecType || info.codecType || info.codec_type,
      fps:
        info.FPS ||
        info.Fps ||
        info.fps ||
        info.BitrateFPS ||
        info.bitrateFPS ||
        info.bitrate_fps ||
        info.VideoFPS ||
        info.videoFPS ||
        info.video_fps ||
        info.FrameRate ||
        info.frameRate ||
        info.frame_rate ||
        readNumberPath(info, [
          "VideoMeta.FPS",
          "VideoMeta.Fps",
          "VideoMeta.FrameRate",
          "videoMeta.fps",
          "video_meta.fps",
          "Meta.FrameRate",
          "meta.frameRate",
        ]) ||
        getAddressNumber(playAddr, [
          "FPS",
          "Fps",
          "fps",
          "FrameRate",
          "frameRate",
          "frame_rate",
        ]),
      size:
        info.DataSize ||
        info.dataSize ||
        info.data_size ||
        info.FileSize ||
        info.fileSize ||
        info.file_size ||
        info.Size ||
        info.size ||
        readNumberPath(info, [
          "PlayAddr.DataSize",
          "PlayAddr.FileSize",
          "playAddr.dataSize",
          "play_addr.data_size",
        ]),
      quality,
      gearName: info.GearName || info.gearName || "",
      qualityType: firstDefined(info.QualityType, info.qualityType, info.quality_type),
      format: info.Format || info.format || info.Container || info.container || "",
      urlId: getAddressString(playAddr, ["UrlKey", "URLKey", "urlKey", "url_key", "Uri", "uri"]),
    });
  }

  function sortBitrateInfo(items) {
    return [...items].sort((left, right) => {
      const leftBitrate = Number(left.Bitrate || left.bitrate || 0);
      const rightBitrate = Number(right.Bitrate || right.bitrate || 0);
      return rightBitrate - leftBitrate;
    });
  }

  function extractVideoSources(video = {}) {
    const bitrateSources = sortBitrateInfo(
      ensureArray(
        video.bitrateInfo ||
          video.bitrate_info ||
          video.bitrateInfos ||
          video.bitrate_infos,
      ),
    )
      .map((info) => getVideoSourceFromBitrateInfo(info, video))
      .filter(Boolean);
    const directSources = [
      makeVideoSource({
        raw: video,
        address: video.playAddr || video.PlayAddr || video.play_addr,
        width: video.width,
        height: video.height,
        codec: video.codecType || video.encodedType || "",
        fps:
          video.FPS ||
          video.fps ||
          video.BitrateFPS ||
          video.bitrateFPS ||
          video.bitrate_fps ||
          video.VideoFPS ||
          video.videoFPS ||
          video.FrameRate ||
          video.frameRate ||
          video.frame_rate ||
          readNumberPath(video, ["videoMeta.fps", "VideoMeta.FPS"]),
        quality: video.videoQuality || video.definition || video.ratio || "",
        qualityType: firstDefined(video.QualityType, video.qualityType, video.quality_type),
        format: video.format || "",
        size:
          video.size ||
          video.DataSize ||
          video.dataSize ||
          readNumberPath(video, ["playAddr.dataSize", "PlayAddr.DataSize"]),
      }),
      makeVideoSource({
        raw: video,
        address: video.downloadAddr || video.DownloadAddr || video.download_addr,
        width: video.width,
        height: video.height,
        codec: video.codecType || video.encodedType || "",
        fps:
          video.FPS ||
          video.fps ||
          video.BitrateFPS ||
          video.bitrateFPS ||
          video.bitrate_fps ||
          video.VideoFPS ||
          video.videoFPS ||
          video.FrameRate ||
          video.frameRate ||
          video.frame_rate ||
          readNumberPath(video, ["videoMeta.fps", "VideoMeta.FPS"]),
        quality: video.videoQuality || video.definition || video.ratio || "",
        qualityType: firstDefined(video.QualityType, video.qualityType, video.quality_type),
        format: video.format || "",
        size:
          video.size ||
          video.DataSize ||
          video.dataSize ||
          readNumberPath(video, ["downloadAddr.dataSize", "DownloadAddr.DataSize"]),
      }),
    ].filter(Boolean);

    const byUrl = new Map();
    for (const source of [...bitrateSources, ...directSources]) {
      if (!byUrl.has(source.url)) byUrl.set(source.url, source);
    }
    return [...byUrl.values()];
  }

  function extractImageSources(imagePost = {}) {
    if (!imagePost || typeof imagePost !== "object") return [];
    const images = ensureArray(
      imagePost.images ||
        imagePost.imageList ||
        imagePost.image_list ||
        imagePost.multiImage ||
        [],
    );
    return images
      .map((image, index) => {
        const address = getImageAddress(image);
        const urls = getAddressUrls(address);
        const { width, height } = getImageDimensions(image, address);
        return {
          index: index + 1,
          url: urls[0] || "",
          fallbackUrls: urls.slice(1),
          width,
          height,
          size: Number(image?.size || address?.size || 0),
        };
      })
      .filter((image) => image.url);
  }

  function getImageAddress(image = {}) {
    if (!image || typeof image !== "object") return image;
    return (
      image.imageURL ||
      image.imageUrl ||
      image.image_url ||
      image.originImage ||
      image.origin_image ||
      image.displayImage ||
      image.display_image ||
      image.downloadAddr ||
      image.download_addr ||
      image
    );
  }

  function getImageDimensions(image = {}, address = getImageAddress(image)) {
    return {
      width: firstPositiveNumber(
        image?.width,
        image?.Width,
        image?.imageWidth,
        image?.image_width,
        image?.displayWidth,
        image?.display_width,
        getAddressDimension(address, "Width"),
      ),
      height: firstPositiveNumber(
        image?.height,
        image?.Height,
        image?.imageHeight,
        image?.image_height,
        image?.displayHeight,
        image?.display_height,
        getAddressDimension(address, "Height"),
      ),
    };
  }

  function getImagePostCoverInfo(imagePost = {}, images = []) {
    const cover =
      imagePost?.cover ||
      imagePost?.Cover ||
      imagePost?.coverImage ||
      imagePost?.cover_image ||
      imagePost?.thumbnail ||
      imagePost?.thumb ||
      {};
    const address = getImageAddress(cover);
    const urls = getAddressUrls(address);
    const dimensions = getImageDimensions(cover, address);
    const fallback = images[0] || {};
    return {
      url: urls[0] || fallback.url || "",
      fallbackUrls: urls.slice(1),
      width: dimensions.width || fallback.width || 0,
      height: dimensions.height || fallback.height || 0,
    };
  }

  function getImagePostPayload(item = {}) {
    return (
      item.imagePost ||
      item.image_post ||
      item.imagePostInfo ||
      item.image_post_info ||
      item.imagePostV2 ||
      item.image_post_v2 ||
      item.photoMode ||
      item.photo_mode ||
      null
    );
  }

  function compareByResolutionThenBitrate(left, right) {
    const resolutionDiff = Number(left.resolution || 0) - Number(right.resolution || 0);
    if (resolutionDiff) return resolutionDiff;
    return Number(left.bitrate || 0) - Number(right.bitrate || 0);
  }

  function selectVideoSource(sources, preference = DEFAULT_CONFIG.video_quality) {
    const candidates = ensureArray(sources).filter((source) => source?.url);
    if (!candidates.length) return null;
    const value = String(preference || DEFAULT_CONFIG.video_quality);
    if (value === "highest_bitrate") {
      return [...candidates].sort(
        (left, right) => Number(right.bitrate || 0) - Number(left.bitrate || 0),
      )[0];
    }
    if (value === "lowest") {
      return [...candidates].sort(compareByResolutionThenBitrate)[0];
    }
    const targetMatch = value.match(/^(\d{3,4})p$/);
    if (targetMatch) {
      const target = Number(targetMatch[1]);
      const exact = candidates.filter((source) => Number(source.resolution || 0) === target);
      if (exact.length) {
        return exact.sort(
          (left, right) => Number(right.bitrate || 0) - Number(left.bitrate || 0),
        )[0];
      }
      return [...candidates].sort((left, right) => {
        const leftDistance = Math.abs(Number(left.resolution || 0) - target);
        const rightDistance = Math.abs(Number(right.resolution || 0) - target);
        if (leftDistance !== rightDistance) return leftDistance - rightDistance;
        return Number(right.bitrate || 0) - Number(left.bitrate || 0);
      })[0];
    }
    return [...candidates].sort(
      (left, right) => compareByResolutionThenBitrate(right, left),
    )[0];
  }

  function extractVideoUrls(video = {}, qualityPreference = DEFAULT_CONFIG.video_quality) {
    const sources = extractVideoSources(video);
    const primarySource = selectVideoSource(sources, qualityPreference);
    const urls = unique([
      primarySource?.url || "",
      ...(primarySource?.fallbackUrls || []),
      ...sources.flatMap((source) => [source.url, ...source.fallbackUrls]),
    ]);
    return {
      primaryUrl: urls[0] || "",
      fallbackUrls: urls.slice(1),
      primarySource,
      sources,
    };
  }

  function extractHashtags(item = {}) {
    const fromChallenges = ensureArray(item.challenges)
      .map((challenge) => challenge?.title || challenge?.hashtagName)
      .filter(Boolean);
    const fromText = ensureArray(item.textExtra)
      .filter((extra) => extra?.type === 1 || extra?.hashtagName)
      .map((extra) => extra.hashtagName)
      .filter(Boolean);
    const fromContents = ensureArray(item.contents).flatMap((content) =>
      ensureArray(content?.textExtra)
        .map((extra) => extra?.hashtagName)
        .filter(Boolean),
    );
    return unique([...fromChallenges, ...fromText, ...fromContents]);
  }

  function findVideoItemInPageData(data, pageUrl = "") {
    if (!data || typeof data !== "object") return null;
    const videoId = getVideoIdFromUrl(pageUrl);
    const scope = data.__DEFAULT_SCOPE__ || data;
    const detail = scope["webapp.video-detail"];
    const directItem =
      detail?.itemInfo?.itemStruct || detail?.itemStruct || detail?.itemInfo;
    if (
      (directItem?.video || directItem?.imagePost) &&
      (!videoId || getVideoItemId(directItem) === videoId)
    ) {
      return directItem;
    }

    const itemModule = scope.ItemModule || data.ItemModule;
    if (itemModule && typeof itemModule === "object") {
      if (videoId && itemModule[videoId]) return itemModule[videoId];
      if (!videoId) {
        const firstItem = Object.values(itemModule).find(
          (item) => item?.video || item?.imagePost,
        );
        if (firstItem) return firstItem;
      }
    }

    return findVideoItemDeep(scope, videoId) || findVideoItemDeep(data, videoId);
  }

  function getVideoItemId(item = {}) {
    return String(
      item.id || item.awemeId || item.aweme_id || item.itemId || item.item_id || "",
    );
  }

  function isVideoItemCandidate(value) {
    return Boolean(
      value &&
        typeof value === "object" &&
        (value.video || value.imagePost) &&
        (getVideoItemId(value) || value.desc || value.description),
    );
  }

  function findVideoItemDeep(data, targetId = "") {
    if (!data || typeof data !== "object") return null;
    const stack = [data];
    const seen = new Set();
    let fallback = null;
    let inspected = 0;
    while (stack.length && inspected < 25000) {
      const current = stack.pop();
      if (!current || typeof current !== "object" || seen.has(current)) continue;
      seen.add(current);
      inspected += 1;
      if (isVideoItemCandidate(current)) {
        const id = getVideoItemId(current);
        if (!targetId || id === targetId) return current;
        if (!fallback) fallback = current;
      }
      for (const value of Object.values(current)) {
        if (value && typeof value === "object") stack.push(value);
      }
    }
    return targetId ? null : fallback;
  }

  function collectVideoItemsDeep(data) {
    if (!data || typeof data !== "object") return [];
    const stack = [data];
    const seen = new Set();
    const items = [];
    let inspected = 0;
    while (stack.length && inspected < 30000) {
      const current = stack.pop();
      if (!current || typeof current !== "object" || seen.has(current)) continue;
      seen.add(current);
      inspected += 1;
      if (isVideoItemCandidate(current)) {
        items.push(current);
      }
      for (const value of Object.values(current)) {
        if (value && typeof value === "object") stack.push(value);
      }
    }
    return items;
  }

  // Shared by RuntimeMediaCache.getMediaByVideoElement() (matches against network-captured
  // responses) and TikTokMediaExtractor.getCurrentMedia()'s page-data fallback (matches
  // against SSR/window JSON). Given a pool of raw item objects, find the one that best
  // corresponds to the currently visible <video> element: first by comparing actual media
  // resource URLs (cover/poster/playAddr), falling back to a fuzzy score against the
  // surrounding DOM text (author name, description) when the element's URLs are unusable
  // (e.g. a blob: URL from MSE-based playback, which carries no resource identity at all).
  function findBestMediaMatch(items = [], videoElement = null, contextText = "", config = {}, pageUrl = "") {
    const elementUrls = getVideoElementResourceUrls(videoElement);
    let bestTextMatch = null;
    for (const item of items) {
      const itemPageUrl = getItemPageUrl(item, pageUrl);
      const media = normalizeMediaItem(item, itemPageUrl, config);
      if (!hasUsableMedia(media)) continue;
      if (elementUrls.length && urlsShareResource(elementUrls, getMediaResourceUrls(media))) {
        return media;
      }
      const textScore = scoreItemAgainstContextText(item, contextText);
      if (!bestTextMatch || textScore > bestTextMatch.score) {
        bestTextMatch = { score: textScore, media };
      }
    }
    return bestTextMatch?.score >= 55 ? bestTextMatch.media : null;
  }

  class RuntimeMediaCache {
    constructor(limit = 120) {
      this.limit = limit;
      this.items = new Map();
      this.lastItemId = "";
    }

    ingestJson(data, sourceUrl = "") {
      const items = collectVideoItemsDeep(data);
      for (const item of items) {
        const id = getVideoItemId(item);
        if (!id) continue;
        this.items.delete(id);
        this.items.set(id, {
          item,
          sourceUrl,
          seenAt: Date.now(),
        });
        this.lastItemId = id;
      }
      while (this.items.size > this.limit) {
        const firstKey = this.items.keys().next().value;
        this.items.delete(firstKey);
      }
      return items.length;
    }

    ingestText(text, sourceUrl = "") {
      if (!text || typeof text !== "string") return 0;
      if (!/"(?:video|itemList|itemStruct|aweme|aweme_list)"/.test(text)) return 0;
      const data = parseJsonScriptText(text);
      return data ? this.ingestJson(data, sourceUrl) : 0;
    }

    getItem(pageUrl = "") {
      const id = getVideoIdFromUrl(pageUrl);
      if (id && this.items.has(id)) return this.items.get(id).item;
      return null;
    }

    getMedia(pageUrl = "", config = {}) {
      return normalizeMediaItem(this.getItem(pageUrl), pageUrl, config);
    }

    getMediaByVideoElement(videoElement = null, contextText = "", config = {}, pageUrl = "") {
      const entries = Array.from(this.items.values())
        .reverse()
        .map((entry) => entry.item);
      return findBestMediaMatch(entries, videoElement, contextText, config, pageUrl);
    }
  }

  class RuntimeResponseObserver {
    constructor(win, cache) {
      this.window = win;
      this.cache = cache;
    }

    install() {
      const win = this.window;
      if (!win || win.__tkDlRuntimeObserverInstalled) return;
      win.__tkDlRuntimeObserverInstalled = true;
      this.patchFetch();
      this.patchXhr();
    }

    patchFetch() {
      const win = this.window;
      const originalFetch = win.fetch;
      if (typeof originalFetch !== "function") return;
      const cache = this.cache;
      win.fetch = function patchedFetch(...args) {
        // Always bind to `win`, not the call-site `this`: some app bundles read
        // `window.fetch` into a bare reference (e.g. `const f = window.fetch`) and invoke
        // it without a receiver, which would make `this` undefined here and cause the
        // native fetch implementation to throw "Illegal invocation".
        return originalFetch.apply(win, args).then((response) => {
          try {
            const url = response?.url || String(args[0]?.url || args[0] || "");
            const contentType = response?.headers?.get?.("content-type") || "";
            if (
              contentType &&
              !/(json|text|javascript|application\/x-ndjson)/i.test(contentType)
            ) {
              return response;
            }
            response
              ?.clone?.()
              ?.text?.()
              ?.then((text) => cache.ingestText(text, url))
              ?.catch(() => {});
          } catch (_err) {}
          return response;
        });
      };
    }

    patchXhr() {
      const win = this.window;
      const Xhr = win.XMLHttpRequest;
      if (!Xhr?.prototype) return;
      const cache = this.cache;
      const originalOpen = Xhr.prototype.open;
      const originalSend = Xhr.prototype.send;
      Xhr.prototype.open = function patchedOpen(method, url, ...rest) {
        this.__tkDlUrl = String(url || "");
        return originalOpen.call(this, method, url, ...rest);
      };
      Xhr.prototype.send = function patchedSend(...args) {
        this.addEventListener?.("load", function onLoad() {
          try {
            const responseType = this.responseType || "";
            if (responseType && responseType !== "text" && responseType !== "json") return;
            if (responseType === "json") {
              cache.ingestJson(this.response, this.responseURL || this.__tkDlUrl || "");
            } else {
              cache.ingestText(this.responseText, this.responseURL || this.__tkDlUrl || "");
            }
          } catch (_err) {}
        });
        return originalSend.apply(this, args);
      };
    }
  }

  function normalizeMediaItem(item, pageUrl = "", options = {}) {
    if (!item || typeof item !== "object") return null;
    const video = item.video || {};
    const config = { ...DEFAULT_CONFIG, ...options };
    const urls = extractVideoUrls(video, config.video_quality);
    const primarySource = urls.primarySource || {};
    const author = item.author || item.authorInfo || {};
    const authorStats = item.authorStats || author.stats || author.stat || {};
    const music = item.music || {};
    const id = String(getVideoItemId(item) || getVideoIdFromUrl(pageUrl) || "");
    const createTime = Number(item.createTime || item.create_time || 0) || null;
    const shareInfo = item.shareInfo || item.share_info || {};
    const awemeControl = item.awemeControl || item.aweme_control || {};
    const downloadInfo = item.download || item.downloadInfo || item.download_info || {};
    const uniqueId = author.uniqueId || author.unique_id || author.shortId || "";
    const secUid = author.secUid || author.sec_uid || "";
    const imagePost = getImagePostPayload(item);
    const images = extractImageSources(imagePost);
    const imagePostCover = getImagePostCoverInfo(imagePost, images);

    return {
      id,
      desc: item.desc || item.description || "",
      createTime,
      pageUrl,
      shareUrl: firstString(
        item.shareUrl,
        item.share_url,
        shareInfo.shareUrl,
        shareInfo.share_url,
        pageUrl,
      ),
      groupId: String(item.groupId || item.group_id || item.groupID || id || ""),
      author: {
        id: String(author.id || author.uid || author.userId || author.user_id || ""),
        uniqueId: uniqueId || secUid,
        secUid,
        nickname: author.nickname || author.nickName || author.uniqueId || author.unique_id || "",
        avatarUrl: firstUrl(
          author.avatarThumb,
          author.avatarMedium,
          author.avatarLarger,
          author.avatar,
          author.avatar_thumb,
          author.avatar_medium,
          author.avatar_larger,
        ),
        signature: author.signature || author.desc || "",
        verification:
          author.customVerify ||
          author.enterpriseVerifyReason ||
          author.verifyInfo ||
          author.verifiedReason ||
          "",
        verified: Boolean(author.verified || author.isVerified || author.customVerify),
        followerCount: firstDefined(
          author.followerCount,
          author.follower_count,
          authorStats.followerCount,
          authorStats.follower_count,
        ),
        totalFavorited: firstDefined(
          author.totalFavorited,
          author.total_favorited,
          author.heartCount,
          author.heart_count,
          authorStats.heartCount,
          authorStats.heart_count,
        ),
        profileUrl: uniqueId ? `https://www.tiktok.com/@${uniqueId}` : "",
      },
      video: {
        primaryUrl: urls.primaryUrl,
        fallbackUrls: urls.fallbackUrls,
        primarySource: urls.primarySource,
        sources: urls.sources,
        width: Number(primarySource.width || video.width || 0),
        height: Number(primarySource.height || video.height || 0),
        duration: Number(video.duration || 0),
        format: video.format || "mp4",
        codec: primarySource.codec || video.codecType || video.encodedType || "",
        fps: Number(primarySource.fps || video.FPS || video.fps || video.frameRate || 0),
        quality:
          primarySource.label ||
          video.videoQuality ||
          video.definition ||
          video.ratio ||
          "",
        size: Number(primarySource.size || video.size || 0),
      },
      cover: {
        url: firstString(video.cover, video.originCover, item.video?.cover, imagePostCover.url),
        dynamicUrl: firstString(video.dynamicCover),
        width: firstPositiveNumber(imagePostCover.width, video.width),
        height: firstPositiveNumber(imagePostCover.height, video.height),
      },
      music: {
        id: String(music.id || ""),
        title: music.title || "",
        authorName: music.authorName || music.author || "",
        coverUrl: firstUrl(
          music.coverThumb,
          music.coverMedium,
          music.coverLarge,
          music.cover_thumb,
          music.cover_medium,
          music.cover_large,
        ),
        duration: Number(music.duration || music.durationSeconds || music.duration_second || 0),
        url: firstUrl(music.playUrl, music.play_url?.url_list, music.play_url, music.play),
      },
      isImagePost: Boolean(images.length),
      images,
      hashtags: extractHashtags(item),
      stats: item.stats || item.statsV2 || {},
      permissions: {
        allowComment: normalizeBoolFlag(
          firstDefined(awemeControl.canComment, item.canComment, item.allowComment),
        ),
        allowShare: normalizeBoolFlag(
          firstDefined(awemeControl.canShare, item.canShare, item.allowShare),
        ),
        allowDownload: normalizeBoolFlag(
          firstDefined(downloadInfo.allowDownload, item.allowDownload, item.canDownload),
        ),
        allowDuet: normalizeBoolFlag(
          firstDefined(item.duetEnabled, item.duet_enabled, item.allowDuet),
        ),
        allowStitch: normalizeBoolFlag(
          firstDefined(item.stitchEnabled, item.stitch_enabled, item.allowStitch),
        ),
        isPrivate: normalizeBoolFlag(firstDefined(item.isPrivate, item.privateItem)),
      },
      raw: item,
    };
  }

  function extractMediaFromPageData(data, pageUrl = "", options = {}) {
    return normalizeMediaItem(findVideoItemInPageData(data, pageUrl), pageUrl, options);
  }

  function hasUsableMedia(media) {
    return Boolean(
      media?.video?.primaryUrl ||
        media?.isImagePost ||
        ensureArray(media?.images).length,
    );
  }

  function getVideoIdFromUrl(url) {
    const text = String(url || "");
    const match = text.match(/\/(?:video|photo)\/(\d+)/);
    return match ? match[1] : "";
  }

  function pickVideoElementSource(videoElement) {
    const currentSrc = videoElement?.currentSrc || "";
    if (currentSrc && !currentSrc.startsWith("blob:")) return currentSrc;
    const src = videoElement?.src || "";
    if (src && !src.startsWith("blob:")) return src;
    const sources = Array.from(videoElement?.querySelectorAll?.("source") || []);
    return firstString(sources.map((source) => source.src));
  }

  function extractMediaFromVideoElement(videoElement, pageUrl = "") {
    const source = pickVideoElementSource(videoElement);
    if (!source) return null;
    const id = getVideoIdFromUrl(pageUrl) || `video_${Date.now()}`;
    return {
      id,
      desc: "",
      createTime: null,
      pageUrl,
      author: {
        id: "",
        uniqueId: getAuthorFromUrl(pageUrl),
        secUid: "",
        nickname: getAuthorFromUrl(pageUrl),
        avatarUrl: "",
        signature: "",
        verification: "",
        verified: false,
        followerCount: undefined,
        totalFavorited: undefined,
        profileUrl: getAuthorFromUrl(pageUrl) ? `https://www.tiktok.com/@${getAuthorFromUrl(pageUrl)}` : "",
      },
      video: {
        primaryUrl: source,
        fallbackUrls: [],
        width: Number(videoElement?.videoWidth || 0),
        height: Number(videoElement?.videoHeight || 0),
        duration: Number(videoElement?.duration || 0),
        format: "mp4",
        codec: "",
        fps: 0,
        quality: "",
        size: 0,
      },
      cover: {
        url: videoElement?.poster || "",
        dynamicUrl: "",
      },
      music: {
        id: "",
        title: "",
        authorName: "",
        coverUrl: "",
        duration: 0,
        url: "",
      },
      images: [],
      hashtags: [],
      stats: {},
      shareUrl: pageUrl,
      groupId: id,
      permissions: {},
      raw: null,
    };
  }

  function getAuthorFromUrl(url) {
    const match = String(url || "").match(/tiktok\.com\/@([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function toShortId(value) {
    const text = String(value || "");
    if (/^\d+$/.test(text)) {
      try {
        return BigInt(text).toString(36);
      } catch (_err) {
        return text;
      }
    }
    return text;
  }

  function formatDate(date, format = "YYYY-MM-DD") {
    const safeDate = date instanceof Date && !Number.isNaN(date) ? date : new Date();
    const values = {
      YYYY: safeDate.getFullYear(),
      MM: String(safeDate.getMonth() + 1).padStart(2, "0"),
      DD: String(safeDate.getDate()).padStart(2, "0"),
      HH: String(safeDate.getHours()).padStart(2, "0"),
      mm: String(safeDate.getMinutes()).padStart(2, "0"),
      ss: String(safeDate.getSeconds()).padStart(2, "0"),
    };
    return format.replace(/YYYY|MM|DD|HH|mm|ss/g, (key) => values[key]);
  }

  function truncateAtUtf16Boundary(text, maxLength) {
    if (text.length <= maxLength) return text;
    let sliced = text.slice(0, maxLength);
    // If the cut falls between a UTF-16 surrogate pair (e.g. mid-emoji), the trailing
    // code unit is a lone high surrogate (0xD800-0xDBFF) with no following low surrogate.
    // Drop it instead of keeping a broken/unpaired surrogate in the filename.
    const lastCode = sliced.charCodeAt(sliced.length - 1);
    if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
      sliced = sliced.slice(0, -1);
    }
    return sliced;
  }

  function normalizeFilename(name, options = {}) {
    const maxLength = Number(options.maxLength || 255);
    const replacementChar = options.replacementChar || "_";
    if (typeof name !== "string") return "";

    const lastDotIndex = name.lastIndexOf(".");
    let baseName = name;
    let extension = "";
    if (lastDotIndex > 0 && lastDotIndex < name.length - 1) {
      baseName = name.slice(0, lastDotIndex);
      extension = name.slice(lastDotIndex);
    }

    let cleanBase = baseName
      .replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, replacementChar)
      .trim()
      .replace(/^\.+/, "")
      .replace(/\.+$/, "");
    if (/^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(\..*)?$/i.test(cleanBase)) {
      cleanBase = replacementChar + cleanBase;
    }
    if (!cleanBase) cleanBase = "download";

    const allowedBaseLength = Math.max(1, maxLength - extension.length);
    if (cleanBase.length > allowedBaseLength) {
      cleanBase = truncateAtUtf16Boundary(cleanBase, allowedBaseLength).trim();
      if (!cleanBase) cleanBase = "download";
    }
    return cleanBase + extension;
  }

  function renderFilenameTemplate(template = "", context = {}) {
    return getFilenameTemplate({ filename_template: template }).replace(
      /\$\{([a-zA-Z0-9_]+)\}/g,
      (_match, name) => {
        if (!Object.prototype.hasOwnProperty.call(context, name)) return "";
        const value = context[name];
        if (value === undefined || value === null) return "";
        if (typeof value === "object") {
          try {
            return JSON.stringify(value);
          } catch (_err) {
            return "";
          }
        }
        return String(value);
      },
    );
  }

  function getFilenameContext(media = {}) {
    const createDate = media.createTime
      ? new Date(Number(media.createTime) * 1000)
      : new Date();
    const now = new Date();
    return {
      id: media.id || "",
      video_id: media.id || "",
      short_id: toShortId(media.id || ""),
      nickname: media.author?.nickname || media.author?.uniqueId || "unknown",
      unique_id: media.author?.uniqueId || "",
      desc: media.desc || "",
      tags: ensureArray(media.hashtags).join("-"),
      music_name: media.music?.title || "",
      create_date_YYYYMMDD: formatDate(createDate, "YYYYMMDD"),
      create_date_YYYY_MM_DD: formatDate(createDate, "YYYY-MM-DD"),
      now_YYYYMMDD_HHmmss: formatDate(now, "YYYYMMDD_HHmmss"),
      media,
    };
  }

  function buildFilename(media, config = {}) {
    const merged = { ...DEFAULT_CONFIG, ...config };
    const context = getFilenameContext(media);
    const value = renderFilenameTemplate(getFilenameTemplate(merged), context);
    return normalizeFilename(String(value), {
      maxLength: Number(merged.filename_max_length || 80),
    });
  }

  function formatNumber(value, language = "en") {
    const number = Number(value || 0);
    if (!Number.isFinite(number) || !number) return "0";
    const locale = language === "zh" ? "zh-CN" : "en-US";
    return number.toLocaleString(locale);
  }

  function formatOptionalNumber(value, language = "en") {
    if (value === undefined || value === null || value === "") return "-";
    return formatNumber(value, language);
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (!Number.isFinite(bytes) || bytes <= 0) return "-";
    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    return `${size >= 10 || unitIndex === 0 ? Math.round(size) : size.toFixed(1)} ${units[unitIndex]}`;
  }

  function formatDuration(value) {
    const seconds = Number(value || 0);
    if (!Number.isFinite(seconds) || seconds <= 0) return "-";
    const minutes = Math.floor(seconds / 60);
    const rest = Math.floor(seconds % 60);
    return `${minutes}:${String(rest).padStart(2, "0")}`;
  }

  function formatTimestamp(value) {
    const seconds = Number(value || 0);
    if (!Number.isFinite(seconds) || seconds <= 0) return "-";
    return formatDate(new Date(seconds * 1000), "YYYY-MM-DD HH:mm:ss");
  }

  function formatResolution(width, height, fallback = "") {
    const w = Number(width || 0);
    const h = Number(height || 0);
    if (w && h) return `${w}x${h}`;
    return fallback || "-";
  }

  function getMediaOrientation(width, height) {
    const w = Number(width || 0);
    const h = Number(height || 0);
    if (!w || !h) return "unknown";
    if (Math.abs(w - h) < 2) return "square";
    return w > h ? "landscape" : "portrait";
  }

  function getStatValue(stats = {}, ...keys) {
    for (const key of keys) {
      const value = stats?.[key];
      if (value !== undefined && value !== null && value !== "") return value;
    }
    return 0;
  }

  function makeDetailAction(kind, label, url, filename, fallbackUrls = []) {
    return {
      kind,
      label,
      url: url || "",
      urls: unique([url, ...ensureArray(fallbackUrls)]),
      filename,
      available: Boolean(url),
    };
  }

  function buildDetailsModel(media = {}, config = {}, language = "en") {
    const merged = { ...DEFAULT_CONFIG, ...config };
    const t = (key) => getMessage(key, { language });
    const videoSourceColumns = normalizeVideoSourceColumns(merged.video_source_columns).map(
      (key) => {
        const definition = getVideoSourceColumnDefinition(key);
        return { key, label: t(definition?.messageKey || key) || key };
      },
    );
    const baseName = buildFilename(media, merged);
    const videoFormat = media.video?.format || "mp4";
    const videoName = `${baseName}.${videoFormat}`;
    const coverName = `${baseName}_cover.jpg`;
    const dynamicName = `${baseName}_dynamic.webp`;
    const musicName = `${baseName}_music.mp3`;
    const videoSources = ensureArray(media.video?.sources)
      .filter((source) => source?.url)
      .map((source, index) => ({
        index: index + 1,
        label: source.label || source.quality || `${t("source")} ${index + 1}`,
        quality: source.quality || source.gearName || source.qualityType || "-",
        resolution: formatResolution(
          source.width,
          source.height,
          source.resolution ? `${source.resolution}p` : "",
        ),
        codec: source.codec || "-",
        fps: source.fps ? String(source.fps) : "-",
        bitrate: source.bitrate
          ? formatNumber(Math.round(Number(source.bitrate) / 1000), language)
          : "-",
        size: formatBytes(source.size),
        gearName: source.gearName || "-",
        qualityType: source.qualityType || "-",
        width: source.width ? String(source.width) : "-",
        height: source.height ? String(source.height) : "-",
        format: source.format || "-",
        urlId: source.urlId || "-",
        properties: ensureArray(source.rawProperties),
        url: source.url,
        urls: unique([source.url, ...ensureArray(source.fallbackUrls)]),
        filename: videoName,
      }));

    if (!videoSources.length && media.video?.primaryUrl) {
      videoSources.push({
        index: 1,
        label: media.video.quality || t("video"),
        quality: media.video.quality || "-",
        resolution: formatResolution(media.video.width, media.video.height),
        codec: media.video.codec || "-",
        fps: media.video.fps ? String(media.video.fps) : "-",
        bitrate: "-",
        size: formatBytes(media.video.size),
        gearName: "-",
        qualityType: "-",
        width: media.video.width ? String(media.video.width) : "-",
        height: media.video.height ? String(media.video.height) : "-",
        format: media.video.format || "-",
        urlId: "-",
        properties: [],
        url: media.video.primaryUrl,
        urls: unique([media.video.primaryUrl, ...ensureArray(media.video.fallbackUrls)]),
        filename: videoName,
      });
    }

    const videoSourceProperties = [];
    const videoSourcePropertyKeys = new Set();
    for (const source of videoSources) {
      for (const property of ensureArray(source.properties)) {
        if (!property?.key || videoSourcePropertyKeys.has(property.key)) continue;
        videoSourcePropertyKeys.add(property.key);
        videoSourceProperties.push(property);
      }
    }

    const images = ensureArray(media.images)
      .filter((image) => image?.url)
      .map((image, index) => ({
        index: image.index || index + 1,
        resolution: formatResolution(image.width, image.height),
        url: image.url,
        urls: unique([image.url, ...ensureArray(image.fallbackUrls)]),
        filename: `${baseName}_image${formatAlbumIndex(index, merged.album_index_format)}.jpg`,
      }));
    const isImagePost = Boolean(media.isImagePost || images.length);
    const coverWidth = firstPositiveNumber(media.cover?.width, media.video?.width);
    const coverHeight = firstPositiveNumber(media.cover?.height, media.video?.height);

    const author = {
      id: media.author?.id || "",
      uid: media.author?.id || "",
      uniqueId: media.author?.uniqueId || "",
      secUid: media.author?.secUid || "",
      nickname: media.author?.nickname || "",
      avatarUrl: media.author?.avatarUrl || "",
      signature: media.author?.signature || "",
      verification: media.author?.verification || (media.author?.verified ? t("yes") : ""),
      followerCount: formatOptionalNumber(media.author?.followerCount, language),
      totalFavorited: formatOptionalNumber(media.author?.totalFavorited, language),
      profileUrl:
        media.author?.profileUrl ||
        (media.author?.uniqueId ? `https://www.tiktok.com/@${media.author.uniqueId}` : ""),
    };

    const stats = {
      playCount: {
        label: t("play_count"),
        value: formatNumber(getStatValue(media.stats, "playCount", "play_count", "play"), language),
      },
      diggCount: {
        label: t("digg_count"),
        value: formatNumber(getStatValue(media.stats, "diggCount", "digg_count", "digg"), language),
      },
      commentCount: {
        label: t("comment_count"),
        value: formatNumber(
          getStatValue(media.stats, "commentCount", "comment_count", "comment"),
          language,
        ),
      },
      shareCount: {
        label: t("share_count"),
        value: formatNumber(getStatValue(media.stats, "shareCount", "share_count", "share"), language),
      },
      collectCount: {
        label: t("collect_count"),
        value: formatNumber(
          getStatValue(media.stats, "collectCount", "collect_count", "collect"),
          language,
        ),
      },
    };
    const permissionRows = [
      { key: "allowComment", label: t("allow_comment"), value: media.permissions?.allowComment },
      { key: "allowShare", label: t("allow_share"), value: media.permissions?.allowShare },
      { key: "allowDownload", label: t("allow_download"), value: media.permissions?.allowDownload },
      { key: "allowDuet", label: t("allow_duet"), value: media.permissions?.allowDuet },
      { key: "allowStitch", label: t("allow_stitch"), value: media.permissions?.allowStitch },
      { key: "isPrivate", label: t("private_video"), value: media.permissions?.isPrivate },
    ].filter((row) => typeof row.value === "boolean");

    const post = {
      description: media.desc || "",
      createdAt: formatTimestamp(media.createTime),
      shareUrl: media.shareUrl || media.pageUrl || "",
      stats,
      ids: {
        videoId: media.id || "",
        groupId: media.groupId || media.id || "",
      },
      permissions: {
        allowComment: media.permissions?.allowComment,
        allowShare: media.permissions?.allowShare,
        allowDownload: media.permissions?.allowDownload,
        allowDuet: media.permissions?.allowDuet,
        allowStitch: media.permissions?.allowStitch,
        isPrivate: media.permissions?.isPrivate,
      },
      permissionRows,
    };

    return {
      tabs: [
        { id: "media", label: t("details_tab_media") },
        { id: "author", label: t("details_tab_author") },
        { id: "post", label: t("details_tab_post") },
        { id: "json", label: t("details_tab_json") },
      ],
      id: media.id || "",
      author,
      desc: media.desc || "",
      createdAt: formatTimestamp(media.createTime),
      duration: formatDuration(media.video?.duration),
      hashtags: ensureArray(media.hashtags),
      videoSources,
      videoSourceColumns,
      videoSourceProperties,
      showVideoSources: !isImagePost,
      isImagePost,
      cover: {
        url: media.cover?.url || "",
        dynamicUrl: media.cover?.dynamicUrl || "",
        resolution: formatResolution(coverWidth, coverHeight),
        orientation: getMediaOrientation(coverWidth, coverHeight),
        filename: coverName,
        dynamicFilename: dynamicName,
      },
      images,
      music: {
        title: media.music?.title || "",
        authorName: media.music?.authorName || "",
        coverUrl: media.music?.coverUrl || "",
        duration: formatDuration(media.music?.duration),
        durationSeconds: Number(media.music?.duration || 0),
        url: media.music?.url || "",
        filename: musicName,
      },
      stats,
      post,
      downloads: [
        makeDetailAction("video", t("video"), media.video?.primaryUrl, videoName, media.video?.fallbackUrls),
        makeDetailAction("cover", t("cover"), media.cover?.url, coverName),
        makeDetailAction("dynamic_cover", t("dynamic_cover"), media.cover?.dynamicUrl, dynamicName),
        makeDetailAction("music", t("music"), media.music?.url, musicName),
      ],
      rawJson: JSON.stringify(media.raw || media, null, 2),
    };
  }

  function normalizeHeaders(headers = {}, addDefaults = true) {
    const result = {};
    if (addDefaults) {
      result.Referer = "https://www.tiktok.com/";
      result.Origin = "https://www.tiktok.com";
      result["User-Agent"] =
        root?.navigator?.userAgent ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
    }
    for (const [key, value] of Object.entries(headers || {})) {
      if (value !== undefined && value !== null && value !== "") {
        result[key] = String(value);
      }
    }
    return result;
  }

  class ConfigStore {
    constructor(storage) {
      this.storage = storage;
      this.data = this.load();
    }

    load() {
      try {
        const raw = this.storage?.getItem(CONFIG_KEY);
        return sanitizeConfig(raw ? JSON.parse(raw) : {});
      } catch (_err) {
        return sanitizeConfig();
      }
    }

    save(next) {
      this.data = sanitizeConfig({ ...this.data, ...next });
      this.storage?.setItem(CONFIG_KEY, JSON.stringify(this.data));
      return this.data;
    }

    get() {
      return { ...this.data };
    }
  }

  class TikTokMediaExtractor {
    constructor(doc, win, runtimeCache = null) {
      this.document = doc;
      this.window = win;
      this.runtimeCache = runtimeCache;
    }

    getCurrentMedia(config = {}, anchorElement = null, options = {}) {
      const pageUrl = this.window?.location?.href || "";
      const requireContext = Boolean(options.requireContext);
      const anchorContext = this.getMediaContextElement(anchorElement);
      const video = anchorContext
        ? this.getContextVideoElement(anchorContext)
        : this.getCurrentVideoElement(anchorElement);
      const visibleVideo = video || this.getVisibleVideoElement();
      const visibleContext = this.getMediaContextElement(visibleVideo);
      const contextUrls = anchorContext
        ? this.getMediaUrlsFromScopes([anchorContext])
        : this.getVisibleVideoContextUrls(visibleVideo);
      const contextText = unique([
        anchorContext?.textContent || "",
        visibleContext?.textContent || "",
        visibleVideo?.parentElement?.textContent || "",
      ]).join(" ");
      const allowPageFallback = !anchorContext && !requireContext;
      const targetUrls = unique(
        anchorContext || requireContext ? contextUrls : [...contextUrls, pageUrl],
      ).filter(Boolean);
      const dataCandidates = [
        parsePageDataFromDocument(this.document),
        ...getWindowDataCandidates(this.window),
      ].filter(Boolean);

      for (const targetUrl of targetUrls) {
        if (!getVideoIdFromUrl(targetUrl)) continue;
        for (const data of dataCandidates) {
          const dataMedia = extractMediaFromPageData(data, targetUrl, config);
          if (hasUsableMedia(dataMedia)) return dataMedia;
        }
        const cachedMedia = this.runtimeCache?.getMedia(targetUrl, config);
        if (hasUsableMedia(cachedMedia)) return cachedMedia;
      }

      const cachedVisibleMedia = this.runtimeCache?.getMediaByVideoElement(
        visibleVideo,
        contextText,
        config,
        pageUrl,
      );
      if (hasUsableMedia(cachedVisibleMedia)) return cachedVisibleMedia;

      // Fallback fuzzy match against SSR/window page data (dataCandidates), mirroring the
      // runtime-cache fuzzy match above. Without this, videos whose data only ever arrives
      // via the page's initial SSR payload (rather than a later fetch/XHR response captured
      // into runtimeCache) — typically the first handful of videos in a feed — could never
      // be resolved once the DOM-based exact-id lookup above fails to find a matching link,
      // no matter how long you wait or how many times you revisit them.
      for (const data of dataCandidates) {
        const items = collectVideoItemsDeep(data);
        if (!items.length) continue;
        const fuzzyDataMedia = findBestMediaMatch(items, visibleVideo, contextText, config, pageUrl);
        if (hasUsableMedia(fuzzyDataMedia)) return fuzzyDataMedia;
      }

      const currentPageId = getVideoIdFromUrl(pageUrl);
      if (visibleVideo && currentPageId && contextUrls.length === 0) {
        for (const data of dataCandidates) {
          const dataMedia = extractMediaFromPageData(data, pageUrl, config);
          if (hasUsableMedia(dataMedia)) return dataMedia;
        }

        const cachedPageMedia = this.runtimeCache?.getMedia(pageUrl, config);
        if (hasUsableMedia(cachedPageMedia)) return cachedPageMedia;
      }

      if (anchorContext) {
        return extractMediaFromVideoElement(visibleVideo, contextUrls[0] || "") || null;
      }

      if (requireContext) {
        return extractMediaFromVideoElement(visibleVideo, contextUrls[0] || "") || null;
      }

      if (allowPageFallback) {
        for (const data of dataCandidates) {
          const dataMedia = extractMediaFromPageData(data, pageUrl, config);
          if (hasUsableMedia(dataMedia)) return dataMedia;
        }

        const cachedMedia = this.runtimeCache?.getMedia(pageUrl, config);
        if (hasUsableMedia(cachedMedia)) return cachedMedia;
      }

      return extractMediaFromVideoElement(visibleVideo, pageUrl);
    }

    getCurrentVideoElement(anchorElement = null) {
      const anchorContext = this.getMediaContextElement(anchorElement);
      return this.getContextVideoElement(anchorContext) || this.getVisibleVideoElement();
    }

    getContextVideoElement(context = null) {
      if (!context) return null;
      const videos = Array.from(context.querySelectorAll?.("video") || []);
      return this.selectBestVideoElement(videos);
    }

    getVisibleVideoElement() {
      const videos = Array.from(this.document?.querySelectorAll?.("video") || []);
      return this.selectBestVideoElement(videos);
    }

    selectBestVideoElement(videos = []) {
      const viewportWidth = Number(this.window?.innerWidth || 0);
      const viewportHeight = Number(this.window?.innerHeight || 0);
      const scored = videos
        .filter(Boolean)
        .map((video) => ({
          video,
          rect: video.getBoundingClientRect?.(),
        }))
        .map((entry) => ({
          ...entry,
          score: scoreMediaElementRect(entry.rect, viewportWidth, viewportHeight),
        }))
        .filter((entry) => Number.isFinite(entry.score))
        .sort((left, right) => right.score - left.score);
      if (scored[0]) return scored[0].video;

      return (
        videos
          .filter(Boolean)
          .filter((video) => {
            const rect = video.getBoundingClientRect?.();
            return rect && rect.width > 80 && rect.height > 80;
          })
          .sort((left, right) => {
            const leftRect = left.getBoundingClientRect();
            const rightRect = right.getBoundingClientRect();
            return rightRect.width * rightRect.height - leftRect.width * leftRect.height;
          })[0] || videos[0] || null
      );
    }

    getMediaContextElement(element = null) {
      if (!element) return null;
      const selector = [
        "article",
        "section[id*='media-card']",
        "section[data-e2e*='feed-video']",
        "section[data-e2e*='video']",
        "[id*='media-card']",
        "[data-e2e*='feed-video']",
        "[data-e2e*='video']",
        "[class*='SectionMediaCardContainer']",
        "[class*='DivContentFlexLayout']",
        "[class*='DivContentContainer']",
        "[class*='DivItemContainer']",
        "[class*='DivFeedCard']",
      ].join(",");
      const closest = element.closest?.(selector);
      if (closest) return closest;

      let current = element.parentElement || null;
      while (current && current !== this.document?.body) {
        if (this.isMediaContextElement(current)) return current;
        current = current.parentElement || null;
      }
      return null;
    }

    isMediaContextElement(element = null) {
      if (!element) return false;
      const tagName = String(element.tagName || "").toLowerCase();
      if (tagName === "article") return true;
      const className = String(element.className || "");
      const id = String(element.id || "");
      const dataE2e = String(element.getAttribute?.("data-e2e") || "");
      const signature = `${id} ${dataE2e} ${className}`;
      if (/ActionBarContainer/i.test(signature)) return false;
      if (tagName === "section" && /media-card|feed-video|video/i.test(signature)) return true;
      return /SectionMediaCardContainer|DivContentFlexLayout|DivContentContainer|DivItemContainer|DivFeedCard/i.test(
        className,
      );
    }

    getMediaUrlsFromScopes(scopes = []) {
      const urls = [];
      for (const scope of scopes) {
        const anchors = Array.from(
          scope.querySelectorAll?.("a[href*='/video/'],a[href*='/photo/']") || [],
        );
        for (const anchor of anchors) {
          const href = anchor.href || anchor.getAttribute?.("href") || "";
          if (getVideoIdFromUrl(href)) urls.push(href);
        }
        if (urls.length) break;
      }
      return unique(urls);
    }

    getVisibleVideoContextUrls(video = this.getVisibleVideoElement()) {
      const scopes = [];
      const addScope = (scope) => {
        if (scope && !scopes.includes(scope)) scopes.push(scope);
      };
      addScope(this.getMediaContextElement(video));
      addScope(video?.parentElement);
      return this.getMediaUrlsFromScopes(scopes);
    }
  }

  class Downloader {
    constructor(win, gmRequest = null) {
      this.window = win;
      this.gmRequest = gmRequest;
    }

    normalizeFetchHeaders(headers = {}) {
      const blocked = new Set(["referer", "origin", "user-agent", "cookie", "host"]);
      const result = {};
      for (const [key, value] of Object.entries(headers || {})) {
        if (!blocked.has(key.toLowerCase()) && value !== undefined && value !== null) {
          result[key] = String(value);
        }
      }
      return result;
    }

    async fetchBlob(url, headers = {}) {
      try {
        const response = await this.window.fetch(url, {
          credentials: "include",
          headers: this.normalizeFetchHeaders(headers),
          referrer: this.window.location?.href || "https://www.tiktok.com/",
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.blob();
      } catch (err) {
        if (!this.gmRequest) throw err;
        return this.fetchBlobWithGm(url, headers);
      }
    }

    fetchBlobWithGm(url, headers = {}) {
      return new Promise((resolve, reject) => {
        this.gmRequest({
          method: "GET",
          url,
          headers: normalizeHeaders(headers),
          responseType: "blob",
          onload: (response) => {
            const status = Number(response.status || 0);
            if (status >= 200 && status < 300 && response.response) {
              resolve(response.response);
              return;
            }
            reject(new Error(`HTTP ${status || "unknown"}`));
          },
          onerror: (error) => reject(error),
          ontimeout: () => reject(new Error("Request timeout")),
        });
      });
    }

    async downloadUrl(urls, filename, headers = {}) {
      const allUrls = unique(ensureArray(urls));
      let lastError = null;
      for (const url of allUrls) {
        try {
          const blob = await this.fetchBlob(url, headers);
          this.downloadBlob(blob, filename);
          return true;
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError || new Error("No download URL");
    }

    downloadBlob(blob, filename) {
      const objectUrl = this.window.URL.createObjectURL(blob);
      const anchor = this.window.document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      anchor.style.display = "none";
      this.window.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => this.window.URL.revokeObjectURL(objectUrl), 1000);
    }
  }

  function createElement(doc, tag, className, text) {
    const element = doc.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function calculatePanelPosition(options = {}) {
    const buttonSize = Number(options.buttonSize || 44);
    const gap = Number(options.gap || 10);
    const margin = Number(options.margin || 8);
    const viewportWidth = Number(options.viewportWidth || 0);
    const viewportHeight = Number(options.viewportHeight || 0);
    const anchor = options.anchorRect;
    if (!anchor) {
      return {
        left: Math.max(margin, viewportWidth - buttonSize - 18),
        top: Math.max(margin, viewportHeight - buttonSize - 80),
      };
    }
    const anchorCenter = Number(anchor.left || 0) + Number(anchor.width || 0) / 2;
    const left = Math.round(anchorCenter - buttonSize / 2);
    const top = Math.round(Number(anchor.top || 0) + Number(anchor.height || 0) + gap);
    return {
      left: Math.min(Math.max(margin, left), Math.max(margin, viewportWidth - buttonSize - margin)),
      top: Math.min(Math.max(margin, top), Math.max(margin, viewportHeight - buttonSize - margin)),
    };
  }

  function calculateEmbeddedPanelPosition(options = {}) {
    const buttonSize = Number(options.buttonSize || 44);
    const gap = Number(options.gap || 8);
    const margin = Number(options.margin || 8);
    const viewportWidth = Number(options.viewportWidth || 0);
    const viewportHeight = Number(options.viewportHeight || 0);
    const anchor = options.anchorRect;
    if (!anchor) {
      return calculatePanelPosition({ buttonSize, gap, margin, viewportWidth, viewportHeight });
    }
    const edges = getRectEdges(anchor);
    const maxLeft = Math.max(margin, viewportWidth - buttonSize - margin);
    const maxTop = Math.max(margin, viewportHeight - buttonSize - margin);
    const left = Math.min(Math.max(margin, Math.round(edges.centerX - buttonSize / 2)), maxLeft);
    const nextEdges = options.nextRect ? getRectEdges(options.nextRect) : null;
    let top = Math.round(edges.top - buttonSize - gap);
    if (top < margin && nextEdges) {
      const betweenGap = nextEdges.top - edges.bottom;
      if (betweenGap >= buttonSize + gap * 2) {
        top = Math.round(edges.bottom + (betweenGap - buttonSize) / 2);
      }
    }
    if (top < margin) {
      top = Math.round(edges.bottom + gap);
    }
    return {
      left,
      top: Math.min(Math.max(margin, top), maxTop),
    };
  }

  function clampNumber(value, min, max) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
  }

  function calculatePanelMenuPlacement(options = {}) {
    const gap = Number(options.gap || 10);
    const margin = Number(options.margin || 8);
    const viewportWidth = Number(options.viewportWidth || 0);
    const viewportHeight = Number(options.viewportHeight || 0);
    const menuWidth = Number(options.menuWidth || 160);
    const menuHeight = Number(options.menuHeight || 180);
    const panelRect = options.panelRect;
    const anchorRect = options.launcherRect || options.buttonRect || panelRect;
    if (!anchorRect || !viewportWidth || !viewportHeight) {
      return { placement: "top", left: margin, top: margin };
    }

    const edges = getRectEdges(anchorRect);
    const buttonWidth = Number(options.buttonWidth || edges.width || options.buttonSize || 44);
    const maxLeft = Math.max(margin, viewportWidth - menuWidth - margin);
    const maxTop = Math.max(margin, viewportHeight - menuHeight - margin);

    return {
      placement: "top",
      left: clampNumber(
        Math.round(edges.left + buttonWidth / 2 - menuWidth / 2),
        margin,
        maxLeft,
      ),
      top: clampNumber(Math.round(edges.top - menuHeight - gap), margin, maxTop),
    };
  }

  function isActionBarClassName(className = "") {
    const value = String(className || "");
    return /ActionBarContainer/i.test(value) && !/FeedNavigation|NavigationContainer/i.test(value);
  }

  function getRectEdges(rect = {}) {
    const left = Number(rect.left || 0);
    const top = Number(rect.top || 0);
    const width = Number(rect.width || 0);
    const height = Number(rect.height || 0);
    return {
      left,
      top,
      right: Number(rect.right ?? left + width),
      bottom: Number(rect.bottom ?? top + height),
      width,
      height,
      centerX: Number(rect.centerX ?? left + width / 2),
      centerY: Number(rect.centerY ?? top + height / 2),
    };
  }

  function getVisibleRectRatio(rect, viewportWidth, viewportHeight) {
    const edges = getRectEdges(rect);
    const visibleWidth = Math.max(
      0,
      Math.min(edges.right, viewportWidth) - Math.max(edges.left, 0),
    );
    const visibleHeight = Math.max(
      0,
      Math.min(edges.bottom, viewportHeight) - Math.max(edges.top, 0),
    );
    const area = Math.max(1, edges.width * edges.height);
    return (visibleWidth * visibleHeight) / area;
  }

  function isUsableActionBarRect(rect, viewportWidth = 0, viewportHeight = 0) {
    if (!rect || !viewportWidth || !viewportHeight) return false;
    const edges = getRectEdges(rect);
    if (edges.width < 32 || edges.width > 140) return false;
    if (edges.height < 120 || edges.height > viewportHeight * 1.25) return false;
    if (edges.left < viewportWidth * 0.18 || edges.right > viewportWidth + 24) return false;
    if (getVisibleRectRatio(edges, viewportWidth, viewportHeight) < 0.62) return false;
    return true;
  }

  function scoreActionBarRect(rect, viewportWidth = 0, viewportHeight = 0) {
    if (!isUsableActionBarRect(rect, viewportWidth, viewportHeight)) return -Infinity;
    const edges = getRectEdges(rect);
    const centerDistance = Math.abs(edges.centerY - viewportHeight / 2) / viewportHeight;
    const visibleRatio = getVisibleRectRatio(edges, viewportWidth, viewportHeight);
    const sideScore = Math.min(1, Math.max(0, edges.left / Math.max(1, viewportWidth)));
    return visibleRatio * 100 + sideScore * 10 - centerDistance * 30;
  }

  function scoreMediaElementRect(rect, viewportWidth = 0, viewportHeight = 0) {
    if (!rect) return -Infinity;
    const edges = getRectEdges(rect);
    if (edges.width < 80 || edges.height < 80) return -Infinity;
    if (!viewportWidth || !viewportHeight) return edges.width * edges.height;
    const visibleRatio = getVisibleRectRatio(edges, viewportWidth, viewportHeight);
    if (visibleRatio <= 0.03) return -Infinity;
    const centerDistance =
      Math.hypot(edges.centerX - viewportWidth / 2, edges.centerY - viewportHeight / 2) /
      Math.max(1, Math.hypot(viewportWidth, viewportHeight));
    const areaRatio = Math.min(1, (edges.width * edges.height) / Math.max(1, viewportWidth * viewportHeight));
    return visibleRatio * 120 + areaRatio * 18 - centerDistance * 45;
  }

  function isAvatarActionChild(element) {
    if (!element) return false;
    const text = [
      element.className,
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("data-e2e"),
      element.title,
      element.textContent,
    ]
      .filter(Boolean)
      .join(" ");
    return /avatar|profile|author|follow|DivAvatar|AvatarAction/i.test(text);
  }

  function getNativeActionControl(element) {
    if (!element) return null;
    if (element.matches?.("button,[role='button'],a")) return element;
    return element.querySelector?.("button,[role='button'],a") || element;
  }

  function parseRgbColor(value = "") {
    const match = String(value || "").match(/rgba?\(([^)]+)\)/i);
    if (!match) return null;
    const parts = match[1]
      .split(",")
      .map((part) => Number(String(part).trim()))
      .filter((part) => Number.isFinite(part));
    if (parts.length < 3) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }

  function isLightColor(value = "") {
    const color = parseRgbColor(value);
    if (!color || color.a === 0) return false;
    const luminance = (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255;
    return luminance > 0.72;
  }

  function isTransparentColor(value = "") {
    const color = parseRgbColor(value);
    return !color || color.a === 0;
  }

  function getEmbeddedLauncherPalette(backgroundColor = "", color = "") {
    const background = isTransparentColor(backgroundColor)
      ? "rgb(36, 36, 36)"
      : String(backgroundColor);
    const light = isLightColor(background);
    return {
      background,
      color: color || (light ? "rgb(22, 24, 35)" : "rgb(255, 255, 255)"),
      hoverBackground: light ? "rgb(232, 232, 232)" : "rgb(47, 47, 47)",
    };
  }

  // Extracted from the TikTokDlApp UI so the ~900 lines of injected CSS live in one
  // place, independent of DOM/class state (it only interpolates the static
  // SCRIPT_PREFIX constant). See injectStyles() for where this gets attached.
  function getPanelStyleSheet() {
    return `
        .${SCRIPT_PREFIX}-panel {
          position: fixed;
          right: 18px;
          bottom: 80px;
          z-index: 2147483200;
          width: 44px;
          height: 44px;
          font-family: Arial, sans-serif;
          color-scheme: dark;
        }
        .${SCRIPT_PREFIX}-panel.light { color-scheme: light; }
        .${SCRIPT_PREFIX}-panel.pending {
          visibility: hidden;
          pointer-events: none;
        }
        .${SCRIPT_PREFIX}-image-button {
          /* Standalone element (not part of .panel/.menu) shown only while an image preview
             is detected as open -- see refreshImageOverlayState(). JS chooses a corner that
             does not overlap the preview image; if none exists, the button stays hidden. */
          position: fixed;
          right: 18px;
          bottom: 80px;
          z-index: 2147483200;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 999px;
          padding: 11px 18px;
          color: #fff;
          background: rgba(37, 37, 37, 0.96);
          font-family: Arial, sans-serif;
          font-size: 13px;
          font-weight: 600;
          white-space: nowrap;
          cursor: pointer;
          box-shadow: 0 8px 22px rgba(0, 0, 0, 0.32);
          transition: transform 0.12s ease, background 0.12s ease;
        }
        .${SCRIPT_PREFIX}-image-button:hover,
        .${SCRIPT_PREFIX}-image-button:focus-visible {
          background: #fe2c55;
          transform: translateY(-1px);
        }
        .${SCRIPT_PREFIX}-image-button.light {
          color: #111;
          background: rgba(255, 255, 255, 0.96);
          border-color: rgba(0, 0, 0, 0.12);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
        }
        .${SCRIPT_PREFIX}-image-button.light:hover,
        .${SCRIPT_PREFIX}-image-button.light:focus-visible {
          background: #fe2c55;
          color: #fff;
        }
        .${SCRIPT_PREFIX}-panel.embedded {
          position: fixed;
          right: auto !important;
          bottom: auto !important;
          z-index: 2147483200;
          width: var(--${SCRIPT_PREFIX}-action-size, 48px);
          height: var(--${SCRIPT_PREFIX}-action-size, 48px);
          pointer-events: auto;
          contain: layout style;
          overflow: visible;
          isolation: isolate;
        }
        .${SCRIPT_PREFIX}-launcher {
          display: grid;
          place-items: center;
          width: 44px;
          height: 44px;
          border-radius: 50%;
          border: 1px solid rgba(255, 255, 255, 0.14);
          padding: 0;
          color: #fff;
          background: rgba(37, 37, 37, 0.96);
          box-sizing: border-box;
          cursor: pointer;
          box-shadow: 0 8px 22px rgba(0, 0, 0, 0.32);
          transition: transform 0.12s ease, background 0.12s ease, border-color 0.12s ease;
        }
        .${SCRIPT_PREFIX}-panel.embedded .${SCRIPT_PREFIX}-launcher {
          width: 100%;
          height: 100%;
          border: 0;
          color: var(--${SCRIPT_PREFIX}-action-color, #fff);
          background: var(--${SCRIPT_PREFIX}-action-bg, #242424);
          box-shadow: none;
        }
        .${SCRIPT_PREFIX}-panel.embedded.light .${SCRIPT_PREFIX}-launcher {
          color: var(--${SCRIPT_PREFIX}-action-color, #111);
          background: var(--${SCRIPT_PREFIX}-action-bg, #f1f1f1);
          box-shadow: none;
        }
        .${SCRIPT_PREFIX}-panel.light .${SCRIPT_PREFIX}-launcher {
          color: #111;
          background: rgba(255, 255, 255, 0.96);
          border-color: rgba(0, 0, 0, 0.12);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
        }
        .${SCRIPT_PREFIX}-launcher:hover,
        .${SCRIPT_PREFIX}-panel.open .${SCRIPT_PREFIX}-launcher {
          background: #fe2c55;
          color: #fff;
          transform: translateY(-1px);
        }
        .${SCRIPT_PREFIX}-panel.embedded .${SCRIPT_PREFIX}-launcher:hover,
        .${SCRIPT_PREFIX}-panel.embedded.open .${SCRIPT_PREFIX}-launcher {
          color: var(--${SCRIPT_PREFIX}-action-color, #fff);
          background: var(--${SCRIPT_PREFIX}-action-hover-bg, #2f2f2f);
          transform: none;
        }
        .${SCRIPT_PREFIX}-launcher svg {
          width: 20px;
          height: 20px;
          pointer-events: none;
        }
        .${SCRIPT_PREFIX}-panel.embedded .${SCRIPT_PREFIX}-launcher svg {
          width: 22px;
          height: 22px;
        }
        .${SCRIPT_PREFIX}-menu {
          position: absolute;
          left: 50%;
          bottom: 52px;
          transform: translateX(-50%);
          display: none;
          width: 160px;
          overflow: hidden;
          border-radius: 8px;
          background: rgba(18, 18, 18, 0.96);
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 12px 36px rgba(0, 0, 0, 0.38);
        }
        .${SCRIPT_PREFIX}-panel.open .${SCRIPT_PREFIX}-menu { display: block; }
        .${SCRIPT_PREFIX}-panel.embedded .${SCRIPT_PREFIX}-menu {
          position: absolute;
          left: 50%;
          right: auto;
          top: auto;
          bottom: calc(100% + 10px);
          transform: translateX(-50%);
        }
        .${SCRIPT_PREFIX}-panel.light .${SCRIPT_PREFIX}-menu {
          background: rgba(255, 255, 255, 0.98);
          border-color: rgba(0, 0, 0, 0.08);
          box-shadow: 0 12px 36px rgba(0, 0, 0, 0.18);
        }
        .${SCRIPT_PREFIX}-button {
          border: 0;
          border-radius: 6px;
          padding: 12px 14px;
          color: #fff;
          background: transparent;
          cursor: pointer;
          font-size: 13px;
          text-align: left;
          font-family: inherit;
        }
        .${SCRIPT_PREFIX}-menu .${SCRIPT_PREFIX}-button {
          width: 100%;
          border-radius: 0;
          background: transparent;
        }
        .${SCRIPT_PREFIX}-panel.light .${SCRIPT_PREFIX}-button { color: #111; }
        .${SCRIPT_PREFIX}-menu .${SCRIPT_PREFIX}-button:hover,
        .${SCRIPT_PREFIX}-menu .${SCRIPT_PREFIX}-button:focus-visible,
        .${SCRIPT_PREFIX}-button:hover {
          background: #fe2c55;
          color: #fff;
        }
        .${SCRIPT_PREFIX}-button.secondary { background: transparent; }
        .${SCRIPT_PREFIX}-button.secondary:hover,
        .${SCRIPT_PREFIX}-button.secondary:focus-visible {
          color: #fff;
          background: #fe2c55;
        }
        .${SCRIPT_PREFIX}-toast {
          position: fixed;
          right: 18px;
          bottom: 24px;
          z-index: 2147483700;
          max-width: min(360px, calc(100vw - 36px));
          padding: 9px 12px;
          border-radius: 6px;
          color: #fff;
          background: rgba(0, 0, 0, 0.82);
          font: 13px Arial, sans-serif;
        }
        .${SCRIPT_PREFIX}-toast.light {
          color: #111;
          background: rgba(255, 255, 255, 0.94);
          box-shadow: 0 6px 26px rgba(0, 0, 0, 0.14);
        }
        .${SCRIPT_PREFIX}-modal-backdrop {
          position: fixed;
          inset: 0;
          z-index: 2147483600;
          background: rgba(0, 0, 0, 0.58);
          display: grid;
          place-items: center;
          padding: 14px;
        }
        .${SCRIPT_PREFIX}-modal {
          width: min(900px, calc(100vw - 28px));
          max-height: min(760px, calc(100vh - 28px));
          overflow: auto;
          border-radius: 8px;
          background: #fff;
          color: #111;
          font: 14px Arial, sans-serif;
          box-shadow: 0 16px 60px rgba(0, 0, 0, 0.32);
        }
        .${SCRIPT_PREFIX}-modal.dark {
          background: #171717;
          color: #f6f6f6;
        }
        .${SCRIPT_PREFIX}-modal.dark header,
        .${SCRIPT_PREFIX}-modal.dark td,
        .${SCRIPT_PREFIX}-modal.dark th {
          border-color: #2a2a2a;
        }
        .${SCRIPT_PREFIX}-modal header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          padding: 18px 22px;
          border-bottom: 1px solid #eee;
        }
        .${SCRIPT_PREFIX}-modal main { padding: 18px 22px 22px; }
        .${SCRIPT_PREFIX}-modal h2 {
          margin: 0;
          font-size: 20px;
          line-height: 1.2;
        }
        .${SCRIPT_PREFIX}-modal .${SCRIPT_PREFIX}-subtitle {
          margin: 5px 0 0;
          color: #666;
          font-size: 13px;
        }
        .${SCRIPT_PREFIX}-modal.dark .${SCRIPT_PREFIX}-subtitle { color: #a8a8a8; }
        .${SCRIPT_PREFIX}-close {
          flex: 0 0 auto;
          border: 1px solid #ddd;
          border-radius: 999px;
          padding: 7px 13px;
          color: inherit;
          background: transparent;
          cursor: pointer;
          font: inherit;
        }
        .${SCRIPT_PREFIX}-modal.dark .${SCRIPT_PREFIX}-close { border-color: #343434; }
        .${SCRIPT_PREFIX}-close:hover {
          color: #fff;
          background: #fe2c55;
          border-color: #fe2c55;
        }
        .${SCRIPT_PREFIX}-settings-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }
        .${SCRIPT_PREFIX}-section {
          display: grid;
          gap: 12px;
          margin-bottom: 18px;
        }
        .${SCRIPT_PREFIX}-section-title {
          margin: 0;
          color: #fe2c55;
          font-size: 13px;
          font-weight: 700;
          text-transform: uppercase;
        }
        .${SCRIPT_PREFIX}-field {
          position: relative;
          min-width: 0;
        }
        .${SCRIPT_PREFIX}-field.full { grid-column: 1 / -1; }
        .${SCRIPT_PREFIX}-settings-grid > .full { grid-column: 1 / -1; }
        .${SCRIPT_PREFIX}-modal label {
          display: flex;
          align-items: center;
          gap: 6px;
          margin: 0 0 6px;
          font-weight: 700;
        }
        .${SCRIPT_PREFIX}-modal input,
        .${SCRIPT_PREFIX}-modal select,
        .${SCRIPT_PREFIX}-modal textarea {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid #ddd;
          border-radius: 6px;
          padding: 9px 10px;
          font: inherit;
        }
        .${SCRIPT_PREFIX}-modal.dark input,
        .${SCRIPT_PREFIX}-modal.dark select,
        .${SCRIPT_PREFIX}-modal.dark textarea {
          color: #f6f6f6;
          background: #242424;
          border-color: #3a3a3a;
        }
        .${SCRIPT_PREFIX}-modal textarea {
          min-height: 78px;
          resize: vertical;
        }
        .${SCRIPT_PREFIX}-modal table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 10px;
          font-size: 12px;
        }
        .${SCRIPT_PREFIX}-modal td,
        .${SCRIPT_PREFIX}-modal th {
          border-bottom: 1px solid #eee;
          padding: 6px;
          text-align: left;
          vertical-align: top;
        }
        .${SCRIPT_PREFIX}-detail-tabs {
          display: flex;
          gap: 8px;
          margin-bottom: 14px;
          border-bottom: 1px solid #eee;
        }
        .${SCRIPT_PREFIX}-modal.dark .${SCRIPT_PREFIX}-detail-tabs { border-color: #2a2a2a; }
        .${SCRIPT_PREFIX}-detail-tab {
          border: 0;
          border-bottom: 2px solid transparent;
          padding: 9px 10px;
          color: inherit;
          background: transparent;
          cursor: pointer;
          font: inherit;
        }
        .${SCRIPT_PREFIX}-detail-tab.active {
          color: #fe2c55;
          border-bottom-color: #fe2c55;
        }
        .${SCRIPT_PREFIX}-detail-panel[hidden] { display: none !important; }
        .${SCRIPT_PREFIX}-detail-section {
          display: grid;
          gap: 10px;
          margin-bottom: 18px;
        }
        .${SCRIPT_PREFIX}-detail-section h3 {
          margin: 0;
          font-size: 15px;
        }
        .${SCRIPT_PREFIX}-detail-grid,
        .${SCRIPT_PREFIX}-stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: 8px;
        }
        .${SCRIPT_PREFIX}-kv,
        .${SCRIPT_PREFIX}-stat {
          min-width: 0;
          border: 1px solid #eee;
          border-radius: 6px;
          padding: 8px 10px;
          background: #fafafa;
        }
        .${SCRIPT_PREFIX}-modal.dark .${SCRIPT_PREFIX}-kv,
        .${SCRIPT_PREFIX}-modal.dark .${SCRIPT_PREFIX}-stat {
          border-color: #303030;
          background: #1f1f1f;
        }
        .${SCRIPT_PREFIX}-kv small,
        .${SCRIPT_PREFIX}-stat small {
          display: block;
          margin-bottom: 3px;
          color: #777;
          font-size: 11px;
        }
        .${SCRIPT_PREFIX}-modal.dark .${SCRIPT_PREFIX}-kv small,
        .${SCRIPT_PREFIX}-modal.dark .${SCRIPT_PREFIX}-stat small { color: #aaa; }
        .${SCRIPT_PREFIX}-kv span,
        .${SCRIPT_PREFIX}-stat strong {
          display: block;
          min-width: 0;
          overflow-wrap: anywhere;
        }
        .${SCRIPT_PREFIX}-cover-preview {
          max-width: 180px;
          max-height: 240px;
          border-radius: 6px;
          object-fit: cover;
          background: #111;
        }
        .${SCRIPT_PREFIX}-link {
          color: #fe2c55;
          overflow-wrap: anywhere;
        }
        .${SCRIPT_PREFIX}-json-pre {
          max-height: 360px;
          overflow: auto;
          margin: 0;
          border: 1px solid #eee;
          border-radius: 6px;
          padding: 10px;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          background: #f7f7f7;
          font: 12px Consolas, "Courier New", monospace;
        }
        .${SCRIPT_PREFIX}-modal.dark .${SCRIPT_PREFIX}-json-pre {
          border-color: #303030;
          background: #101010;
        }
        .${SCRIPT_PREFIX}-details-modal {
          position: relative;
          width: min(1120px, calc(100vw - 28px));
          overflow: hidden;
          border-radius: 14px;
          background: #fbfbfb;
        }
        .${SCRIPT_PREFIX}-details-modal.dark {
          background: #111;
          color: #f5f5f5;
        }
        .${SCRIPT_PREFIX}-details-modal main {
          display: flex;
          flex-direction: column;
          padding: 0;
          max-height: min(780px, calc(100vh - 28px));
        }
        .${SCRIPT_PREFIX}-details-close {
          position: absolute;
          top: 10px;
          right: 10px;
          z-index: 2;
          width: 34px;
          height: 34px;
          border: 0;
          border-radius: 999px;
          color: inherit;
          background: rgba(127, 127, 127, 0.12);
          cursor: pointer;
          font: 20px Arial, sans-serif;
        }
        .${SCRIPT_PREFIX}-details-close:hover {
          color: #fff;
          background: #fe2c55;
        }
        .${SCRIPT_PREFIX}-launcher:focus,
        .${SCRIPT_PREFIX}-details-close:focus,
        .${SCRIPT_PREFIX}-details-modal .${SCRIPT_PREFIX}-detail-tab:focus,
        .${SCRIPT_PREFIX}-detail-pill:focus {
          outline: none;
        }
        .${SCRIPT_PREFIX}-launcher:focus-visible,
        .${SCRIPT_PREFIX}-details-close:focus-visible,
        .${SCRIPT_PREFIX}-details-modal .${SCRIPT_PREFIX}-detail-tab:focus-visible,
        .${SCRIPT_PREFIX}-detail-pill:focus-visible {
          outline: 2px solid rgba(254, 44, 85, 0.75);
          outline-offset: 2px;
        }
        .${SCRIPT_PREFIX}-details-modal .${SCRIPT_PREFIX}-detail-tabs {
          flex: 0 0 auto;
          display: flex;
          gap: 0;
          margin: 0;
          padding: 0 48px 0 12px;
          overflow-x: auto;
          border-bottom: 1px solid #dedede;
          background: #f2f2f2;
        }
        .${SCRIPT_PREFIX}-details-modal.dark .${SCRIPT_PREFIX}-detail-tabs {
          border-color: #252525;
          background: #141414;
        }
        .${SCRIPT_PREFIX}-details-modal .${SCRIPT_PREFIX}-detail-tab {
          min-width: 112px;
          border: 0;
          border-bottom: 3px solid transparent;
          padding: 18px 20px 15px;
          color: #555;
          background: transparent;
          font-size: 16px;
          font-weight: 700;
        }
        .${SCRIPT_PREFIX}-details-modal.dark .${SCRIPT_PREFIX}-detail-tab { color: #cfcfcf; }
        .${SCRIPT_PREFIX}-details-modal .${SCRIPT_PREFIX}-detail-tab.active {
          color: #fe2c55;
          border-bottom-color: #fe2c55;
          background: rgba(254, 44, 85, 0.06);
        }
        .${SCRIPT_PREFIX}-detail-body {
          flex: 1 1 auto;
          overflow: auto;
          padding: 22px 28px 28px;
        }
        .${SCRIPT_PREFIX}-detail-fieldset {
          min-width: 0;
          margin: 0 0 22px;
          border: 1px solid #d8d8d8;
          border-radius: 12px;
          padding: 22px 24px;
        }
        .${SCRIPT_PREFIX}-details-modal.dark .${SCRIPT_PREFIX}-detail-fieldset {
          border-color: #333;
          background: rgba(255, 255, 255, 0.015);
        }
        .${SCRIPT_PREFIX}-settings-modal.dark .${SCRIPT_PREFIX}-detail-fieldset {
          border-color: #333;
          background: rgba(255, 255, 255, 0.015);
        }
        .${SCRIPT_PREFIX}-detail-fieldset legend {
          padding: 0 12px;
          font-weight: 800;
          font-size: 15px;
        }
        .${SCRIPT_PREFIX}-detail-cover-row,
        .${SCRIPT_PREFIX}-detail-author-head {
          display: flex;
          gap: 22px;
          align-items: center;
          min-width: 0;
        }
        .${SCRIPT_PREFIX}-detail-cover-row.${SCRIPT_PREFIX}-cover-portrait {
          flex-direction: row;
          align-items: center;
        }
        .${SCRIPT_PREFIX}-detail-cover-row.${SCRIPT_PREFIX}-cover-landscape {
          flex-direction: column;
          align-items: flex-start;
        }
        .${SCRIPT_PREFIX}-detail-cover-row.${SCRIPT_PREFIX}-cover-square {
          flex-direction: row;
        }
        .${SCRIPT_PREFIX}-detail-cover {
          width: 180px;
          height: 101px;
          max-width: 34vw;
          aspect-ratio: 16 / 9;
          border-radius: 6px;
          object-fit: cover;
          background: #0f0f0f;
        }
        .${SCRIPT_PREFIX}-detail-cover-row.${SCRIPT_PREFIX}-cover-portrait .${SCRIPT_PREFIX}-detail-cover {
          width: min(252px, 40vw);
          height: min(448px, 71.1vw);
          max-width: 100%;
          aspect-ratio: 9 / 16;
        }
        .${SCRIPT_PREFIX}-detail-cover-row.${SCRIPT_PREFIX}-cover-portrait > div,
        .${SCRIPT_PREFIX}-detail-cover-row.${SCRIPT_PREFIX}-cover-square > div {
          flex: 1 1 190px;
          min-width: 170px;
        }
        .${SCRIPT_PREFIX}-detail-cover-row.${SCRIPT_PREFIX}-cover-square .${SCRIPT_PREFIX}-detail-cover {
          width: 150px;
          height: 150px;
          aspect-ratio: 1;
        }
        .${SCRIPT_PREFIX}-detail-cover-row.${SCRIPT_PREFIX}-cover-landscape .${SCRIPT_PREFIX}-detail-cover {
          width: min(420px, 100%);
          height: auto;
          max-width: 100%;
        }
        .${SCRIPT_PREFIX}-detail-cover-row.${SCRIPT_PREFIX}-cover-landscape > div {
          width: min(420px, 100%);
          min-width: 0;
        }
        .${SCRIPT_PREFIX}-detail-avatar {
          width: 76px;
          height: 76px;
          border-radius: 50%;
          object-fit: cover;
          background: #2b2b2b;
        }
        .${SCRIPT_PREFIX}-detail-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 9px;
          align-items: center;
          margin-top: 12px;
        }
        .${SCRIPT_PREFIX}-detail-pill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 30px;
          border: 1px solid #bdbdbd;
          border-radius: 999px;
          padding: 5px 14px;
          color: inherit;
          background: rgba(127, 127, 127, 0.08);
          cursor: pointer;
          text-decoration: none;
          font: 13px Arial, sans-serif;
          white-space: nowrap;
        }
        .${SCRIPT_PREFIX}-details-modal.dark .${SCRIPT_PREFIX}-detail-pill {
          border-color: #555;
          background: rgba(255, 255, 255, 0.06);
        }
        .${SCRIPT_PREFIX}-detail-pill:hover {
          color: #fff;
          border-color: #fe2c55;
          background: #fe2c55;
        }
        .${SCRIPT_PREFIX}-detail-table-wrap {
          overflow: auto;
          border: 1px solid #dedede;
          border-radius: 8px;
        }
        .${SCRIPT_PREFIX}-details-modal.dark .${SCRIPT_PREFIX}-detail-table-wrap {
          border-color: #2d2d2d;
        }
        .${SCRIPT_PREFIX}-detail-table {
          margin: 0;
          min-width: 780px;
          border-collapse: collapse;
          font-size: 13px;
        }
        .${SCRIPT_PREFIX}-detail-table th,
        .${SCRIPT_PREFIX}-detail-table td {
          border-right: 1px solid #e6e6e6;
          border-bottom: 1px solid #e6e6e6;
          padding: 12px;
          vertical-align: middle;
        }
        .${SCRIPT_PREFIX}-details-modal.dark .${SCRIPT_PREFIX}-detail-table th,
        .${SCRIPT_PREFIX}-details-modal.dark .${SCRIPT_PREFIX}-detail-table td {
          border-color: #2a2a2a;
        }
        .${SCRIPT_PREFIX}-detail-table th {
          font-weight: 800;
          background: rgba(127, 127, 127, 0.08);
        }
        .${SCRIPT_PREFIX}-detail-rows {
          width: 100%;
          border-collapse: collapse;
          margin: 0;
          font-size: 14px;
        }
        .${SCRIPT_PREFIX}-detail-rows th,
        .${SCRIPT_PREFIX}-detail-rows td {
          border-bottom: 1px solid #e6e6e6;
          padding: 10px 0;
          vertical-align: top;
        }
        .${SCRIPT_PREFIX}-details-modal.dark .${SCRIPT_PREFIX}-detail-rows th,
        .${SCRIPT_PREFIX}-details-modal.dark .${SCRIPT_PREFIX}-detail-rows td {
          border-color: #292929;
        }
        .${SCRIPT_PREFIX}-detail-rows th {
          width: 150px;
          padding-right: 18px;
          color: #666;
          text-align: left;
          font-weight: 800;
        }
        .${SCRIPT_PREFIX}-details-modal.dark .${SCRIPT_PREFIX}-detail-rows th { color: #aaa; }
        .${SCRIPT_PREFIX}-detail-value {
          overflow-wrap: anywhere;
          white-space: pre-wrap;
        }
        .${SCRIPT_PREFIX}-detail-json-actions {
          display: flex;
          gap: 10px;
          margin-bottom: 10px;
        }
        .${SCRIPT_PREFIX}-details-modal .${SCRIPT_PREFIX}-json-pre {
          max-height: 560px;
          border-color: #d8d8d8;
        }
        .${SCRIPT_PREFIX}-detail-audio {
          width: 100%;
          min-width: 0;
          height: 54px;
          margin: 0;
        }
        .${SCRIPT_PREFIX}-detail-music-section {
          overflow: hidden;
        }
        .${SCRIPT_PREFIX}-detail-audio-row {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
          width: 100%;
          margin-bottom: 16px;
        }
        .${SCRIPT_PREFIX}-detail-music-cover {
          flex: 0 0 54px;
          width: 54px;
          height: 54px;
          border-radius: 6px;
          object-fit: cover;
          background: #202020;
        }
        .${SCRIPT_PREFIX}-detail-audio-row .${SCRIPT_PREFIX}-detail-audio {
          flex: 1 1 auto;
          width: auto;
        }
        .${SCRIPT_PREFIX}-detail-music-url {
          display: -webkit-box;
          max-height: 6.4em;
          overflow: hidden;
          white-space: normal;
          overflow-wrap: anywhere;
          word-break: break-word;
          line-height: 1.6;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 4;
        }
        .${SCRIPT_PREFIX}-source-properties {
          display: grid;
          gap: 10px;
          margin-bottom: 14px;
        }
        .${SCRIPT_PREFIX}-source-properties .${SCRIPT_PREFIX}-chip-list {
          max-height: 112px;
          overflow: auto;
          align-content: flex-start;
        }
        .${SCRIPT_PREFIX}-detail-media-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 22px;
          align-items: stretch;
        }
        .${SCRIPT_PREFIX}-detail-media-grid > .${SCRIPT_PREFIX}-detail-fieldset {
          margin-bottom: 22px;
        }
        .${SCRIPT_PREFIX}-cover-resolution {
          display: inline-block;
          font-size: 22px;
          line-height: 1.25;
          white-space: nowrap;
          overflow-wrap: normal;
          word-break: keep-all;
          letter-spacing: 0;
        }
        .${SCRIPT_PREFIX}-single-line-link {
          display: block;
          max-width: min(100%, 520px);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          overflow-wrap: normal;
        }
        .${SCRIPT_PREFIX}-settings-modal {
          position: relative;
          display: flex;
          flex-direction: column;
          width: min(860px, calc(100vw - 72px));
          max-height: min(700px, calc(100vh - 72px));
          overflow: hidden;
          border-radius: 14px;
          background: #fbfbfb;
        }
        .${SCRIPT_PREFIX}-settings-modal.dark {
          background: #111;
          color: #f5f5f5;
        }
        .${SCRIPT_PREFIX}-settings-modal main {
          flex: 1 1 auto;
          min-height: 0;
          padding: 18px 22px 22px;
          max-height: none;
          overflow: auto;
        }
        .${SCRIPT_PREFIX}-settings-header {
          position: sticky;
          top: 0;
          z-index: 2;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 16px 22px;
          border-bottom: 1px solid #dedede;
          background: #f2f2f2;
        }
        .${SCRIPT_PREFIX}-settings-modal.dark .${SCRIPT_PREFIX}-settings-header {
          border-color: #252525;
          background: #141414;
        }
        .${SCRIPT_PREFIX}-settings-header h2 {
          margin: 0;
          color: #fe2c55;
          font-size: 20px;
          font-weight: 800;
        }
        .${SCRIPT_PREFIX}-settings-header-actions {
          display: flex;
          gap: 10px;
          align-items: center;
        }
        .${SCRIPT_PREFIX}-settings-header-actions .${SCRIPT_PREFIX}-button {
          width: auto;
          border-radius: 999px;
          padding: 10px 20px;
          text-align: center;
        }
        .${SCRIPT_PREFIX}-settings-header-actions .${SCRIPT_PREFIX}-button.primary {
          background: #fe2c55;
        }
        .${SCRIPT_PREFIX}-settings-header-actions .${SCRIPT_PREFIX}-button.secondary {
          color: inherit;
          border: 1px solid rgba(127, 127, 127, 0.28);
          background: rgba(127, 127, 127, 0.08);
        }
        .${SCRIPT_PREFIX}-settings-header-actions .${SCRIPT_PREFIX}-button.secondary:hover {
          color: #fff;
          border-color: #fe2c55;
          background: #fe2c55;
        }
        .${SCRIPT_PREFIX}-settings-fieldset .${SCRIPT_PREFIX}-settings-grid {
          align-items: start;
        }
        .${SCRIPT_PREFIX}-settings-fieldset {
          margin-bottom: 16px;
          padding: 17px 20px 19px;
        }
        .${SCRIPT_PREFIX}-settings-note {
          display: flex;
          align-items: center;
          min-height: 42px;
          box-sizing: border-box;
          border: 1px solid #e5e5e5;
          border-radius: 8px;
          padding: 10px 12px;
          background: rgba(127, 127, 127, 0.06);
        }
        .${SCRIPT_PREFIX}-modal.dark .${SCRIPT_PREFIX}-settings-note {
          border-color: #303030;
          background: rgba(255, 255, 255, 0.04);
        }
        .${SCRIPT_PREFIX}-filename-template-editor {
          display: grid;
          gap: 12px;
        }
        .${SCRIPT_PREFIX}-filename-preview {
          min-height: 22px;
          border-top: 1px solid #d8d8d8;
          padding-top: 12px;
          color: inherit;
          font-weight: 700;
          overflow-wrap: anywhere;
        }
        .${SCRIPT_PREFIX}-modal.dark .${SCRIPT_PREFIX}-filename-preview {
          border-color: #303030;
        }
        .${SCRIPT_PREFIX}-frame-modal {
          width: min(560px, calc(100vw - 28px));
          overflow: hidden;
        }
        .${SCRIPT_PREFIX}-frame-preview {
          width: 100%;
          max-height: min(60vh, 520px);
          border-radius: 8px;
          object-fit: contain;
          background: #111;
        }
        .${SCRIPT_PREFIX}-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
        .${SCRIPT_PREFIX}-row .${SCRIPT_PREFIX}-button {
          width: auto;
          min-width: auto;
          border-radius: 6px;
          background: #111;
          text-align: center;
        }
        .${SCRIPT_PREFIX}-modal.dark .${SCRIPT_PREFIX}-row .${SCRIPT_PREFIX}-button {
          background: #333;
        }
        .${SCRIPT_PREFIX}-row .${SCRIPT_PREFIX}-button.primary {
          color: #fff;
          background: #fe2c55;
        }
        .${SCRIPT_PREFIX}-row .${SCRIPT_PREFIX}-button.danger {
          color: #fe2c55;
          border: 1px solid #fe2c55;
          background: rgba(254, 44, 85, 0.08);
        }
        .${SCRIPT_PREFIX}-row .${SCRIPT_PREFIX}-button.danger:hover {
          color: #fff;
          background: #fe2c55;
        }
        .${SCRIPT_PREFIX}-chip-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          min-height: 42px;
          align-items: center;
        }
        .${SCRIPT_PREFIX}-chip {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          border: 1px solid #d8d8d8;
          border-radius: 999px;
          padding: 7px 10px;
          color: #111;
          background: #f7f7f7;
          cursor: pointer;
          font: 12px Arial, sans-serif;
        }
        .${SCRIPT_PREFIX}-chip.available {
          cursor: pointer;
          background: transparent;
        }
        .${SCRIPT_PREFIX}-chip.separator {
          border-style: dashed;
        }
        .${SCRIPT_PREFIX}-modal.dark .${SCRIPT_PREFIX}-chip {
          color: #f6f6f6;
          background: #242424;
          border-color: #3a3a3a;
        }
        .${SCRIPT_PREFIX}-chip small {
          color: #777;
          font-size: 11px;
        }
        .${SCRIPT_PREFIX}-modal.dark .${SCRIPT_PREFIX}-chip small { color: #aaa; }
        .${SCRIPT_PREFIX}-check-chip {
          display: inline-flex !important;
          align-items: center;
          gap: 7px;
          margin: 0 !important;
          border: 1px solid #d8d8d8;
          border-radius: 999px;
          padding: 7px 10px;
          color: inherit;
          background: rgba(127, 127, 127, 0.06);
          cursor: pointer;
          font: 12px Arial, sans-serif;
        }
        .${SCRIPT_PREFIX}-check-chip input {
          width: 14px !important;
          height: 14px;
          margin: 0;
          padding: 0;
          accent-color: #fe2c55;
        }
        .${SCRIPT_PREFIX}-modal.dark .${SCRIPT_PREFIX}-check-chip {
          border-color: #3a3a3a;
          background: #242424;
        }
        .${SCRIPT_PREFIX}-readonly {
          color: #666;
          font-size: 13px;
          line-height: 1.45;
        }
        .${SCRIPT_PREFIX}-modal.dark .${SCRIPT_PREFIX}-readonly { color: #aaa; }
        .${SCRIPT_PREFIX}-actions {
          justify-content: flex-end;
          padding-top: 6px;
          border-top: 1px solid #eee;
        }
        .${SCRIPT_PREFIX}-modal.dark .${SCRIPT_PREFIX}-actions { border-color: #2a2a2a; }
        @media (max-width: 720px) {
          .${SCRIPT_PREFIX}-settings-grid { grid-template-columns: 1fr; }
          .${SCRIPT_PREFIX}-detail-media-grid { grid-template-columns: 1fr; }
          .${SCRIPT_PREFIX}-modal header { padding: 16px; }
          .${SCRIPT_PREFIX}-modal main { padding: 16px; }
          .${SCRIPT_PREFIX}-settings-modal main { padding: 16px; }
        }
    `;
  }

  // Best-effort heuristic for detecting an open image preview / lightbox — most commonly
  // the full-size viewer TikTok shows when a user clicks an image attached to a comment.
  // TikTok's own CSS class names are hashed and change between deploys, so this can't be a
  // precise selector; it looks for a large, visible <img> living inside something that looks
  // like a modal/overlay container. If this stops matching after a TikTok redesign, the fix
  // is almost always just adding another substring to CANDIDATE_IMAGE_OVERLAY_SELECTORS below
  // (open the real overlay in DevTools, inspect the ancestor chain of the <img>, and add a
  // `[class*="..."]` selector for whatever wrapper class it uses).
  const CANDIDATE_IMAGE_OVERLAY_SELECTORS = [
    '[class*="ImagePreview"]',
    '[class*="ImageViewer"]',
    '[class*="PhotoViewer"]',
    '[class*="PhotoPreview"]',
    '[class*="Lightbox"]',
    '[class*="CommentImage"]',
    '[class*="CommentPicture"]',
    '[role="dialog"]',
  ];
  // Large images can be detected by viewport ratio alone. Small images need stronger proof
  // that they are in an opened preview, otherwise comment avatars/stickers/thumbnails would
  // be too easy to mistake for the active overlay image.
  const IMAGE_OVERLAY_MIN_VIEWPORT_AREA_RATIO = 0.12;
  const IMAGE_OVERLAY_CONTEXT_MIN_VIEWPORT_AREA_RATIO = 0.18;
  const IMAGE_OVERLAY_SMALL_MIN_AREA_PX = 6400;
  const IMAGE_OVERLAY_SMALL_MIN_SIDE_PX = 56;
  const IMAGE_OVERLAY_RECENT_GESTURE_MS = 5000;
  const IMAGE_OVERLAY_BUTTON_MARGIN = 18;
  const IMAGE_OVERLAY_BUTTON_BOTTOM = 80;
  const IMAGE_OVERLAY_BUTTON_ESTIMATED_WIDTH = 150;
  const IMAGE_OVERLAY_BUTTON_ESTIMATED_HEIGHT = 46;
  const IMAGE_OVERLAY_BUTTON_SAFE_GAP = 8;

  function toPlainRect(rect) {
    if (!rect) return null;
    const left = Number(rect.left || 0);
    const top = Number(rect.top || 0);
    const width = Number(rect.width || Math.max(0, Number(rect.right || 0) - left));
    const height = Number(rect.height || Math.max(0, Number(rect.bottom || 0) - top));
    return {
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
    };
  }

  function rectArea(rect) {
    return Math.max(0, Number(rect?.width || 0)) * Math.max(0, Number(rect?.height || 0));
  }

  function rectsOverlap(first, second, padding = 0) {
    if (!first || !second) return false;
    return !(
      first.right + padding <= second.left ||
      first.left - padding >= second.right ||
      first.bottom + padding <= second.top ||
      first.top - padding >= second.bottom
    );
  }

  function getSafeOverlayButtonPlacement(imageRect, options = {}) {
    const viewportWidth = Number(options.viewportWidth || 0);
    const viewportHeight = Number(options.viewportHeight || 0);
    const buttonWidth = Number(options.buttonWidth || IMAGE_OVERLAY_BUTTON_ESTIMATED_WIDTH);
    const buttonHeight = Number(options.buttonHeight || IMAGE_OVERLAY_BUTTON_ESTIMATED_HEIGHT);
    const image = toPlainRect(imageRect);
    if (!viewportWidth || !viewportHeight || !buttonWidth || !buttonHeight || !image) return null;

    const margin = Number(options.margin || IMAGE_OVERLAY_BUTTON_MARGIN);
    const bottomOffset = Number(options.bottom || IMAGE_OVERLAY_BUTTON_BOTTOM);
    const gap = Number(options.gap || IMAGE_OVERLAY_BUTTON_SAFE_GAP);
    const candidates = [
      {
        right: margin,
        bottom: bottomOffset,
        rect: toPlainRect({
          left: viewportWidth - margin - buttonWidth,
          top: viewportHeight - bottomOffset - buttonHeight,
          width: buttonWidth,
          height: buttonHeight,
        }),
      },
      {
        right: margin,
        top: margin,
        rect: toPlainRect({
          left: viewportWidth - margin - buttonWidth,
          top: margin,
          width: buttonWidth,
          height: buttonHeight,
        }),
      },
      {
        left: margin,
        bottom: bottomOffset,
        rect: toPlainRect({
          left: margin,
          top: viewportHeight - bottomOffset - buttonHeight,
          width: buttonWidth,
          height: buttonHeight,
        }),
      },
      {
        left: margin,
        top: margin,
        rect: toPlainRect({ left: margin, top: margin, width: buttonWidth, height: buttonHeight }),
      },
    ];

    return (
      candidates.find((candidate) => {
        const rect = candidate.rect;
        if (!rect) return false;
        if (rect.left < 0 || rect.top < 0) return false;
        if (rect.right > viewportWidth || rect.bottom > viewportHeight) return false;
        return !rectsOverlap(rect, image, gap);
      }) || null
    );
  }

  function getComputedStyleSafe(win, element) {
    try {
      return typeof win?.getComputedStyle === "function" ? win.getComputedStyle(element) : null;
    } catch (_err) {
      return null;
    }
  }

  function parseCssUrl(value) {
    const match = String(value || "").match(/url\((['"]?)(.*?)\1\)/i);
    return match?.[2]?.trim() || "";
  }

  function getElementImageUrl(element, win) {
    const directUrl = element?.currentSrc || element?.src || "";
    if (directUrl) return directUrl;
    const style = getComputedStyleSafe(win, element);
    return parseCssUrl(style?.backgroundImage) || parseCssUrl(style?.background);
  }

  function getDownloadableOverlayImageUrl(url) {
    const value = String(url || "").trim();
    if (!value || value.startsWith("blob:") || value.startsWith("data:")) return "";
    return value;
  }

  function isHiddenByStyle(style) {
    if (!style) return false;
    return (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity || 1) <= 0.01
    );
  }

  function getImageOverlayContext(element, win, viewportArea) {
    const strongImageClassPattern =
      /(?:image|photo|picture).*(?:preview|viewer)|(?:preview|viewer).*(?:image|photo|picture)|commentimage|commentpicture|lightbox/i;
    const overlayClassPattern = /(preview|viewer|lightbox|modal|dialog|popup|popover|overlay)/i;
    const context = { matched: false, strong: false };
    let current = element;
    let depth = 0;
    while (current && depth < 8) {
      const role = current.getAttribute?.("role");
      const ariaModal = current.getAttribute?.("aria-modal");
      const className = String(current.className || "");
      if (strongImageClassPattern.test(className)) {
        context.matched = true;
        context.strong = true;
        return context;
      }
      if (role === "dialog" || ariaModal === "true" || overlayClassPattern.test(className)) {
        context.matched = true;
      }

      const rect = toPlainRect(current.getBoundingClientRect?.());
      const style = getComputedStyleSafe(win, current);
      if (isHiddenByStyle(style)) return { matched: false, strong: false };
      const contextAreaRatio = rectArea(rect) / Math.max(1, viewportArea);
      const zIndex = Number.parseInt(style?.zIndex || "", 10);
      const isFloating = style?.position === "fixed" || style?.position === "sticky";
      if (
        (isFloating || (Number.isFinite(zIndex) && zIndex >= 100)) &&
        contextAreaRatio >= IMAGE_OVERLAY_CONTEXT_MIN_VIEWPORT_AREA_RATIO
      ) {
        context.matched = true;
      }

      current = current.parentElement;
      depth += 1;
    }
    return context;
  }

  function hasImageOverlayContext(element, win, viewportArea) {
    return getImageOverlayContext(element, win, viewportArea).matched;
  }

  function hasSmallOverlayImageSize(rect) {
    return (
      rectArea(rect) >= IMAGE_OVERLAY_SMALL_MIN_AREA_PX &&
      rect.width >= IMAGE_OVERLAY_SMALL_MIN_SIDE_PX &&
      rect.height >= IMAGE_OVERLAY_SMALL_MIN_SIDE_PX
    );
  }

  function isOverlayImageSizeAllowed(rect, viewportArea, context, options = {}, element = null) {
    const areaRatio = rectArea(rect) / Math.max(1, viewportArea);
    if (areaRatio >= IMAGE_OVERLAY_MIN_VIEWPORT_AREA_RATIO) return true;
    if (!context?.matched || !hasSmallOverlayImageSize(rect)) return false;
    if (context.strong) return true;
    return Boolean(
      options.recentImageOpenGesture ||
        (element && options.previousOverlayElement && element === options.previousOverlayElement),
    );
  }

  function findOpenImageOverlay(doc, win, panel, options = {}) {
    if (!doc?.querySelectorAll) return null;
    const viewportWidth = win?.innerWidth || 0;
    const viewportHeight = win?.innerHeight || 0;
    if (!viewportWidth || !viewportHeight) return null;
    const viewportArea = viewportWidth * viewportHeight;

    const seen = new Set();
    const candidateElements = [];
    const addCandidate = (element) => {
      if (!element || seen.has(element)) return;
      seen.add(element);
      candidateElements.push(element);
    };

    for (const selector of CANDIDATE_IMAGE_OVERLAY_SELECTORS) {
      try {
        for (const container of Array.from(doc.querySelectorAll(selector))) {
          addCandidate(container);
          for (const image of Array.from(container.querySelectorAll?.("img") || [])) {
            addCandidate(image);
          }
          for (const background of Array.from(
            container.querySelectorAll?.('[style*="background-image"]') || [],
          )) {
            addCandidate(background);
          }
        }
      } catch (_err) {
        continue;
      }
    }
    try {
      for (const image of Array.from(doc.querySelectorAll("img"))) addCandidate(image);
    } catch (_err) {
      // Ignore selector failures in unusual DOM shims.
    }
    try {
      for (const background of Array.from(doc.querySelectorAll('[style*="background-image"]'))) {
        addCandidate(background);
      }
    } catch (_err) {
      // Ignore selector failures in unusual DOM shims.
    }

    let best = null;
    const considerOverlayImage = (candidate) => {
      if (!candidate?.rawImageUrl) return;
      const canDownload = Boolean(candidate.imageUrl);
      const bestCanDownload = Boolean(best?.imageUrl);
      if (
        !best ||
        (canDownload && !bestCanDownload) ||
        (canDownload === bestCanDownload && candidate.area > best.area)
      ) {
        best = candidate;
      }
    };
    for (const element of candidateElements) {
      if (panel?.contains(element)) continue;
      const rect = toPlainRect(element.getBoundingClientRect?.());
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      const area = rectArea(rect);
      const context = getImageOverlayContext(element, win, viewportArea);
      if (!context.matched) continue;
      if (!isOverlayImageSizeAllowed(rect, viewportArea, context, options, element)) continue;
      const rawImageUrl = getElementImageUrl(element, win);
      const imageUrl = getDownloadableOverlayImageUrl(rawImageUrl);
      considerOverlayImage({ element, area, imageUrl, rawImageUrl, rect });

      for (const image of Array.from(element.querySelectorAll?.("img") || [])) {
        if (panel?.contains(image)) continue;
        const imageRect = toPlainRect(image.getBoundingClientRect?.());
        if (!imageRect || imageRect.width <= 0 || imageRect.height <= 0) continue;
        const imageArea = rectArea(imageRect);
        const imageContext = getImageOverlayContext(image, win, viewportArea);
        if (!imageContext.matched) continue;
        if (!isOverlayImageSizeAllowed(imageRect, viewportArea, imageContext, options, image)) continue;
        const rawChildImageUrl = getElementImageUrl(image, win);
        considerOverlayImage({
          element: image,
          area: imageArea,
          imageUrl: getDownloadableOverlayImageUrl(rawChildImageUrl),
          rawImageUrl: rawChildImageUrl,
          rect: imageRect,
        });
      }
    }
    return best
      ? {
          element: best.element,
          imageUrl: best.imageUrl,
          rawImageUrl: best.rawImageUrl,
          rect: best.rect,
        }
      : null;
  }

  // Encapsulates the DOM heuristics used to locate TikTok's native action bar / video
  // controls (these rely on scanning for TikTok's auto-generated, frequently-changing
  // CSS class names, so keeping them in one place makes it easier to patch when TikTok
  // ships a redesign). Instantiated once per TikTokDlApp as `this.actionBarLocator`;
  // TikTokDlApp keeps thin delegator methods with the original names so every existing
  // call site continues to work unchanged.
  class ActionBarLocator {
    constructor(app) {
      this.app = app;
    }

    getElementRect(element) {
      const rect = element?.getBoundingClientRect?.();
      if (!rect) return null;
      return {
        element,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
      };
    }

    hasVisibleMediaElement() {
      const rect = this.getElementRect(this.app.extractor?.getVisibleVideoElement?.());
      if (!rect) return false;
      const score = scoreMediaElementRect(
        rect,
        this.app.window.innerWidth || 0,
        this.app.window.innerHeight || 0,
      );
      return Number.isFinite(score);
    }

    isVisibleAnchorRect(rect) {
      const viewportWidth = this.app.window.innerWidth || 0;
      const viewportHeight = this.app.window.innerHeight || 0;
      if (!rect) return false;
      if (rect.width < 20 || rect.width > 140 || rect.height < 40 || rect.height > 220) return false;
      if (rect.left < viewportWidth * 0.42) return false;
      if (rect.top < viewportHeight * 0.12 || rect.top > viewportHeight * 0.82) return false;
      return true;
    }

    findNavigationHostRect() {
      const hostSelectors = [
        '[class*="DivFeedNavigationContainer"]',
        '[class*="FeedNavigationContainer"]',
        '[class*="enable-detail-page-refine"]',
      ];
      const hosts = Array.from(
        this.app.document.querySelectorAll(hostSelectors.join(",")),
      )
        .filter((element) => !this.app.panel?.contains(element))
        .map((element) => this.getElementRect(element))
        .filter((rect) => {
          if (!this.isVisibleAnchorRect(rect)) return false;
          const buttons = Array.from(rect.element.querySelectorAll?.("button,[role='button']") || []);
          return buttons.length >= 2;
        })
        .sort((left, right) => {
          const leftClass = String(left.element.className || "");
          const rightClass = String(right.element.className || "");
          const leftScore = leftClass.includes("DivFeedNavigationContainer") ? 0 : 1;
          const rightScore = rightClass.includes("DivFeedNavigationContainer") ? 0 : 1;
          if (leftScore !== rightScore) return leftScore - rightScore;
          return left.top - right.top;
        });
      if (hosts[0]) return hosts[0];

      const controls = Array.from(
        this.app.document.querySelectorAll('button,[role="button"]'),
      )
        .filter((element) => !this.app.panel?.contains(element))
        .map((element) => this.getElementRect(element))
        .filter((rect) => {
          if (!rect) return false;
          if (rect.width < 38 || rect.width > 92 || rect.height < 38 || rect.height > 92) return false;
          if (!this.isVisibleAnchorRect(rect)) return false;
          const text = `${rect.element.getAttribute?.("aria-label") || ""} ${rect.element.title || ""}`;
          if (/(previous|next|up|down|上一个|下一个|上一|下一)/i.test(text)) return true;
          const className = String(rect.element.parentElement?.className || "");
          return /Navigation|FeedNavigation/i.test(className);
        });

      const hostScores = new Map();
      for (const rect of controls) {
        const host = rect.element.closest?.('[class*="FeedNavigationContainer"], [class*="NavigationContainer"], div');
        if (!host || this.app.panel?.contains(host)) continue;
        const hostRect = this.getElementRect(host);
        if (!this.isVisibleAnchorRect(hostRect)) continue;
        const current = hostScores.get(host) || { hostRect, count: 0 };
        current.count += 1;
        hostScores.set(host, current);
      }
      const pairedHost = Array.from(hostScores.values())
        .filter((entry) => entry.count >= 2)
        .sort((left, right) => left.hostRect.top - right.hostRect.top)[0];
      if (pairedHost) return pairedHost.hostRect;

      return null;
    }

    findNavigationAnchorRect() {
      const controls = Array.from(
        this.app.document.querySelectorAll('button,[role="button"]'),
      )
        .filter((element) => !this.app.panel?.contains(element))
        .map((element) => this.getElementRect(element))
        .filter((rect) => {
          if (!rect) return false;
          if (rect.width < 38 || rect.width > 92 || rect.height < 38 || rect.height > 92) return false;
          if (!this.isVisibleAnchorRect(rect)) return false;
          return true;
        });

      let best = null;
      for (const rect of controls) {
        const paired = controls.some((other) => {
          if (other === rect) return false;
          const sameColumn = Math.abs(other.centerX - rect.centerX) < 34;
          const verticalGap = Math.abs(other.centerY - rect.centerY);
          return sameColumn && verticalGap >= 42 && verticalGap <= 110;
        });
        if (!paired) continue;
        if (!best || rect.centerY > best.centerY) best = rect;
      }
      return best;
    }

    isVisibleActionBarRect(rect) {
      const viewportWidth = this.app.window.innerWidth || 0;
      const viewportHeight = this.app.window.innerHeight || 0;
      return isUsableActionBarRect(rect, viewportWidth, viewportHeight);
    }

    findActionBarHost() {
      const viewportWidth = this.app.window.innerWidth || 0;
      const viewportHeight = this.app.window.innerHeight || 0;
      const referenceVideoRect = this.getElementRect(this.app.extractor?.getVisibleVideoElement?.());
      const scoreHostRect = (rect) => {
        const className = String(rect.element.className || "");
        let score =
          scoreActionBarRect(rect, viewportWidth, viewportHeight) +
          (className.includes("SectionActionBarContainer") ? 12 : 0);
        if (referenceVideoRect) {
          const overlap =
            Math.max(
              0,
              Math.min(rect.bottom, referenceVideoRect.bottom) -
                Math.max(rect.top, referenceVideoRect.top),
            ) / Math.max(1, Math.min(rect.height, referenceVideoRect.height));
          const verticalDistance =
            Math.abs(rect.centerY - referenceVideoRect.centerY) / Math.max(1, viewportHeight);
          if (rect.left >= referenceVideoRect.right - 20) score += 12;
          score += overlap * 60 - verticalDistance * 80;
        }
        return score;
      };
      const selectors = [
        'section[class*="SectionActionBarContainer"]',
        '[class*="SectionActionBarContainer"]',
        'section[class*="ActionBarContainer"]',
        '[class*="ActionBarContainer"]',
      ];
      const hosts = Array.from(this.app.document.querySelectorAll(selectors.join(",")))
        .filter((element) => !this.app.panel?.contains(element))
        .filter((element) => isActionBarClassName(element.className))
        .map((element) => this.getElementRect(element))
        .filter((rect) => {
          if (!this.isVisibleActionBarRect(rect)) return false;
          const buttons = Array.from(rect.element.querySelectorAll?.("button,[role='button'],a") || []);
          return buttons.length >= 2;
        })
        .sort((left, right) => {
          const leftScore = scoreHostRect(left);
          const rightScore = scoreHostRect(right);
          if (leftScore !== rightScore) return rightScore - leftScore;
          return (
            Math.abs(left.centerY - viewportHeight / 2) -
            Math.abs(right.centerY - viewportHeight / 2)
          );
        });
      return hosts[0]?.element || null;
    }

    resolveCurrentActionBarHost() {
      const freshHost = this.findActionBarHost();
      if (freshHost) {
        this.app.currentActionBarHost = freshHost;
        return freshHost;
      }

      const currentRect = this.getElementRect(this.app.currentActionBarHost);
      if (this.isVisibleActionBarRect(currentRect)) {
        return this.app.currentActionBarHost;
      }

      this.app.currentActionBarHost = null;
      return null;
    }

    isActionControlCandidate(rect, videoRect) {
      if (!rect || !videoRect) return false;
      const viewportWidth = this.app.window.innerWidth || 0;
      const viewportHeight = this.app.window.innerHeight || 0;
      if (rect.width < 32 || rect.width > 96 || rect.height < 32 || rect.height > 112) return false;
      if (getVisibleRectRatio(rect, viewportWidth, viewportHeight) < 0.55) return false;
      if (rect.centerX < videoRect.right - 20) return false;
      const maxDistance = Math.max(120, Math.min(260, viewportWidth * 0.28));
      if (rect.left > videoRect.right + maxDistance) return false;
      if (rect.bottom < videoRect.top + 20 || rect.top > videoRect.bottom - 20) return false;
      const text = [
        rect.element?.className,
        rect.element?.getAttribute?.("aria-label"),
        rect.element?.getAttribute?.("data-e2e"),
        rect.element?.title,
        rect.element?.textContent,
      ]
        .filter(Boolean)
        .join(" ");
      if (/(previous|next|up|down|scroll|navigate|上一|下一|上一个|下一个|向上|向下)/i.test(text)) {
        return false;
      }
      return true;
    }

    findActionControlColumnContext() {
      const videoRect = this.getElementRect(this.app.extractor?.getVisibleVideoElement?.());
      if (!videoRect) return null;
      const controls = Array.from(
        this.app.document.querySelectorAll?.('button,[role="button"],a') || [],
      )
        .filter((element) => !this.app.panel?.contains(element))
        .map((element) => this.getElementRect(element))
        .filter((rect) => this.isActionControlCandidate(rect, videoRect));

      const groups = [];
      for (const rect of controls) {
        let group = groups.find((entry) => Math.abs(entry.centerX - rect.centerX) <= 36);
        if (!group) {
          group = { centerX: rect.centerX, rects: [] };
          groups.push(group);
        }
        group.rects.push(rect);
        group.centerX =
          group.rects.reduce((total, item) => total + item.centerX, 0) / group.rects.length;
      }

      const candidates = groups
        .map((group) => {
          const rects = group.rects
            .slice()
            .sort((left, right) => left.top - right.top);
          const hasAvatar = rects.some((rect) => isAvatarActionChild(rect.element));
          const hostRect = rects.reduce(
            (box, rect) => ({
              left: Math.min(box.left, rect.left),
              top: Math.min(box.top, rect.top),
              right: Math.max(box.right, rect.right),
              bottom: Math.max(box.bottom, rect.bottom),
              width: 0,
              height: 0,
              centerX: 0,
              centerY: 0,
            }),
            { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
          );
          hostRect.width = hostRect.right - hostRect.left;
          hostRect.height = hostRect.bottom - hostRect.top;
          hostRect.centerX = hostRect.left + hostRect.width / 2;
          hostRect.centerY = hostRect.top + hostRect.height / 2;
          const distanceFromVideo = Math.max(0, hostRect.left - videoRect.right);
          const score = rects.length * 40 + (hasAvatar ? 18 : 0) - distanceFromVideo * 0.18;
          return { rects, hostRect, score };
        })
        .filter((group) => group.rects.length >= 2)
        .sort((left, right) => right.score - left.score);

      const best = candidates[0];
      if (!best) return null;
      const avatarIndex = best.rects.findIndex((rect) => isAvatarActionChild(rect.element));
      const anchorIndex = avatarIndex >= 0 ? avatarIndex : 0;
      const anchorRect = best.rects[anchorIndex];
      const nextRect =
        best.rects.slice(anchorIndex + 1).find((rect) => Math.abs(rect.centerX - anchorRect.centerX) <= 48) ||
        null;
      return {
        host: null,
        hostRect: best.hostRect,
        anchor: anchorRect.element,
        anchorRect,
        nextRect,
        fallback: true,
      };
    }

    getNativeActionChildren(host) {
      return Array.from(host?.children || []).filter((child) => child !== this.app.panel);
    }

    getActionBarInsertionReference(host) {
      // Kept for backward compatibility with any external tooling that might reference it,
      // but note that the panel is positioned with `position: fixed` and appended directly
      // to `document.body` (see mountPanel()), so no code path actually inserts it into
      // `host`'s children at a specific index. This simply returns the first native child.
      const nativeChildren = this.getNativeActionChildren(host);
      return nativeChildren[0] || null;
    }

    findActionBarPositionContext() {
      const host = this.resolveCurrentActionBarHost();
      if (!host) {
        return this.findActionControlColumnContext();
      }
      const hostRect = this.getElementRect(host);
      const nativeChildren = this.getNativeActionChildren(host);
      let anchorIndex = nativeChildren.findIndex((child) => isAvatarActionChild(child));
      if (anchorIndex < 0) anchorIndex = 0;
      const anchor = nativeChildren[anchorIndex] || host;
      const anchorRect = this.getElementRect(anchor) || hostRect;
      let nextRect = null;
      for (const child of nativeChildren.slice(anchorIndex + 1)) {
        if (!child || child === this.app.panel || isAvatarActionChild(child)) continue;
        const rect = this.getElementRect(child);
        if (!rect || rect.width < 24 || rect.height < 24) continue;
        if (anchorRect && Math.abs(rect.centerX - anchorRect.centerX) > 48) continue;
        nextRect = rect;
        break;
      }
      return { host, hostRect, anchor, anchorRect, nextRect };
    }

    findActionBarAnchorRect() {
      return this.findActionBarPositionContext().anchorRect;
    }

    getCurrentActionAnchor() {
      const context = this.findActionBarPositionContext();
      if (context?.host) return context.host;
      if (context?.anchor) return context.anchor;
      return this.resolveCurrentActionBarHost();
    }
  }

  class TikTokDlApp {
    constructor(win, runtimeCache = null) {
      this.window = win;
      this.document = win.document;
      this.configStore = new ConfigStore(win.localStorage);
      this.runtimeCache = runtimeCache;
      this.extractor = new TikTokMediaExtractor(this.document, win, runtimeCache);
      this.actionBarLocator = new ActionBarLocator(this);
      this.downloader = new Downloader(win, gmXmlHttpRequest);
      this.panel = null;
      this.menu = null;
      this.launcher = null;
      this.currentMedia = null;
      this.currentActionBarHost = null;
      this.currentActionBarContext = null;
      this.lastHref = "";
      this.positionObserver = null;
      this.positionFrame = null;
      this.positionPoll = null;
      this.lastPanelPositionSignature = "";
      this.outsideMenuBound = false;
      this.openImageOverlay = null;
      this.imageDownloadButton = null;
      this.imageOverlayWatcherBound = false;
      this.lastImageOpenGestureAt = 0;
      this.appStartTime = Date.now();
    }

    start() {
      this.injectStyles();
      this.renderPanel();
      this.refreshMedia();
      this.bindHotkey();
      this.watchRouteChanges();
      this.watchPanelPosition();
    }

    injectStyles() {
      if (this.document.getElementById(`${SCRIPT_PREFIX}-style`)) return;
      const style = createElement(this.document, "style");
      style.id = `${SCRIPT_PREFIX}-style`;
      style.textContent = getPanelStyleSheet();
      this.document.head.appendChild(style);
    }

    renderPanel() {
      if (this.panel) this.panel.remove();
      const panel = createElement(this.document, "div", `${SCRIPT_PREFIX}-panel`);
      const launcher = createElement(
        this.document,
        "button",
        `${SCRIPT_PREFIX}-launcher`,
      );
      launcher.type = "button";
      launcher.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M11 4a1 1 0 0 1 2 0v8.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42l2.3 2.3V4Z"></path>
          <path fill="currentColor" d="M5 19a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1Z"></path>
        </svg>
      `;
      launcher.addEventListener("click", (event) => {
        event.stopPropagation();
        this.toggleMenu();
      });

      const menu = createElement(this.document, "div", `${SCRIPT_PREFIX}-menu`);
      menu.addEventListener("pointerdown", (event) => event.stopPropagation());
      menu.addEventListener("click", (event) => event.stopPropagation());
      const downloadButton = createElement(
        this.document,
        "button",
        `${SCRIPT_PREFIX}-button`,
        this.t("download_video"),
      );
      downloadButton.addEventListener("click", () => {
        this.toggleMenu(false);
        this.downloadVideo();
      });

      const frameButton = createElement(
        this.document,
        "button",
        `${SCRIPT_PREFIX}-button secondary`,
        this.t("frame_capture"),
      );
      frameButton.addEventListener("click", () => {
        this.toggleMenu(false);
        this.openFrameCapture();
      });

      const detailsButton = createElement(
        this.document,
        "button",
        `${SCRIPT_PREFIX}-button secondary`,
        this.t("details"),
      );
      detailsButton.addEventListener("click", () => {
        this.toggleMenu(false);
        this.openDetails();
      });

      const settingsButton = createElement(
        this.document,
        "button",
        `${SCRIPT_PREFIX}-button secondary`,
        this.t("settings"),
      );
      settingsButton.addEventListener("click", () => {
        this.toggleMenu(false);
        this.openSettings();
      });

      menu.append(downloadButton, frameButton, detailsButton, settingsButton);
      panel.append(menu, launcher);
      this.panel = panel;
      this.menu = menu;
      this.launcher = launcher;
      this.downloadButtonEl = downloadButton;
      this.frameButtonEl = frameButton;
      this.detailsButtonEl = detailsButton;
      this.settingsButtonEl = settingsButton;
      this.applyPanelState();
      this.mountPanel();
      this.bindMenuOutsideClose();
      this.renderImageDownloadButton();
      this.bindImageOverlayWatcher();
    }

    // Standalone button shown only while an open image preview (see findOpenImageOverlay())
    // is detected, e.g. after the user opens a photo attached to a comment. It is a separate
    // element from the main panel/menu -- while it's visible, the main panel is hidden
    // entirely (see mountPanel()/refreshImageOverlayState()) so there's only ever one thing
    // to click, and it always has one job: download that specific image.
    ensureImageDownloadButton() {
      if (this.imageDownloadButton) return this.imageDownloadButton;
      const button = createElement(this.document, "button", `${SCRIPT_PREFIX}-image-button`);
      button.type = "button";
      button.style.display = "none";
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this.downloadOverlayImage();
      });
      this.document.body.appendChild(button);
      this.imageDownloadButton = button;
      return button;
    }

    renderImageDownloadButton() {
      const button = this.ensureImageDownloadButton();
      button.textContent = this.t("download_image");
      button.removeAttribute?.("title");
      button.classList.toggle("light", this.getTheme() === "light");
      for (const property of ["left", "right", "top", "bottom"]) {
        button.style[property] = "auto";
      }

      const overlay = this.openImageOverlay;
      const buttonRect = toPlainRect(button.getBoundingClientRect?.());
      const placement = overlay?.imageUrl
        ? getSafeOverlayButtonPlacement(overlay.rect, {
            viewportWidth: this.window.innerWidth || 0,
            viewportHeight: this.window.innerHeight || 0,
            buttonWidth: buttonRect?.width || IMAGE_OVERLAY_BUTTON_ESTIMATED_WIDTH,
            buttonHeight: buttonRect?.height || IMAGE_OVERLAY_BUTTON_ESTIMATED_HEIGHT,
          })
        : null;
      if (!placement) {
        button.style.display = "none";
        return;
      }

      for (const property of ["left", "right", "top", "bottom"]) {
        if (placement[property] != null) button.style[property] = `${placement[property]}px`;
      }
      button.style.display = "";
    }

    // Listens for clicks on <img> elements anywhere outside our own UI (per the idea that
    // the moment a user clicks a comment image is the most reliable signal that a preview is
    // about to open -- much more direct than waiting for a generic DOM-mutation poll, since
    // opening the preview usually doesn't change the underlying video/action-bar geometry
    // that the regular position-refresh logic keys off of, so that path alone could miss it).
    // The actual open/closed decision still goes through findOpenImageOverlay() shortly after
    // (the overlay needs a moment to mount), so a mis-guessed click target here just means we
    // check and find nothing -- it can't produce a false "image open" state on its own.
    bindImageOverlayWatcher() {
      if (this.imageOverlayWatcherBound) return;
      this.imageOverlayWatcherBound = true;
      const handleClick = (event) => {
        const target = event.target;
        if (!target) return;
        if (this.panel?.contains(target) || this.imageDownloadButton?.contains(target)) return;
        const isImage =
          target.tagName === "IMG" ||
          (typeof target.closest === "function" &&
            (target.closest("img") || target.closest('[style*="background-image"]')));
        if (!isImage) return;
        this.lastImageOpenGestureAt = Date.now();
        // Give the overlay a moment to actually mount before we go looking for it.
        this.window.setTimeout?.(() => this.refreshImageOverlayState(), 80);
      };
      this.document.addEventListener?.("click", handleClick, true);
    }

    // Re-checks whether an image preview is currently open and updates both the dedicated
    // download-image button and the main panel's visibility accordingly. Unlike the regular
    // position refresh (gated behind getPanelPositionSignature(), which only reacts to the
    // video/action-bar's own geometry changing), this only cares about "is there an overlay
    // right now", so it needs its own independent triggers -- see bindImageOverlayWatcher()
    // and the MutationObserver hookup in watchPanelPosition().
    refreshImageOverlayState() {
      const recentImageOpenGesture =
        this.lastImageOpenGestureAt > 0 &&
        Date.now() - this.lastImageOpenGestureAt <= IMAGE_OVERLAY_RECENT_GESTURE_MS;
      const overlay = findOpenImageOverlay(this.document, this.window, this.panel, {
        recentImageOpenGesture,
        previousOverlayElement: this.openImageOverlay?.element || null,
      });
      const wasOpen = Boolean(this.openImageOverlay);
      const isOpen = Boolean(overlay);
      const urlChanged = overlay?.imageUrl !== this.openImageOverlay?.imageUrl;
      this.openImageOverlay = overlay;
      this.renderImageDownloadButton();
      if (wasOpen !== isOpen || (isOpen && urlChanged)) {
        this.mountPanel();
        this.applyPanelState();
      }
    }

    t(key) {
      return getMessage(key, this.configStore.get(), this.window.navigator);
    }

    getTheme() {
      return resolveTheme(
        this.configStore.get(),
        this.window.matchMedia?.("(prefers-color-scheme: dark)"),
      );
    }

    applyPanelState() {
      if (!this.panel) return;
      const isOpen = this.panel.classList.contains("open");
      const isEmbedded = this.panel.classList.contains("embedded");
      const isPending = this.panel.classList.contains("pending");
      const nextClassName = [
        `${SCRIPT_PREFIX}-panel`,
        this.getTheme(),
        isOpen ? "open" : "",
        isEmbedded ? "embedded" : "",
        isPending ? "pending" : "",
      ]
        .filter(Boolean)
        .join(" ");
      if (this.panel.className !== nextClassName) {
        this.panel.className = nextClassName;
      }
      if (this.launcher) {
        this.launcher.setAttribute("aria-label", this.t("menu"));
        this.launcher.removeAttribute?.("title");
      }
      // Explicit element references (set up in renderPanel()) rather than positional index
      // into a querySelectorAll list -- keeps this correct regardless of how many buttons
      // are in the menu or what order they're in.
      if (this.downloadButtonEl) {
        this.downloadButtonEl.textContent = this.currentMedia?.isImagePost
          ? this.t("download_album")
          : this.t("download_video");
      }
      if (this.frameButtonEl) this.frameButtonEl.textContent = this.t("frame_capture");
      if (this.detailsButtonEl) this.detailsButtonEl.textContent = this.t("details");
      if (this.settingsButtonEl) this.settingsButtonEl.textContent = this.t("settings");
      if (this.imageDownloadButton) this.renderImageDownloadButton();
    }

    toggleMenu(force = null) {
      if (!this.panel) return;
      const shouldOpen =
        force === null ? !this.panel.classList.contains("open") : Boolean(force);
      this.panel.classList.toggle("open", shouldOpen);
      this.mountPanel();
      this.updatePanelMenuPosition();
    }

    clearPanelMenuPosition() {
      if (!this.menu) return;
      for (const property of ["left", "right", "top", "bottom"]) {
        this.menu.style[property] = "";
      }
      delete this.menu.dataset.placement;
    }

    updatePanelMenuPosition() {
      if (!this.panel || !this.menu) return;
      const shouldPosition =
        this.panel.classList.contains("embedded") && this.panel.classList.contains("open");
      this.clearPanelMenuPosition();
      if (!shouldPosition) {
        return;
      }
      this.menu.dataset.placement = "top";
    }

    bindMenuOutsideClose() {
      if (this.outsideMenuBound) return;
      this.outsideMenuBound = true;
      this.document.addEventListener(
        "pointerdown",
        (event) => {
          if (!this.panel?.classList.contains("open")) return;
          if (this.panel.contains(event.target)) return;
          this.toggleMenu(false);
        },
        true,
      );
      this.document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") this.toggleMenu(false);
      });
    }

    // DOM-locator heuristics live in ActionBarLocator (see above); these delegate to it
    // so every existing call site (`this.findActionBarHost()`, etc.) keeps working.
    getElementRect(element) {
      return this.actionBarLocator.getElementRect(element);
    }

    hasVisibleMediaElement() {
      return this.actionBarLocator.hasVisibleMediaElement();
    }

    isVisibleAnchorRect(rect) {
      return this.actionBarLocator.isVisibleAnchorRect(rect);
    }

    findNavigationHostRect() {
      return this.actionBarLocator.findNavigationHostRect();
    }

    findNavigationAnchorRect() {
      return this.actionBarLocator.findNavigationAnchorRect();
    }

    isVisibleActionBarRect(rect) {
      return this.actionBarLocator.isVisibleActionBarRect(rect);
    }

    findActionBarHost() {
      return this.actionBarLocator.findActionBarHost();
    }

    resolveCurrentActionBarHost() {
      return this.actionBarLocator.resolveCurrentActionBarHost();
    }

    isActionControlCandidate(rect, videoRect) {
      return this.actionBarLocator.isActionControlCandidate(rect, videoRect);
    }

    findActionControlColumnContext() {
      return this.actionBarLocator.findActionControlColumnContext();
    }

    getNativeActionChildren(host) {
      return this.actionBarLocator.getNativeActionChildren(host);
    }

    getActionBarInsertionReference(host) {
      return this.actionBarLocator.getActionBarInsertionReference(host);
    }

    findActionBarPositionContext() {
      return this.actionBarLocator.findActionBarPositionContext();
    }

    findActionBarAnchorRect() {
      return this.actionBarLocator.findActionBarAnchorRect();
    }

    getPanelButtonSize() {
      const value = this.panel?.style?.getPropertyValue?.(`--${SCRIPT_PREFIX}-action-size`) || "";
      const size = Number(String(value).replace(/[^\d.]/g, ""));
      return Number.isFinite(size) && size > 0 ? size : 44;
    }

    // Shared by syncEmbeddedButtonMetrics() and syncEmbeddedButtonMetricsFromContext():
    // sets the --${SCRIPT_PREFIX}-action-{bg,color,hover-bg} custom properties for the "auto" theme
    // (derived from the native control's computed style) or for the explicit light/dark
    // overrides. `resolveComputedColors` is only invoked for the "auto" theme and should
    // return `{ backgroundColor, color }` (or a falsy value if no source element is usable).
    applyEmbeddedThemeVariables(resolveComputedColors) {
      const theme = this.getTheme();
      if (theme === "light") {
        this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-bg`, "rgb(241, 241, 241)");
        this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-color`, "rgb(22, 24, 35)");
        this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-hover-bg`, "rgb(232, 232, 232)");
        return;
      }
      if (theme === "dark") {
        this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-bg`, "rgb(36, 36, 36)");
        this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-color`, "rgb(255, 255, 255)");
        this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-hover-bg`, "rgb(47, 47, 47)");
        return;
      }
      if (typeof this.window.getComputedStyle !== "function") return;
      const computed = resolveComputedColors?.();
      if (!computed) return;
      const palette = getEmbeddedLauncherPalette(computed.backgroundColor, computed.color);
      this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-bg`, palette.background);
      this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-color`, palette.color);
      this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-hover-bg`, palette.hoverBackground);
    }

    syncEmbeddedButtonMetrics(host) {
      if (!this.panel || !host) return;
      const nativeChildren = this.getNativeActionChildren(host);
      const sampleChildren = [
        ...nativeChildren.filter((child) => !isAvatarActionChild(child)),
        ...nativeChildren,
      ];
      let nativeChild = null;
      let nativeControl = null;
      for (const child of sampleChildren) {
        const control = getNativeActionControl(child);
        const rect = control?.getBoundingClientRect?.();
        if (!rect || rect.width < 34 || rect.height < 34) continue;
        nativeChild = child;
        nativeControl = control;
        break;
      }
      const rect = nativeControl?.getBoundingClientRect?.();
      const size = rect
        ? Math.round(Math.max(44, Math.min(50, Math.max(rect.width, rect.height))))
        : 48;
      this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-size`, `${size}px`);
      this.applyEmbeddedThemeVariables(() => {
        if (!nativeControl) return null;
        const controlStyle = this.window.getComputedStyle(nativeControl);
        const childStyle =
          nativeChild && nativeChild !== nativeControl
            ? this.window.getComputedStyle(nativeChild)
            : null;
        const backgroundColor = isTransparentColor(controlStyle.backgroundColor)
          ? childStyle?.backgroundColor
          : controlStyle.backgroundColor;
        return { backgroundColor, color: controlStyle.color };
      });
    }

    syncEmbeddedButtonMetricsFromContext(context = null) {
      if (context?.host) {
        this.syncEmbeddedButtonMetrics(context.host);
        return;
      }
      if (!this.panel || !context?.anchorRect) return;
      const rect = context.anchorRect;
      const size = Math.round(Math.max(44, Math.min(50, Math.max(rect.width, rect.height))));
      this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-size`, `${size}px`);
      this.applyEmbeddedThemeVariables(() => {
        if (!rect.element) return null;
        const controlStyle = this.window.getComputedStyle(rect.element);
        return { backgroundColor: controlStyle.backgroundColor, color: controlStyle.color };
      });
    }

    clearEmbeddedButtonMetrics() {
      if (!this.panel) return;
      this.panel.style.removeProperty(`--${SCRIPT_PREFIX}-action-size`);
      this.panel.style.removeProperty(`--${SCRIPT_PREFIX}-action-bg`);
      this.panel.style.removeProperty(`--${SCRIPT_PREFIX}-action-color`);
      this.panel.style.removeProperty(`--${SCRIPT_PREFIX}-action-hover-bg`);
    }

    mountPanel() {
      if (!this.panel) return;

      if (this.openImageOverlay) {
        // An image preview is open (see refreshImageOverlayState()) and the dedicated
        // image-download button is showing instead -- hide the main panel entirely rather
        // than embedding it near the (now visually covered) video action bar, so it can't
        // end up rendered on top of the enlarged image.
        if (this.panel.parentElement !== this.document.body) {
          this.document.body.appendChild(this.panel);
        }
        this.currentActionBarHost = null;
        this.currentActionBarContext = null;
        this.clearEmbeddedButtonMetrics();
        this.panel.classList.add("pending");
        this.panel.classList.remove("embedded", "open");
        this.clearPanelMenuPosition();
        return;
      }

      const actionContext = this.findActionBarPositionContext();
      if (actionContext?.anchorRect) {
        const actionHost = actionContext.host || this.findActionBarHost?.() || null;
        const resolvedActionContext = actionHost
          ? { ...actionContext, host: actionHost }
          : actionContext;
        this.currentActionBarHost = actionHost;
        this.currentActionBarContext = resolvedActionContext;
        if (this.panel.parentElement !== this.document.body) {
          this.document.body.appendChild(this.panel);
        }
        this.panel.classList.remove("pending");
        this.panel.classList.add("embedded");
        this.syncEmbeddedButtonMetricsFromContext(resolvedActionContext);
        this.updatePanelPosition(resolvedActionContext);
        return;
      }

      if (this.panel.parentElement !== this.document.body) {
        this.document.body.appendChild(this.panel);
      }
      this.currentActionBarHost = null;
      this.currentActionBarContext = null;
      this.panel.classList.add("pending");
      this.panel.classList.remove("embedded", "open");
      this.clearEmbeddedButtonMetrics();
      this.clearPanelMenuPosition();
    }

    updatePanelPosition(actionContext = null) {
      if (!this.panel) return;
      const embedded = this.panel.classList.contains("embedded");
      const resolvedActionContext = embedded
        ? actionContext || this.findActionBarPositionContext()
        : null;
      const anchorRect = embedded
        ? resolvedActionContext?.anchorRect
        : this.findNavigationHostRect() || this.findNavigationAnchorRect();
      const buttonSize = embedded ? this.getPanelButtonSize() : 44;
      const position = (embedded ? calculateEmbeddedPanelPosition : calculatePanelPosition)({
        anchorRect,
        nextRect: resolvedActionContext?.nextRect,
        buttonSize,
        viewportWidth: this.window.innerWidth || 0,
        viewportHeight: this.window.innerHeight || 0,
      });
      this.panel.style.left = `${position.left}px`;
      this.panel.style.top = `${position.top}px`;
      this.panel.style.right = "auto";
      this.panel.style.bottom = "auto";
      this.updatePanelMenuPosition();
    }

    getCurrentActionAnchor() {
      return this.actionBarLocator.getCurrentActionAnchor();
    }

    refreshMedia() {
      this.mountPanel();
      const anchor = this.getCurrentActionAnchor();
      this.currentMedia = this.extractor.getCurrentMedia(
        this.configStore.get(),
        anchor,
        { requireContext: this.panel?.classList.contains("embedded") },
      );
      return this.currentMedia;
    }

    wait(ms) {
      return new Promise((resolve) => {
        const timer = this.window?.setTimeout || root?.setTimeout || setTimeout;
        timer.call(this.window || root, resolve, ms);
      });
    }

    async waitForCurrentMedia(options = {}) {
      const isColdStart =
        options.attempts === undefined &&
        options.intervalMs === undefined &&
        Date.now() - (this.appStartTime || 0) < MEDIA_READY_COLD_START_WINDOW_MS;
      const attempts = Math.max(
        1,
        Number(
          options.attempts ||
            (isColdStart ? MEDIA_READY_COLD_START_ATTEMPTS : MEDIA_READY_ATTEMPTS),
        ),
      );
      const intervalMs = Math.max(
        0,
        Number(
          options.intervalMs ??
            (isColdStart ? MEDIA_READY_COLD_START_INTERVAL_MS : MEDIA_READY_INTERVAL_MS),
        ),
      );
      let media = null;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        media = this.refreshMedia();
        if (hasUsableMedia(media)) return media;
        if (attempt < attempts - 1 && intervalMs > 0) {
          await this.wait(intervalMs);
        }
      }
      return media;
    }

    getFilename(media, suffix = "mp4") {
      const base = buildFilename(media, this.configStore.get());
      return suffix ? `${base}.${suffix}` : base;
    }

    getImageFilename(media, image = {}, index = 0) {
      const config = this.configStore.get();
      const base = buildFilename(media, config);
      const url = String(image.url || "");
      const extension =
        url.match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i)?.[1]?.toLowerCase() || "jpg";
      return normalizeFilename(`${base}_image${formatAlbumIndex(index, config.album_index_format)}.${extension}`, {
        maxLength: Number(config.filename_max_length || DEFAULT_CONFIG.filename_max_length) + 16,
      });
    }

    getFilenamePreviewMedia() {
      const anchor = this.getCurrentActionAnchor();
      const media =
        this.currentMedia ||
        this.extractor.getCurrentMedia(
          this.configStore.get(),
          anchor,
          { requireContext: this.panel?.classList.contains("embedded") },
        ) ||
        {};
      const fallbackAuthor = getAuthorFromUrl(this.window.location?.href || "") || "creator";
      const hashtags = ensureArray(media.hashtags).filter(Boolean);
      return {
        ...media,
        id:
          media.id ||
          getVideoIdFromUrl(this.window.location?.href || "") ||
          "7655770385929096456",
        desc: media.desc || "TikTok video",
        createTime: media.createTime || Math.floor(Date.now() / 1000),
        pageUrl: media.pageUrl || this.window.location?.href || "",
        author: {
          ...(media.author || {}),
          uniqueId: media.author?.uniqueId || fallbackAuthor,
          nickname: media.author?.nickname || media.author?.uniqueId || fallbackAuthor,
        },
        hashtags: hashtags.length ? hashtags : ["tiktok"],
        music: {
          ...(media.music || {}),
          title: media.music?.title || "original sound",
        },
      };
    }

    async downloadVideo() {
      const media = await this.waitForCurrentMedia();
      const images = ensureArray(media?.images).filter((image) => image?.url);
      if (!media?.video?.primaryUrl && images.length) {
        let lastFilename = "";
        try {
          for (const [index, image] of images.entries()) {
            const filename = this.getImageFilename(media, image, index);
            lastFilename = filename;
            await this.downloader.downloadUrl(
              unique([image.url, ...ensureArray(image.fallbackUrls)]),
              filename,
            );
          }
          this.toast(`${this.t("download_started")}: ${lastFilename}`);
        } catch (err) {
          this.toast(`${this.t("download_failed")}: ${err?.message || err}`);
        }
        return;
      }
      if (!media?.video?.primaryUrl) {
        this.toast(this.t("no_media"));
        return;
      }
      const filename = this.getFilename(media, media.video.format || "mp4");
      const urls = [media.video.primaryUrl, ...media.video.fallbackUrls];
      try {
        await this.downloader.downloadUrl(urls, filename);
        this.toast(`${this.t("download_started")}: ${filename}`);
      } catch (err) {
        this.toast(`${this.t("download_failed")}: ${err?.message || err}`);
      }
    }

    async downloadAsset(url, filename) {
      // `url` may be a single string or an array of fallback URLs (see makeDownloadPill in
      // openDetails). `!url` alone never catches an empty array since arrays are always
      // truthy in JS, so normalize first and check length.
      const urls = unique(ensureArray(url));
      if (!urls.length) {
        this.toast(this.t("asset_empty"));
        return;
      }
      try {
        await this.downloader.downloadUrl(urls, filename);
        this.toast(`${this.t("download_started")}: ${filename}`);
      } catch (err) {
        this.toast(`${this.t("download_failed")}: ${err?.message || err}`);
      }
    }

    getOverlayImageFilename(media, url) {
      const config = this.configStore.get();
      const base = buildFilename(media || {}, config) || `tiktok_${Date.now()}`;
      const extension =
        String(url).match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i)?.[1]?.toLowerCase() || "jpg";
      return normalizeFilename(`${base}_comment_image.${extension}`, {
        maxLength: Number(config.filename_max_length || DEFAULT_CONFIG.filename_max_length) + 20,
      });
    }

    async downloadOverlayImage() {
      const overlay = this.openImageOverlay;
      if (!overlay?.imageUrl) {
        this.toast(this.t("asset_empty"));
        return;
      }
      const media = this.currentMedia || {};
      const filename = this.getOverlayImageFilename(media, overlay.imageUrl);
      try {
        await this.downloader.downloadUrl(overlay.imageUrl, filename);
        this.toast(`${this.t("download_started")}: ${filename}`);
      } catch (err) {
        this.toast(`${this.t("download_failed")}: ${err?.message || err}`);
      }
    }

    getFrameFilename(media = {}) {
      const config = this.configStore.get();
      const previewMedia = media?.id ? media : this.getFilenamePreviewMedia();
      const base = buildFilename(previewMedia, config) || `tiktok_frame_${Date.now()}`;
      return normalizeFilename(`${base}_frame.png`, {
        maxLength: Number(config.filename_max_length || DEFAULT_CONFIG.filename_max_length) + 10,
      });
    }

    async captureCurrentFrame() {
      this.mountPanel();
      const video = this.extractor.getCurrentVideoElement(this.getCurrentActionAnchor());
      if (!video || !video.videoWidth || !video.videoHeight) {
        throw new Error(this.t("no_media"));
      }
      const canvas = this.document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is unavailable.");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => {
        canvas.toBlob((value) => resolve(value), "image/png");
      });
      if (!blob) throw new Error("Canvas export failed.");
      const media = this.currentMedia || this.refreshMedia() || {};
      return {
        blob,
        url: this.window.URL.createObjectURL(blob),
        filename: this.getFrameFilename(media),
        width: canvas.width,
        height: canvas.height,
      };
    }

    async copyFrameToClipboard(frame) {
      const ClipboardItem = this.window.ClipboardItem;
      if (!ClipboardItem || !this.window.navigator.clipboard?.write) {
        throw new Error(this.t("frame_copy_unsupported"));
      }
      await this.window.navigator.clipboard.write([
        new ClipboardItem({ [frame.blob.type || "image/png"]: frame.blob }),
      ]);
    }

    async openFrameCapture() {
      try {
        const frame = await this.captureCurrentFrame();
        const modal = this.createModal(this.t("frame_title"), "", {
          closeOnBackdrop: false,
        });
        modal.classList.add(`${SCRIPT_PREFIX}-frame-modal`);
        const main = modal.querySelector("main");
        const preview = createElement(this.document, "img", `${SCRIPT_PREFIX}-frame-preview`);
        preview.src = frame.url;
        preview.alt = this.t("frame_title");
        const meta = createElement(
          this.document,
          "p",
          `${SCRIPT_PREFIX}-readonly`,
          `${frame.width}x${frame.height} - ${frame.filename}`,
        );
        const actions = createElement(this.document, "div", `${SCRIPT_PREFIX}-row ${SCRIPT_PREFIX}-actions`);
        actions.append(
          this.actionButton(this.t("copy_frame"), async () => {
            try {
              await this.copyFrameToClipboard(frame);
              this.toast(this.t("frame_copied"));
            } catch (err) {
              this.toast(`${this.t("frame_copy_failed")}: ${err?.message || err}`);
            }
          }, "primary"),
          this.actionButton(this.t("save_frame"), () => {
            this.downloader.downloadBlob(frame.blob, frame.filename);
          }),
        );
        main.append(preview, meta, actions);
      } catch (err) {
        this.toast(`${this.t("frame_failed")}: ${err?.message || err}`);
      }
    }

    renderMusicSection(details, helpers = {}) {
      const makeFieldset = helpers.makeFieldset;
      const makeRows = helpers.makeRows;
      const musicSection = makeFieldset(this.t("background_music"));
      musicSection.className = `${musicSection.className || ""} ${SCRIPT_PREFIX}-detail-music-section`.trim();
      const music = details.music || {};
      if (music.title || music.url) {
        const musicUrl = music.url
          ? createElement(
              this.document,
              "a",
              `${SCRIPT_PREFIX}-link ${SCRIPT_PREFIX}-detail-music-url`,
              music.url,
            )
          : null;
        if (musicUrl) {
          musicUrl.href = music.url;
          musicUrl.title = music.url;
          musicUrl.target = "_blank";
          musicUrl.rel = "noopener noreferrer";
        }
        if (music.url) {
          const audioRow = createElement(this.document, "div", `${SCRIPT_PREFIX}-detail-audio-row`);
          if (music.coverUrl) {
            const cover = createElement(this.document, "img", `${SCRIPT_PREFIX}-detail-music-cover`);
            cover.src = music.coverUrl;
            cover.alt = this.t("background_music");
            cover.loading = "lazy";
            audioRow.appendChild(cover);
          }
          const audio = createElement(this.document, "audio", `${SCRIPT_PREFIX}-detail-audio`);
          audio.controls = true;
          audio.preload = "metadata";
          audio.src = music.url;
          audioRow.appendChild(audio);
          musicSection.appendChild(audioRow);
        }
        musicSection.append(
          makeRows([
            { label: this.t("music"), value: music.title },
            { label: this.t("author"), value: music.authorName },
            { label: this.t("duration"), value: music.duration },
            { label: this.t("url"), value: musicUrl || "" },
          ]),
        );
      } else {
        musicSection.appendChild(createElement(this.document, "p", "", this.t("no_items")));
      }
      return musicSection;
    }

    async openDetails() {
      const media = await this.waitForCurrentMedia();
      if (!hasUsableMedia(media)) {
        this.toast(this.t("no_media"));
        return;
      }
      const language = resolveLanguage(this.configStore.get(), this.window.navigator);
      const details = buildDetailsModel(media, this.configStore.get(), language);
      const modal = this.createModal(this.t("details_title"));
      modal.classList.add(`${SCRIPT_PREFIX}-details-modal`);
      modal.querySelector("header")?.remove();
      const close = createElement(this.document, "button", `${SCRIPT_PREFIX}-details-close`, "x");
      close.type = "button";
      close.title = this.t("close");
      close.addEventListener("click", () => modal.parentElement.remove());
      modal.appendChild(close);
      const main = modal.querySelector("main");

      const copyText = (value) => {
        const text = String(value || "");
        if (!text) return;
        try {
          const result = this.window.navigator.clipboard?.writeText(text);
          if (result?.catch) result.catch(() => {});
          this.toast(this.t("copied"));
        } catch (_err) {
          this.toast(text);
        }
      };

      const makeFieldset = (title) => {
        const fieldset = createElement(this.document, "fieldset", `${SCRIPT_PREFIX}-detail-fieldset`);
        fieldset.appendChild(createElement(this.document, "legend", "", title));
        return fieldset;
      };

      const makePillButton = (label, onClick) => {
        const button = createElement(this.document, "button", `${SCRIPT_PREFIX}-detail-pill`, label);
        button.type = "button";
        button.addEventListener("click", onClick);
        return button;
      };

      const makePillLink = (label, url) => {
        if (!url) return createElement(this.document, "span", `${SCRIPT_PREFIX}-detail-pill`, "-");
        const link = createElement(this.document, "a", `${SCRIPT_PREFIX}-link`, this.t("open"));
        link.className = `${SCRIPT_PREFIX}-detail-pill`;
        link.textContent = label;
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        return link;
      };

      const makeActions = (...items) => {
        const actions = createElement(this.document, "div", `${SCRIPT_PREFIX}-detail-actions`);
        items.filter(Boolean).forEach((item) => actions.appendChild(item));
        return actions;
      };

      const makeDownloadPill = (urls, filename, label = this.t("download")) => {
        const button = makePillButton(label, () => this.downloadAsset(urls, filename));
        button.removeAttribute?.("title");
        return button;
      };

      const makeCopyPill = (value, label = this.t("copy")) =>
        value ? makePillButton(label, () => copyText(value)) : null;

      const appendValue = (cell, value) => {
        if (value instanceof this.window.Node) {
          cell.appendChild(value);
        } else {
          cell.textContent = value === undefined || value === null || value === "" ? "-" : String(value);
        }
      };

      const makeRows = (rows) => {
        const table = createElement(this.document, "table", `${SCRIPT_PREFIX}-detail-rows`);
        const tbody = createElement(this.document, "tbody");
        const hasActionColumn = rows.some((row) => row.copy);
        rows.forEach((row) => {
          const tr = createElement(this.document, "tr");
          const label = createElement(this.document, "th", "", row.label);
          const valueCell = createElement(this.document, "td", `${SCRIPT_PREFIX}-detail-value`);
          appendValue(valueCell, row.value);
          tr.append(label, valueCell);
          if (hasActionColumn) {
            const actionCell = createElement(this.document, "td");
            if (row.copy) actionCell.appendChild(makeCopyPill(row.copy));
            tr.appendChild(actionCell);
          }
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        return table;
      };

      const makeTable = (headers, rows) => {
        const wrap = createElement(this.document, "div", `${SCRIPT_PREFIX}-detail-table-wrap`);
        const table = createElement(this.document, "table", `${SCRIPT_PREFIX}-detail-table`);
        const thead = createElement(this.document, "thead");
        const headRow = createElement(this.document, "tr");
        headers.forEach((header) => headRow.appendChild(createElement(this.document, "th", "", header)));
        thead.appendChild(headRow);
        const tbody = createElement(this.document, "tbody");
        if (!rows.length) {
          const row = createElement(this.document, "tr");
          const cell = createElement(this.document, "td", "", this.t("no_items"));
          cell.colSpan = headers.length;
          row.appendChild(cell);
          tbody.appendChild(row);
        } else {
          rows.forEach((cells) => {
            const row = createElement(this.document, "tr");
            cells.forEach((cellValue) => {
              const cell = createElement(this.document, "td");
              appendValue(cell, cellValue);
              row.appendChild(cell);
            });
            tbody.appendChild(row);
          });
        }
        table.append(thead, tbody);
        wrap.appendChild(table);
        return wrap;
      };

      const formatBool = (value) => {
        if (value === undefined || value === null) return "-";
        return value ? this.t("yes") : this.t("no");
      };

      const tabs = createElement(this.document, "div", `${SCRIPT_PREFIX}-detail-tabs`);
      const body = createElement(this.document, "div", `${SCRIPT_PREFIX}-detail-body`);
      const panels = new Map();
      const activateTab = (id) => {
        tabs.querySelectorAll(`.${SCRIPT_PREFIX}-detail-tab`).forEach((button) => {
          button.classList.toggle("active", button.dataset.tab === id);
        });
        panels.forEach((panel, panelId) => {
          panel.hidden = panelId !== id;
        });
      };

      details.tabs.forEach((tab, index) => {
        const button = createElement(this.document, "button", `${SCRIPT_PREFIX}-detail-tab`, tab.label);
        button.type = "button";
        button.dataset.tab = tab.id;
        button.addEventListener("click", () => activateTab(tab.id));
        if (index === 0) button.classList.add("active");
        tabs.appendChild(button);
      });

      const mediaPanel = createElement(this.document, "div", `${SCRIPT_PREFIX}-detail-panel`);
      const coverSection = makeFieldset(this.t("video_cover"));
      if (details.cover.url) {
        const coverRow = createElement(this.document, "div", `${SCRIPT_PREFIX}-detail-cover-row`);
        coverRow.classList.add(`${SCRIPT_PREFIX}-cover-${details.cover.orientation}`);
        const image = createElement(this.document, "img", `${SCRIPT_PREFIX}-detail-cover`);
        image.src = details.cover.url;
        image.alt = this.t("cover");
        const info = createElement(this.document, "div", `${SCRIPT_PREFIX}-detail-cover-info`);
        const coverResolution = createElement(
          this.document,
          "strong",
          `${SCRIPT_PREFIX}-cover-resolution`,
          details.cover.resolution,
        );
        info.append(
          makeRows([{ label: this.t("resolution"), value: coverResolution }]),
          makeActions(
            makePillLink(this.t("new_tab_open"), details.cover.url),
            makeDownloadPill(details.cover.url, details.cover.filename, this.t("download_cover")),
          ),
        );
        coverRow.append(image, info);
        coverSection.appendChild(coverRow);
      } else {
        coverSection.appendChild(createElement(this.document, "p", "", this.t("no_items")));
      }

      const videoSection = makeFieldset(this.t("video_sources"));
      const videoSourceTable = makeTable(
        [
          ...details.videoSourceColumns.map((column) => column.label),
          this.t("actions"),
        ],
        details.videoSources.map((source) => {
          const actions = makeActions(
            makePillLink(this.t("open"), source.url),
            makeCopyPill(source.url),
            makeDownloadPill(source.urls, source.filename, this.t("download")),
          );
          return [
            ...details.videoSourceColumns.map((column) => source[column.key] || "-"),
            actions,
          ];
        }),
      );
      videoSection.appendChild(videoSourceTable);

      const imageSection = makeFieldset(`${this.t("image_album")} (${details.images.length})`);
      imageSection.appendChild(
        makeTable(
          [this.t("id"), this.t("resolution"), this.t("actions")],
          details.images.map((image) => {
            const actions = makeActions(
              makePillLink(this.t("open"), image.url),
              makeCopyPill(image.url),
              makeDownloadPill(image.urls, image.filename, this.t("download")),
            );
            return [String(image.index), image.resolution, actions];
          }),
        ),
      );

      const musicSection = this.renderMusicSection(details, { makeFieldset, makeRows });
      const mediaGrid = createElement(this.document, "div", `${SCRIPT_PREFIX}-detail-media-grid`);
      mediaGrid.append(coverSection, musicSection);
      mediaPanel.appendChild(mediaGrid);
      if (details.showVideoSources) mediaPanel.appendChild(videoSection);
      if (details.isImagePost) mediaPanel.appendChild(imageSection);

      const authorPanel = createElement(this.document, "div", `${SCRIPT_PREFIX}-detail-panel`);
      authorPanel.hidden = true;
      const authorSection = makeFieldset(this.t("author_info"));
      const authorHead = createElement(this.document, "div", `${SCRIPT_PREFIX}-detail-author-head`);
      if (details.author.avatarUrl) {
        const avatar = createElement(this.document, "img", `${SCRIPT_PREFIX}-detail-avatar`);
        avatar.src = details.author.avatarUrl;
        avatar.alt = this.t("avatar");
        authorHead.appendChild(avatar);
      }
      const authorTitle = createElement(this.document, "div");
      authorTitle.appendChild(createElement(this.document, "h3", "", details.author.nickname || "-"));
      authorTitle.appendChild(
        makeActions(makePillLink(this.t("visit_profile"), details.author.profileUrl)),
      );
      authorHead.appendChild(authorTitle);
      authorSection.append(
        authorHead,
        makeRows([
          { label: this.t("verification"), value: details.author.verification || "-" },
          { label: this.t("uid"), value: details.author.uid, copy: details.author.uid },
          { label: this.t("sec_uid"), value: details.author.secUid, copy: details.author.secUid },
          { label: this.t("unique_id"), value: details.author.uniqueId, copy: details.author.uniqueId },
          { label: this.t("followers"), value: details.author.followerCount },
          { label: this.t("likes_received"), value: details.author.totalFavorited },
          { label: this.t("description"), value: details.author.signature },
        ]),
      );
      authorPanel.appendChild(authorSection);

      const postPanel = createElement(this.document, "div", `${SCRIPT_PREFIX}-detail-panel`);
      postPanel.hidden = true;
      const descSection = makeFieldset(this.t("description"));
      descSection.appendChild(
        createElement(this.document, "div", `${SCRIPT_PREFIX}-detail-value`, details.post.description || "-"),
      );
      const statsSection = makeFieldset(this.t("data_stats"));
      statsSection.appendChild(
        makeRows([
          { label: this.t("created_at"), value: details.post.createdAt },
          { label: this.t("share_link"), value: details.post.shareUrl, copy: details.post.shareUrl },
          { label: details.stats.diggCount.label, value: details.stats.diggCount.value },
          { label: details.stats.commentCount.label, value: details.stats.commentCount.value },
          { label: details.stats.collectCount.label, value: details.stats.collectCount.value },
          { label: details.stats.shareCount.label, value: details.stats.shareCount.value },
          { label: details.stats.playCount.label, value: details.stats.playCount.value },
          { label: this.t("hashtags"), value: details.hashtags.join(", ") },
        ]),
      );
      const idsSection = makeFieldset(this.t("id_info"));
      idsSection.appendChild(
        makeRows([
          { label: this.t("video_id"), value: details.post.ids.videoId, copy: details.post.ids.videoId },
          { label: this.t("group_id"), value: details.post.ids.groupId, copy: details.post.ids.groupId },
        ]),
      );
      postPanel.append(descSection, statsSection, idsSection);
      if (details.post.permissionRows.length) {
        const permissionsSection = makeFieldset(this.t("permissions_status"));
        permissionsSection.appendChild(
          makeRows(
            details.post.permissionRows.map((row) => ({
              label: row.label,
              value: formatBool(row.value),
            })),
          ),
        );
        postPanel.appendChild(permissionsSection);
      }

      const jsonPanel = createElement(this.document, "div", `${SCRIPT_PREFIX}-detail-panel`);
      jsonPanel.hidden = true;
      const jsonSection = makeFieldset(this.t("raw_json"));
      const jsonActions = createElement(this.document, "div", `${SCRIPT_PREFIX}-detail-json-actions`);
      const pre = createElement(this.document, "pre", `${SCRIPT_PREFIX}-json-pre`, details.rawJson);
      jsonActions.append(
        makePillButton(this.t("select_all"), () => {
          const range = this.document.createRange();
          range.selectNodeContents(pre);
          const selection = this.window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
        }),
        makePillButton(this.t("console_log"), () => {
          this.window.console?.log?.("[TikTok Helper]", media.raw || media);
          this.toast(this.t("json_logged"));
        }),
        makePillButton(this.t("copy_json"), () => copyText(details.rawJson)),
      );
      jsonSection.append(jsonActions, pre);
      jsonPanel.appendChild(jsonSection);

      panels.set("media", mediaPanel);
      panels.set("author", authorPanel);
      panels.set("post", postPanel);
      panels.set("json", jsonPanel);
      body.append(mediaPanel, authorPanel, postPanel, jsonPanel);
      main.append(tabs, body);
    }

    openSettings() {
      const config = this.configStore.get();
      const modal = this.createModal(this.t("settings"), "", {
        closeOnBackdrop: false,
      });
      modal.classList.add(`${SCRIPT_PREFIX}-settings-modal`);
      modal.querySelector("header")?.remove();
      const main = modal.querySelector("main");
      const closeModal = () => modal.parentElement.remove();

      const header = createElement(this.document, "header", `${SCRIPT_PREFIX}-settings-header`);
      header.appendChild(createElement(this.document, "h2", `${SCRIPT_PREFIX}-settings-title`, this.t("settings")));
      const headerActions = createElement(this.document, "div", `${SCRIPT_PREFIX}-settings-header-actions`);
      header.appendChild(headerActions);
      modal.insertBefore(header, main);

      const makeFieldset = (title, ...children) => {
        const fieldset = createElement(this.document, "fieldset", `${SCRIPT_PREFIX}-detail-fieldset ${SCRIPT_PREFIX}-settings-fieldset`);
        fieldset.appendChild(createElement(this.document, "legend", "", title));
        children.filter(Boolean).forEach((child) => fieldset.appendChild(child));
        return fieldset;
      };

      const language = this.input(
        this.t("language"),
        "select",
        "language",
        config.language,
        "tooltip_language",
      );
      LANGUAGE_OPTIONS.forEach(([value, label]) => {
        const option = createElement(this.document, "option");
        option.value = value;
        option.textContent = label;
        if (value === config.language) option.selected = true;
        language.appendChild(option);
      });

      const theme = this.input(
        this.t("theme"),
        "select",
        "theme",
        config.theme,
        "tooltip_theme",
      );
      THEME_OPTIONS.forEach(([value, label]) => {
        const option = createElement(this.document, "option");
        option.value = value;
        option.textContent = label;
        if (value === config.theme) option.selected = true;
        theme.appendChild(option);
      });

      const quality = this.input(
        this.t("video_resolution"),
        "select",
        "video_quality",
        config.video_quality,
        "tooltip_video_resolution",
      );
      VIDEO_QUALITY_OPTIONS.forEach((value) => {
        const option = createElement(this.document, "option");
        option.value = value;
        option.textContent = this.t(`quality_${value}`);
        if (value === config.video_quality) option.selected = true;
        quality.appendChild(option);
      });

      const downloadMethod = this.input(
        this.t("download"),
        "select",
        "download_method",
        config.download_method,
        "tooltip_browser_downloads_only",
      );
      DOWNLOAD_METHOD_OPTIONS.forEach((value) => {
        const option = createElement(this.document, "option");
        option.value = value;
        option.textContent = this.t(`download_method_${value}`) || value;
        if (value === config.download_method) option.selected = true;
        downloadMethod.appendChild(option);
      });

      const appearanceGrid = createElement(this.document, "div", `${SCRIPT_PREFIX}-settings-grid`);
      appearanceGrid.append(language.wrapper, theme.wrapper);

      const downloadGrid = createElement(this.document, "div", `${SCRIPT_PREFIX}-settings-grid`);
      const downloaderNote = createElement(
        this.document,
        "div",
        `${SCRIPT_PREFIX}-readonly ${SCRIPT_PREFIX}-settings-note full`,
        this.t("browser_downloader_note"),
      );
      downloadGrid.append(downloadMethod.wrapper, quality.wrapper, downloaderNote);

      const selectedSourceColumns = new Set(normalizeVideoSourceColumns(config.video_source_columns));
      const sourceColumns = this.fieldWrapper(this.t("source_columns"), "", "full");
      const sourceColumnList = createElement(this.document, "div", `${SCRIPT_PREFIX}-chip-list`);
      VIDEO_SOURCE_COLUMN_DEFINITIONS.forEach((definition) => {
        const chip = createElement(this.document, "label", `${SCRIPT_PREFIX}-check-chip`);
        const checkbox = createElement(this.document, "input");
        checkbox.type = "checkbox";
        checkbox.dataset.sourceColumn = definition.key;
        checkbox.checked = selectedSourceColumns.has(definition.key);
        const text = createElement(
          this.document,
          "span",
          "",
          this.t(definition.messageKey) || definition.key,
        );
        chip.append(checkbox, text);
        sourceColumnList.appendChild(chip);
      });
      sourceColumns.appendChild(sourceColumnList);
      downloadGrid.appendChild(sourceColumns);

      const maxLength = this.input(
        this.t("filename_max_length"),
        "number",
        "filename_max_length",
        config.filename_max_length,
        "tooltip_filename_max_length",
      );
      const albumIndexFormat = this.input(
        this.t("album_index_format"),
        "select",
        "album_index_format",
        normalizeAlbumIndexFormat(config.album_index_format),
        "tooltip_album_index_format",
      );
      ALBUM_INDEX_FORMAT_OPTIONS.forEach((definition) => {
        const option = createElement(this.document, "option");
        option.value = definition.value;
        option.textContent = definition.label;
        if (definition.value === normalizeAlbumIndexFormat(config.album_index_format)) {
          option.selected = true;
        }
        albumIndexFormat.appendChild(option);
      });
      const filenameEditor = this.createFilenameTemplateEditor(config, {
        previewMedia: this.getFilenamePreviewMedia(),
        getMaxLength: () => Number(maxLength.value || config.filename_max_length || 80),
      });
      maxLength.addEventListener("input", () => filenameEditor.updatePreview());
      const filenameGrid = createElement(this.document, "div", `${SCRIPT_PREFIX}-settings-grid`);
      filenameGrid.append(maxLength.wrapper, albumIndexFormat.wrapper, filenameEditor.element);

      const shortcutGrid = createElement(this.document, "div", `${SCRIPT_PREFIX}-settings-grid`);
      const shortcutInputs = [
        this.input(this.t("shortcut_download"), "text", "shortcut_download", config.shortcut_download),
        this.input(this.t("shortcut_frame"), "text", "shortcut_frame", config.shortcut_frame),
        this.input(this.t("shortcut_details"), "text", "shortcut_details", config.shortcut_details),
        this.input(this.t("shortcut_settings"), "text", "shortcut_settings", config.shortcut_settings),
      ];
      const bindShortcutInput = (input) => {
        input.autocomplete = "off";
        input.spellcheck = false;
        input.readOnly = true;
        input.addEventListener("keydown", (event) => {
          captureShortcutInputKey(input, event);
        });
      };
      shortcutInputs.forEach(bindShortcutInput);
      const shortcutNote = createElement(
        this.document,
        "div",
        `${SCRIPT_PREFIX}-readonly ${SCRIPT_PREFIX}-settings-note full`,
        this.t("shortcut_hint"),
      );
      shortcutGrid.append(...shortcutInputs.map((input) => input.wrapper), shortcutNote);

      main.append(
        makeFieldset(this.t("appearance_section"), appearanceGrid),
        makeFieldset(this.t("download_section"), downloadGrid),
        makeFieldset(this.t("filename_section"), filenameGrid),
        makeFieldset(this.t("shortcut_section"), shortcutGrid),
      );

      headerActions.append(
        this.actionButton(this.t("save"), () => {
          const formValues = {};
          modal.querySelectorAll("[data-config-key]").forEach((input) => {
            formValues[input.dataset.configKey] = input.value;
          });
          formValues.filename_max_length = Number(formValues.filename_max_length || 80);
          formValues.video_source_columns = Array.from(
            modal.querySelectorAll("[data-source-column]:checked"),
          ).map((input) => input.dataset.sourceColumn);
          this.configStore.save({ ...formValues, ...filenameEditor.getValues() });
          this.applyPanelState();
          this.mountPanel();
          closeModal();
          this.toast(this.t("settings_saved"));
        }, "primary"),
        this.actionButton(this.t("close"), closeModal, "secondary"),
      );
    }

    createFilenameTemplateEditor(config, options = {}) {
      const element = createElement(
        this.document,
        "div",
        `${SCRIPT_PREFIX}-filename-template-editor full`,
      );
      const templateInput = this.input(
        this.t("template"),
        "textarea",
        "",
        getFilenameTemplate(config),
        "tooltip_custom_template",
      );
      templateInput.classList.add(`${SCRIPT_PREFIX}-template-textarea`);
      delete templateInput.dataset.configKey;
      const previewBlock = this.fieldWrapper(this.t("filename_preview"), "", "full");
      const previewValue = createElement(this.document, "div", `${SCRIPT_PREFIX}-filename-preview`);
      previewBlock.appendChild(previewValue);
      const renderPreview = () => {
        const previewConfig = {
          ...config,
          filename_template: getFilenameTemplate({ filename_template: templateInput.value }),
          filename_max_length:
            Number(options.getMaxLength?.() || config.filename_max_length || 80) || 80,
        };
        previewValue.textContent = buildFilename(
          options.previewMedia || this.getFilenamePreviewMedia(),
          previewConfig,
        );
      };
      templateInput.addEventListener("input", () => {
        const rawValue = templateInput.value;
        const cursor = templateInput.selectionStart || rawValue.length;
        const nextValue = rawValue.replace(/`/g, "");
        if (nextValue !== templateInput.value) {
          const removedBeforeCursor =
            rawValue.slice(0, cursor).length - rawValue.slice(0, cursor).replace(/`/g, "").length;
          templateInput.value = nextValue;
          const nextCursor = Math.max(0, cursor - removedBeforeCursor);
          templateInput.selectionStart = templateInput.selectionEnd = nextCursor;
        }
        renderPreview();
      });

      const availableBlock = this.fieldWrapper(
        this.t("available_fields"),
        "tooltip_available_fields",
        "full",
      );
      const availableList = createElement(this.document, "div", `${SCRIPT_PREFIX}-chip-list`);
      availableBlock.appendChild(availableList);
      element.append(templateInput.wrapper, availableBlock, previewBlock);

      const insertToken = (token) => {
        templateInput.value = appendFilenameTemplateToken(templateInput.value, token);
        templateInput.selectionStart = templateInput.selectionEnd = templateInput.value.length;
        templateInput.dispatchEvent(new Event("input", { bubbles: true }));
      };

      const insertLiteral = (literal) => {
        templateInput.value = appendFilenameTemplateLiteral(templateInput.value, literal);
        templateInput.selectionStart = templateInput.selectionEnd = templateInput.value.length;
        templateInput.dispatchEvent(new Event("input", { bubbles: true }));
      };

      const renderFieldChip = (field) => {
        const metadata = getFilenameField(field);
        const chip = createElement(
          this.document,
          "button",
          `${SCRIPT_PREFIX}-chip available`,
        );
        chip.type = "button";
        chip.dataset.field = field;
        chip.innerHTML = `<span>${escapeHtml(field)}</span><small>${escapeHtml(this.fieldLabel(metadata))}</small>`;
        return chip;
      };

      const renderSeparatorChip = (separator) => {
        const chip = createElement(
          this.document,
          "button",
          `${SCRIPT_PREFIX}-chip available separator`,
        );
        chip.type = "button";
        chip.dataset.separator = separator.value;
        chip.innerHTML = `<span>${escapeHtml(separator.display)}</span><small>${escapeHtml(this.separatorLabel(separator))}</small>`;
        return chip;
      };

      const renderAvailable = () => {
        availableList.textContent = "";
        FILENAME_TEMPLATE_SEPARATORS.forEach((separator) => {
          const available = renderSeparatorChip(separator);
          available.addEventListener("click", () => {
            insertLiteral(separator.value);
          });
          availableList.appendChild(available);
        });
        FILENAME_TEMPLATE_FIELDS.forEach((field) => {
          const available = renderFieldChip(field.name);
          available.addEventListener("click", () => {
            insertToken(field.name);
          });
          availableList.appendChild(available);
        });
      };
      renderAvailable();
      renderPreview();

      return {
        element,
        updatePreview: renderPreview,
        getValues: () => {
          return {
            filename_template: getFilenameTemplate({ filename_template: templateInput.value }),
          };
        },
      };
    }

    section(title, ...children) {
      const section = createElement(this.document, "section", `${SCRIPT_PREFIX}-section`);
      const heading = createElement(this.document, "h3", `${SCRIPT_PREFIX}-section-title`, title);
      section.append(heading, ...children);
      return section;
    }

    fieldLabel(field) {
      const language = resolveLanguage(this.configStore.get(), this.window.navigator);
      return language === "zh" ? field?.zh || field?.en || "" : field?.en || field?.zh || "";
    }

    fieldDescription(field) {
      const language = resolveLanguage(this.configStore.get(), this.window.navigator);
      return language === "zh"
        ? field?.description_zh || field?.description_en || ""
        : field?.description_en || field?.description_zh || "";
    }

    separatorLabel(separator) {
      const language = resolveLanguage(this.configStore.get(), this.window.navigator);
      return language === "zh"
        ? separator?.zh || separator?.en || ""
        : separator?.en || separator?.zh || "";
    }

    fieldWrapper(labelText, tooltipKey = "", className = "") {
      const wrapper = createElement(
        this.document,
        "div",
        `${SCRIPT_PREFIX}-field${className ? ` ${className}` : ""}`,
      );
      const label = createElement(this.document, "label");
      label.appendChild(this.document.createTextNode(labelText));
      wrapper.appendChild(label);
      return wrapper;
    }

    input(labelText, type, key, value, tooltipKey = "", className = "") {
      const wrapper = this.fieldWrapper(labelText, tooltipKey, className);
      let input;
      if (type === "select") {
        input = createElement(this.document, "select");
      } else if (type === "textarea") {
        input = createElement(this.document, "textarea");
      } else {
        input = createElement(this.document, "input");
        input.type = type;
      }
      if (key) input.dataset.configKey = key;
      input.value = value ?? "";
      wrapper.appendChild(input);
      input.wrapper = wrapper;
      return input;
    }
    actionButton(text, onClick, className = "") {
      const button = createElement(
        this.document,
        "button",
        `${SCRIPT_PREFIX}-button${className ? ` ${className}` : ""}`,
        text,
      );
      button.type = "button";
      button.addEventListener("click", onClick);
      return button;
    }

    createModal(title, subtitle = "", options = {}) {
      const backdrop = createElement(
        this.document,
        "div",
        `${SCRIPT_PREFIX}-modal-backdrop`,
      );
      const modal = createElement(this.document, "section", `${SCRIPT_PREFIX}-modal`);
      modal.classList.add(this.getTheme());
      const header = createElement(this.document, "header");
      const titleGroup = createElement(this.document, "div");
      const heading = createElement(this.document, "h2", "", title);
      titleGroup.appendChild(heading);
      if (subtitle) {
        titleGroup.appendChild(
          createElement(this.document, "p", `${SCRIPT_PREFIX}-subtitle`, subtitle),
        );
      }
      const close = createElement(this.document, "button", `${SCRIPT_PREFIX}-close`, this.t("close"));
      close.type = "button";
      close.addEventListener("click", () => backdrop.remove());
      const main = createElement(this.document, "main");
      header.append(titleGroup, close);
      modal.append(header, main);
      backdrop.appendChild(modal);
      if (options.closeOnBackdrop !== false) {
        backdrop.addEventListener("click", (event) => {
          if (event.target === backdrop) backdrop.remove();
        });
      }
      this.document.body.appendChild(backdrop);
      return modal;
    }

    toast(message) {
      const previous = this.document.querySelector(`.${SCRIPT_PREFIX}-toast`);
      if (previous) previous.remove();
      const toast = createElement(this.document, "div", `${SCRIPT_PREFIX}-toast`, message);
      toast.classList.add(this.getTheme());
      this.document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 2600);
    }

    bindHotkey() {
      this.document.addEventListener("keydown", (event) => {
        const target = event.target;
        const tag = target?.tagName?.toLowerCase();
        if (
          tag === "input" ||
          tag === "textarea" ||
          tag === "select" ||
          target?.isContentEditable
        ) {
          return;
        }
        const config = this.configStore.get();
        const actions = [
          { hotkey: config.shortcut_download, run: () => this.downloadVideo() },
          { hotkey: config.shortcut_frame, run: () => this.openFrameCapture() },
          { hotkey: config.shortcut_details, run: () => this.openDetails() },
          { hotkey: config.shortcut_settings, run: () => this.openSettings() },
        ];
        const action = actions.find((item) => eventMatchesHotkey(event, item.hotkey));
        if (!action) return;
        event.preventDefault();
        action.run();
      });
    }

    watchRouteChanges() {
      this.lastHref = this.window.location.href;
      setInterval(() => {
        if (this.window.location.href === this.lastHref) return;
        this.lastHref = this.window.location.href;
        setTimeout(() => {
          this.refreshMedia();
          this.mountPanel();
        }, 500);
      }, 1000);
    }

    getPanelPositionSignature() {
      const rectSignature = (source) => {
        const rect = source?.getBoundingClientRect?.() || source;
        if (!rect) return "none";
        return [
          Math.round(Number(rect.left || 0)),
          Math.round(Number(rect.top || 0)),
          Math.round(Number(rect.width || 0)),
          Math.round(Number(rect.height || 0)),
        ].join(",");
      };
      const actionContext = this.findActionBarPositionContext?.();
      return [
        this.window.location?.href || "",
        this.window.innerWidth || 0,
        this.window.innerHeight || 0,
        rectSignature(actionContext?.host || this.findActionBarHost()),
        rectSignature(actionContext?.anchorRect),
        rectSignature(actionContext?.nextRect),
        rectSignature(this.extractor?.getVisibleVideoElement?.()),
      ].join("|");
    }

    watchPanelPosition() {
      if (this.positionObserver) return;
      const schedule = () => {
        if (this.positionFrame) return;
        const run = () => {
          this.positionFrame = null;
          this.mountPanel();
          this.applyPanelState();
        };
        if (typeof this.window.requestAnimationFrame === "function") {
          this.positionFrame = this.window.requestAnimationFrame(run);
        } else {
          this.positionFrame = this.window.setTimeout(run, 50);
        }
      };
      const scheduleIfChanged = () => {
        const signature = this.getPanelPositionSignature();
        if (signature === this.lastPanelPositionSignature) return;
        this.lastPanelPositionSignature = signature;
        schedule();
      };

      // Separate from the position-signature dedup above: whether an image preview overlay
      // is open or closed generally does NOT change the video/action-bar's own geometry (see
      // getPanelPositionSignature()), so scheduleIfChanged() alone would often never notice
      // it. This runs on every DOM mutation instead (rAF-throttled so a burst of mutations
      // still only costs one check per frame), independent of the position-signature gate.
      let imageOverlayFrame = null;
      const checkImageOverlay = () => {
        if (imageOverlayFrame) return;
        const run = () => {
          imageOverlayFrame = null;
          this.refreshImageOverlayState();
        };
        if (typeof this.window.requestAnimationFrame === "function") {
          imageOverlayFrame = this.window.requestAnimationFrame(run);
        } else {
          imageOverlayFrame = this.window.setTimeout(run, 50);
        }
      };

      // NOTE: high-frequency triggers (scroll/wheel/touchmove/mutations/poll) are wired to
      // `scheduleIfChanged`, not the raw `schedule`. `scheduleIfChanged` does a cheap
      // rect-signature comparison first and only pays for the expensive
      // mountPanel()/applyPanelState() DOM recompute when the layout actually moved.
      // (Previously every listener called `schedule` directly, so the signature check was
      // computed once at setup and never consulted again afterward — every scroll pixel or
      // React re-render on the page forced a full DOM re-scan on each animation frame.)
      if (typeof this.window.MutationObserver === "function" && this.document.body) {
        this.positionObserver = new this.window.MutationObserver(() => {
          scheduleIfChanged();
          checkImageOverlay();
        });
        this.positionObserver.observe(this.document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["class", "style"],
        });
      } else {
        this.positionObserver = { disconnect() {} };
      }
      this.window.addEventListener?.("resize", scheduleIfChanged);
      this.window.addEventListener?.("orientationchange", scheduleIfChanged);
      this.document.addEventListener?.("scroll", scheduleIfChanged, true);
      this.document.addEventListener?.("wheel", scheduleIfChanged, true);
      this.document.addEventListener?.("touchmove", scheduleIfChanged, true);
      if (!this.positionPoll && typeof this.window.setInterval === "function") {
        this.positionPoll = this.window.setInterval(scheduleIfChanged, 250);
      }
      scheduleIfChanged();
      schedule();
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  const testApi = {
    DEFAULT_CONFIG,
    VIDEO_QUALITY_OPTIONS,
    LANGUAGE_OPTIONS,
    THEME_OPTIONS,
    DOWNLOAD_METHOD_OPTIONS,
    ALBUM_INDEX_FORMAT_OPTIONS,
    getMessage,
    resolveLanguage,
    resolveTheme,
    parseJsonScriptText,
    parsePageDataFromWindow,
    findVideoItemInPageData,
    findVideoItemDeep,
    collectVideoItemsDeep,
    RuntimeMediaCache,
    findBestMediaMatch,
    collectVideoItemsDeep,
    TikTokMediaExtractor,
    TikTokDlApp,
    ActionBarLocator,
    findOpenImageOverlay,
    getSafeOverlayButtonPlacement,
    getPanelStyleSheet,
    calculatePanelPosition,
    calculateEmbeddedPanelPosition,
    calculatePanelMenuPlacement,
    isActionBarClassName,
    isUsableActionBarRect,
    scoreActionBarRect,
    getEmbeddedLauncherPalette,
    extractMediaFromPageData,
    extractMediaFromVideoElement,
    extractImageSources,
    extractVideoSources,
    extractVideoUrls,
    selectVideoSource,
    normalizeMediaItem,
    normalizeFilename,
    truncateAtUtf16Boundary,
    FILENAME_TEMPLATE_FIELDS,
    FILENAME_TEMPLATE_SEPARATORS,
    getFilenameTemplate,
    formatAlbumIndex,
    appendFilenameTemplateToken,
    appendFilenameTemplateLiteral,
    sanitizeConfig,
    normalizeHotkey,
    hotkeyFromEvent,
    captureShortcutInputKey,
    eventMatchesHotkey,
    buildFilename,
    buildDetailsModel,
    formatNumber,
    formatOptionalNumber,
    normalizeHeaders,
    toShortId,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { __test: testApi };
  }

  const runtimeCache = root?.__tkDlRuntimeCache || new RuntimeMediaCache();
  if (root?.document) {
    root.__tkDlRuntimeCache = runtimeCache;
    new RuntimeResponseObserver(root, runtimeCache).install();
  }

  if (root?.document) {
    const start = () => {
      if (root.__tikTokDlApp) return;
      root.__tikTokDlApp = new TikTokDlApp(root, runtimeCache);
      root.__tikTokDlApp.start();
    };
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
      start();
    }
  }
})(typeof unsafeWindow !== "undefined" ? unsafeWindow : globalThis);
