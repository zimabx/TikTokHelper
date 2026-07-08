// ==UserScript==
// @name         TikTokHelper
// @name:zh-CN  TikTokHelper - TikTok 下载助手
// @description  Add compact download tools for TikTok videos, photo posts, profile pop-ups, and manually selected profile posts.
// @description:zh-CN  为 TikTok 网页端添加紧凑的下载工具，支持推荐页、图集、个人页视频弹窗和个人主页手动多选下载。
// @namespace       https://github.com/zimabx/TikTokHelper
// @version         0.9.19
// @author          zimabx
// @match           https://*.tiktok.com/*
// @icon            https://www.google.com/s2/favicons?sz=64&domain=tiktok.com
// @license         MIT
// @grant           GM_xmlhttpRequest
// @grant           GM_download
// @grant           GM_registerMenuCommand
// @connect         tiktok.com
// @connect         *.tiktok.com
// @connect         tiktokcdn.com
// @connect         *.tiktokcdn.com
// @connect         tiktokcdn-us.com
// @connect         *.tiktokcdn-us.com
// @connect         tiktokv.com
// @connect         *.tiktokv.com
// @connect         byteoversea.com
// @connect         *.byteoversea.com
// @connect         ibytedtos.com
// @connect         *.ibytedtos.com
// @connect         bytefcdn-oversea.com
// @connect         *.bytefcdn-oversea.com
// @connect         muscdn.com
// @connect         *.muscdn.com
// @run-at          document-start
// @downloadURL https://update.greasyfork.org/scripts/586126/TikTokHelper.user.js
// @updateURL https://update.greasyfork.org/scripts/586126/TikTokHelper.meta.js
// ==/UserScript==

(function (root) {
  "use strict";

  const SCRIPT_PREFIX = "tthelper";
  const CONFIG_KEY = "__tthelper-user-js__";
  const gmXmlHttpRequest =
    typeof GM_xmlhttpRequest !== "undefined"
      ? GM_xmlhttpRequest
      : root?.GM_xmlhttpRequest;
  const gmDownload =
    typeof GM_download !== "undefined"
      ? GM_download
      : root?.GM_download;
  const gmRegisterMenuCommand =
    typeof GM_registerMenuCommand !== "undefined"
      ? GM_registerMenuCommand
      : root?.GM_registerMenuCommand;
  const MEDIA_READY_ATTEMPTS = 6;
  const MEDIA_READY_INTERVAL_MS = 120;
  const MEDIA_READY_COLD_START_ATTEMPTS = 24;
  const MEDIA_READY_COLD_START_INTERVAL_MS = 200;
  const MEDIA_READY_COLD_START_WINDOW_MS = 8000;
  const RUNTIME_OBSERVER_MAX_TEXT_BYTES = 2 * 1024 * 1024;
  const RUNTIME_OBSERVER_CONTENT_TYPE_RE =
    /(?:application\/json|text\/plain|application\/x-ndjson|application\/ld\+json)/i;
  const RUNTIME_OBSERVER_URL_HINT_RE =
    /(?:\/api\/|\/aweme\/|\/item\/|\/feed\/|\/detail\/|\/node\/share|\/v1\/|\/v2\/|\/tiktok\/)/i;

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
    profile_bulk_checkbox_size: 26,
    show_test_notification_menu: false,
    show_debug_info_menu: false,
  };

  const ALLOWED_DOWNLOAD_HOST_SUFFIXES = [
    "tiktok.com",
    "tiktokcdn.com",
    "tiktokcdn-us.com",
    "tiktokv.com",
    "byteoversea.com",
    "ibytedtos.com",
    "bytefcdn-oversea.com",
    "muscdn.com",
  ];

  function isAllowedDownloadHost(hostname = "") {
    const host = String(hostname || "").toLowerCase();
    return ALLOWED_DOWNLOAD_HOST_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    );
  }

  function normalizeSafeDownloadUrl(rawUrl = "", baseUrl = "https://www.tiktok.com/") {
    const value = String(rawUrl || "").trim();
    if (!value) throw new Error("Empty download URL");

    const parsed = new URL(value, baseUrl);
    if (parsed.protocol !== "https:") {
      throw new Error(`Blocked non-HTTPS download URL: ${parsed.protocol}`);
    }
    if (!isAllowedDownloadHost(parsed.hostname)) {
      throw new Error(`Blocked download host: ${parsed.hostname}`);
    }
    return parsed.href;
  }

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
      download_preparing: "Preparing download...",
      downloading: "Downloading",
      download_completed: "Download completed",
      preparing_video_download: "Preparing video download...",
      downloading_album: "Downloading album",
      downloading_image: "Downloading image",
      download_busy: "Download in progress",
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
      debug_info: "Get full test info",
      debug_info_copied: "Test info copied",
      debug_info_copied_detail: "Paste this information back with the issue description.",
      download_already_running: "A download is already running. Please wait.",
      advanced_section: "Developer options",
      profile_bulk_section: "Profile bulk download",
      profile_bulk_checkbox_size: "Profile selection checkbox size",
      tooltip_profile_bulk_checkbox_size: "Size of the bottom-right selection checkbox on profile video cards. Range: 18–40 px.",
      bulk_download: "Bulk download",
      bulk_download_selected: "Download selected",
      bulk_cancel_selection: "Cancel selection",
      bulk_confirm_title: "Confirm selected videos",
      bulk_start_download: "Start download",
      bulk_no_selection: "No videos selected.",
      bulk_selected_count: "Selected",
      bulk_type_video: "Video",
      bulk_type_album: "Album",
      bulk_type_unknown: "Unknown",
      bulk_downloading: "Bulk downloading",
      bulk_download_done: "Bulk download finished",
      bulk_download_result: "Success ${success}, failed ${failed}.",
      show_test_notification_menu: "Show notification test items",
      show_debug_info_menu: "Show test info item",
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
      download_preparing: "正在准备下载...",
      downloading: "正在下载",
      download_completed: "下载完成",
      preparing_video_download: "正在准备视频下载...",
      downloading_album: "正在下载图集",
      downloading_image: "正在下载图片",
      download_busy: "下载正在进行",
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
      debug_info: "获取完整测试信息",
      debug_info_copied: "测试信息已复制",
      debug_info_copied_detail: "请把这段信息和问题现象一起发回来。",
      download_already_running: "当前已有下载任务，请等待完成。",
      advanced_section: "开发者选项",
      profile_bulk_section: "个人主页批量下载",
      profile_bulk_checkbox_size: "个人页复选框大小",
      tooltip_profile_bulk_checkbox_size: "个人主页作品卡片右下角复选框的大小，范围：18–40 px。",
      bulk_download: "批量下载",
      bulk_download_selected: "下载选中",
      bulk_cancel_selection: "取消选择",
      bulk_confirm_title: "确认选中的作品",
      bulk_start_download: "开始下载",
      bulk_no_selection: "尚未选择作品。",
      bulk_selected_count: "已选择",
      bulk_type_video: "视频",
      bulk_type_album: "图集",
      bulk_type_unknown: "待识别",
      bulk_downloading: "批量下载中",
      bulk_download_done: "批量下载完成",
      bulk_download_result: "成功 ${success}，失败 ${failed}。",
      show_test_notification_menu: "显示通知测试菜单项",
      show_debug_info_menu: "显示获取测试信息菜单项",
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

  function normalizeConfigBoolean(value, fallback = false) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (value === undefined || value === null || value === "") return Boolean(fallback);
    const text = String(value).trim().toLowerCase();
    if (["false", "0", "no", "off"].includes(text)) return false;
    if (["true", "1", "yes", "on"].includes(text)) return true;
    return Boolean(fallback);
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
    next.profile_bulk_checkbox_size = clampNumber(
      Number(next.profile_bulk_checkbox_size),
      18,
      40,
      DEFAULT_CONFIG.profile_bulk_checkbox_size,
    );
    next.shortcut_download = normalizeHotkey(next.shortcut_download);
    next.shortcut_frame = normalizeHotkey(next.shortcut_frame);
    next.shortcut_details = normalizeHotkey(next.shortcut_details);
    next.shortcut_settings = normalizeHotkey(next.shortcut_settings);
    next.show_test_notification_menu = normalizeConfigBoolean(
      next.show_test_notification_menu,
      DEFAULT_CONFIG.show_test_notification_menu,
    );
    next.show_debug_info_menu = normalizeConfigBoolean(
      next.show_debug_info_menu,
      DEFAULT_CONFIG.show_debug_info_menu,
    );
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

  function compactLiveContextText(value = "") {
    return String(value || "").replace(/\s+/g, "").trim();
  }

  function isLikelyLiveContextText(actionText = "", contextText = "") {
    const compactAction = compactLiveContextText(actionText);
    const compactContext = compactLiveContextText(contextText);
    const combined = `${compactAction}${compactContext}`;
    if (!combined) return false;
    if (/(点击以观看直播|观看直播|直播中|正在直播|进入直播间|LIVE中)/i.test(combined)) {
      return true;
    }
    if (/^LIVE\d*$/i.test(compactAction)) return true;
    return /^LIVE\d{1,8}$/i.test(compactAction) && compactAction.length <= 16;
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

  function getResponseContentLength(headers) {
    const value = Number(headers?.get?.("content-length") || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function shouldInspectRuntimeResponse(url = "", contentType = "", contentLength = 0) {
    const textUrl = String(url || "");
    if (contentLength > RUNTIME_OBSERVER_MAX_TEXT_BYTES) return false;
    if (contentType && !RUNTIME_OBSERVER_CONTENT_TYPE_RE.test(contentType)) return false;
    if (RUNTIME_OBSERVER_URL_HINT_RE.test(textUrl)) return true;
    return RUNTIME_OBSERVER_CONTENT_TYPE_RE.test(contentType);
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
        return originalFetch.apply(win, args).then((response) => {
          try {
            const url = response?.url || String(args[0]?.url || args[0] || "");
            const contentType = response?.headers?.get?.("content-type") || "";
            const contentLength = getResponseContentLength(response?.headers);
            if (!shouldInspectRuntimeResponse(url, contentType, contentLength)) {
              return response;
            }
            response
              ?.clone?.()
              ?.text?.()
              ?.then((text) => {
                if (text.length > RUNTIME_OBSERVER_MAX_TEXT_BYTES) return;
                cache.ingestText(text, url);
              })
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
            const url = this.responseURL || this.__tkDlUrl || "";
            const contentType = this.getResponseHeader?.("content-type") || "";
            const contentLength = Number(this.getResponseHeader?.("content-length") || 0);
            if (!shouldInspectRuntimeResponse(url, contentType, contentLength)) return;

            const responseType = this.responseType || "";
            if (responseType && responseType !== "text" && responseType !== "json") return;
            if (responseType === "json") {
              cache.ingestJson(this.response, url);
              return;
            }

            const text = this.responseText || "";
            if (text.length > RUNTIME_OBSERVER_MAX_TEXT_BYTES) return;
            cache.ingestText(text, url);
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
    const safeDate =
      date instanceof Date && !Number.isNaN(date.getTime())
        ? date
        : new Date();
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

  function normalizeFileExtension(value = "mp4", fallback = "mp4") {
    const text = String(value || fallback || "")
      .trim()
      .toLowerCase()
      .replace(/^.*\//, "")
      .split(/[?#]/)[0]
      .replace(/^\.+/, "");
    return /^[a-z0-9]{2,5}$/.test(text) ? text : fallback;
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

    getImageElementUrl(image = null) {
      return String(image?.currentSrc || image?.src || image?.getAttribute?.("src") || "").trim();
    }

    isLikelyPhotoModeElement(image = null) {
      if (!image || String(image.tagName || "").toLowerCase() !== "img") return false;
      const src = this.getImageElementUrl(image);
      if (!src) return false;
      const signature = `${image.className || ""} ${image.parentElement?.className || ""} ${src}`;
      if (/ImgPhotoSlide|PhotoSlide|PhotoMode|photomode|tplv-photomode/i.test(signature)) return true;
      const rect = image.getBoundingClientRect?.();
      const viewportWidth = Number(this.window?.innerWidth || 0);
      const viewportHeight = Number(this.window?.innerHeight || 0);
      return Boolean(
        rect &&
          viewportWidth &&
          viewportHeight &&
          rect.width >= viewportWidth * 0.22 &&
          rect.height >= viewportHeight * 0.45 &&
          getVisibleRectRatio(rect, viewportWidth, viewportHeight) >= 0.28,
      );
    }

    getVisiblePhotoModeImages(primaryImage = null) {
      const context = this.getMediaContextElement(primaryImage) || this.document;
      const candidates = this.getImageMediaCandidates(context).filter((image) => {
        if (!image || String(image.tagName || "").toLowerCase() !== "img") return false;
        const src = this.getImageElementUrl(image);
        if (!src) return false;
        if (this.isLikelyPhotoModeElement(image)) return true;
        if (primaryImage && image.className === primaryImage.className) return true;
        return false;
      });
      if (primaryImage && !candidates.includes(primaryImage)) candidates.unshift(primaryImage);
      const seen = new Set();
      const result = [];
      for (const image of candidates) {
        const src = this.getImageElementUrl(image);
        if (!src || seen.has(src)) continue;
        seen.add(src);
        result.push(image);
      }
      return result;
    }

    getRawImagePostItems(dataCandidates = []) {
      const items = [];
      for (const data of dataCandidates) {
        for (const item of collectVideoItemsDeep(data)) {
          if (getImagePostPayload(item)) items.push(item);
        }
      }
      for (const entry of Array.from(this.runtimeCache?.items?.values?.() || [])) {
        if (getImagePostPayload(entry?.item)) items.push(entry.item);
      }
      const byId = new Map();
      for (const item of items) {
        const id = getVideoItemId(item) || JSON.stringify(item).slice(0, 80);
        if (!byId.has(id)) byId.set(id, item);
      }
      return [...byId.values()];
    }

    buildDomImagePostMedia(imageElements = [], pageUrl = "") {
      const images = imageElements
        .map((image, index) => {
          const url = this.getImageElementUrl(image);
          const rect = image.getBoundingClientRect?.();
          return {
            index: index + 1,
            url,
            fallbackUrls: [],
            width: Number(image.naturalWidth || rect?.width || 0),
            height: Number(image.naturalHeight || rect?.height || 0),
            size: 0,
          };
        })
        .filter((image) => image.url);
      if (!images.length) return null;
      const context = this.getMediaContextElement(imageElements[0]) || imageElements[0]?.parentElement || null;
      const contextText = String(context?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 240);
      const authorFromUrl = getAuthorFromUrl(pageUrl);
      const first = images[0];
      return {
        id: `photo_${toShortId(String(Date.now()))}`,
        desc: contextText,
        createTime: null,
        pageUrl,
        shareUrl: pageUrl,
        groupId: `photo_${first.url.slice(-32)}`,
        author: {
          id: "",
          uniqueId: authorFromUrl,
          secUid: "",
          nickname: authorFromUrl,
          avatarUrl: "",
          signature: "",
          verification: "",
          verified: false,
          followerCount: undefined,
          totalFavorited: undefined,
          profileUrl: authorFromUrl ? `https://www.tiktok.com/@${authorFromUrl}` : "",
        },
        video: {
          primaryUrl: "",
          fallbackUrls: [],
          primarySource: null,
          sources: [],
          width: 0,
          height: 0,
          duration: 0,
          format: "mp4",
          codec: "",
          fps: 0,
          quality: "",
          size: 0,
        },
        cover: {
          url: first.url,
          dynamicUrl: "",
          width: first.width,
          height: first.height,
        },
        music: { id: "", title: "", authorName: "", coverUrl: "", duration: 0, url: "" },
        isImagePost: true,
        images,
        hashtags: [],
        stats: {},
        permissions: {},
        raw: {
          source: "visible-photo-mode-dom-fallback",
          imageUrls: images.map((image) => image.url),
        },
      };
    }

    getVisibleImagePostMedia(visibleMediaElement = null, config = {}, pageUrl = "", dataCandidates = []) {
      if (!this.isLikelyPhotoModeElement(visibleMediaElement)) return null;
      const imageElements = this.getVisiblePhotoModeImages(visibleMediaElement);
      const imageUrls = unique(imageElements.map((image) => this.getImageElementUrl(image)).filter(Boolean));
      if (!imageUrls.length) return null;

      for (const item of this.getRawImagePostItems(dataCandidates)) {
        const itemPageUrl = getItemPageUrl(item, pageUrl);
        const media = normalizeMediaItem(item, itemPageUrl, config);
        if (!media?.isImagePost || !ensureArray(media.images).length) continue;
        if (urlsShareResource(imageUrls, getMediaResourceUrls(media))) return media;
      }

      return this.buildDomImagePostMedia(imageElements, pageUrl);
    }

    getCurrentMedia(config = {}, anchorElement = null, options = {}) {
      const pageUrl = this.window?.location?.href || "";
      const requireContext = Boolean(options.requireContext);
      const anchorContext = this.getMediaContextElement(anchorElement);
      const contextMediaElement = anchorContext ? this.getContextMediaElement(anchorContext) : null;
      const contextVideo = anchorContext ? this.getContextVideoElement(anchorContext) : null;
      const visibleMediaElement = contextMediaElement || this.getVisibleMediaElement();
      const visibleVideo = contextVideo || this.getVisibleVideoElement();
      const visibleMediaIsVideo = String(visibleMediaElement?.tagName || "").toLowerCase() === "video";
      const matchVideoElement = visibleMediaIsVideo ? visibleMediaElement : contextVideo;
      const visibleContext =
        this.getMediaContextElement(visibleMediaElement) ||
        this.getMediaContextElement(visibleVideo);
      const contextUrls = anchorContext
        ? this.getMediaUrlsFromScopes([anchorContext])
        : this.getVisibleMediaContextUrls(visibleMediaElement || visibleVideo);
      const contextText = unique([
        anchorContext?.textContent || "",
        visibleContext?.textContent || "",
        visibleMediaElement?.parentElement?.textContent || "",
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

      const visibleImagePostMedia = this.getVisibleImagePostMedia(
        visibleMediaElement,
        config,
        pageUrl,
        dataCandidates,
      );
      if (hasUsableMedia(visibleImagePostMedia)) return visibleImagePostMedia;

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
        matchVideoElement,
        contextText,
        config,
        pageUrl,
      );
      if (hasUsableMedia(cachedVisibleMedia)) return cachedVisibleMedia;

      for (const data of dataCandidates) {
        const items = collectVideoItemsDeep(data);
        if (!items.length) continue;
        const fuzzyDataMedia = findBestMediaMatch(items, matchVideoElement, contextText, config, pageUrl);
        if (hasUsableMedia(fuzzyDataMedia)) return fuzzyDataMedia;
      }

      const currentPageId = getVideoIdFromUrl(pageUrl);
      if (matchVideoElement && currentPageId && contextUrls.length === 0) {
        for (const data of dataCandidates) {
          const dataMedia = extractMediaFromPageData(data, pageUrl, config);
          if (hasUsableMedia(dataMedia)) return dataMedia;
        }

        const cachedPageMedia = this.runtimeCache?.getMedia(pageUrl, config);
        if (hasUsableMedia(cachedPageMedia)) return cachedPageMedia;
      }

      if (anchorContext) {
        return extractMediaFromVideoElement(matchVideoElement, contextUrls[0] || "") || null;
      }

      if (requireContext) {
        return extractMediaFromVideoElement(matchVideoElement, contextUrls[0] || "") || null;
      }

      if (allowPageFallback) {
        for (const data of dataCandidates) {
          const dataMedia = extractMediaFromPageData(data, pageUrl, config);
          if (hasUsableMedia(dataMedia)) return dataMedia;
        }

        const cachedMedia = this.runtimeCache?.getMedia(pageUrl, config);
        if (hasUsableMedia(cachedMedia)) return cachedMedia;
      }

      return extractMediaFromVideoElement(matchVideoElement, pageUrl);
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

    getContextMediaElement(context = null) {
      if (!context) return null;
      const mediaElements = [
        ...Array.from(context.querySelectorAll?.("video") || []),
        ...this.getImageMediaCandidates(context),
      ];
      return this.selectBestMediaElement(mediaElements);
    }

    getVisibleVideoElement() {
      const videos = Array.from(this.document?.querySelectorAll?.("video") || []);
      return this.selectBestVideoElement(videos);
    }

    getVisibleMediaElement() {
      const mediaElements = [
        ...Array.from(this.document?.querySelectorAll?.("video") || []),
        ...this.getImageMediaCandidates(this.document),
      ];
      return this.selectBestMediaElement(mediaElements);
    }

    getImageMediaCandidates(scope = this.document) {
      return Array.from(scope?.querySelectorAll?.("img") || []).filter((image) => {
        if (!image || image.closest?.(`.${SCRIPT_PREFIX}-panel`)) return false;
        const src = image.currentSrc || image.src || image.getAttribute?.("src") || "";
        if (!src || src.startsWith("data:")) return false;
        const rect = image.getBoundingClientRect?.();
        if (!rect || rect.width < 160 || rect.height < 160) return false;
        const viewportWidth = Number(this.window?.innerWidth || 0);
        const viewportHeight = Number(this.window?.innerHeight || 0);
        if (viewportWidth && viewportHeight && getVisibleRectRatio(rect, viewportWidth, viewportHeight) < 0.08) {
          return false;
        }
        const signature = `${image.alt || ""} ${image.className || ""} ${image.parentElement?.className || ""}`;
        if (/(avatar|profile|music|icon|logo|emoji|comment)/i.test(signature)) return false;
        return true;
      });
    }

    selectBestVideoElement(videos = []) {
      return this.selectBestMediaElement(videos);
    }

    selectBestMediaElement(elements = []) {
      const viewportWidth = Number(this.window?.innerWidth || 0);
      const viewportHeight = Number(this.window?.innerHeight || 0);
      const scored = elements
        .filter(Boolean)
        .map((element) => ({
          element,
          rect: element.getBoundingClientRect?.(),
        }))
        .map((entry) => ({
          ...entry,
          score: scoreMediaElementRect(entry.rect, viewportWidth, viewportHeight),
        }))
        .filter((entry) => Number.isFinite(entry.score))
        .sort((left, right) => right.score - left.score);
      if (scored[0]) return scored[0].element;

      return (
        elements
          .filter(Boolean)
          .filter((element) => {
            const rect = element.getBoundingClientRect?.();
            return rect && rect.width > 80 && rect.height > 80;
          })
          .sort((left, right) => {
            const leftRect = left.getBoundingClientRect();
            const rightRect = right.getBoundingClientRect();
            return rightRect.width * rightRect.height - leftRect.width * leftRect.height;
          })[0] || elements[0] || null
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

    getVisibleMediaContextUrls(mediaElement = this.getVisibleMediaElement()) {
      const scopes = [];
      const addScope = (scope) => {
        if (scope && !scopes.includes(scope)) scopes.push(scope);
      };
      addScope(this.getMediaContextElement(mediaElement));
      addScope(mediaElement?.parentElement);
      return this.getMediaUrlsFromScopes(scopes);
    }

    getVisibleVideoContextUrls(video = this.getVisibleVideoElement()) {
      return this.getVisibleMediaContextUrls(video);
    }
  }

  class Downloader {
    constructor(win, gmRequest = null, gmDownloadFn = null) {
      this.window = win;
      this.gmRequest = gmRequest;
      this.gmDownload = gmDownloadFn;
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

    downloadWithGm(url, filename, headers = {}) {
      if (typeof this.gmDownload !== "function") {
        return Promise.reject(new Error("GM_download unavailable"));
      }

      return new Promise((resolve, reject) => {
        try {
          this.gmDownload({
            url,
            name: filename,
            headers: normalizeHeaders(headers),
            saveAs: false,
            onload: () => resolve(true),
            onerror: (error) => reject(error?.error ? new Error(error.error) : error),
            ontimeout: () => reject(new Error("Download timeout")),
          });
        } catch (err) {
          reject(err);
        }
      });
    }

    async downloadUrl(urls, filename, headers = {}) {
      let lastError = null;
      const allUrls = unique(ensureArray(urls))
        .map((url) => {
          try {
            return normalizeSafeDownloadUrl(
              url,
              this.window.location?.href || "https://www.tiktok.com/",
            );
          } catch (err) {
            lastError = err;
            return "";
          }
        })
        .filter(Boolean);

      if (!allUrls.length) {
        throw lastError || new Error("No safe download URL");
      }

      for (const url of allUrls) {
        try {
          await this.downloadWithGm(url, filename, headers);
          return true;
        } catch (err) {
          lastError = err;
        }

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

  function createDownloadSpinner(doc) {
    const ns = "http://www.w3.org/2000/svg";
    const wrapper = createElement(doc, "span", `${SCRIPT_PREFIX}-download-status-spinner`);
    wrapper.setAttribute("aria-hidden", "true");

    const svg = doc.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("focusable", "false");

    const ring = doc.createElementNS(ns, "circle");
    ring.setAttribute("class", `${SCRIPT_PREFIX}-spinner-ring`);
    ring.setAttribute("cx", "12");
    ring.setAttribute("cy", "12");
    ring.setAttribute("r", "9");

    const arrow = doc.createElementNS(ns, "path");
    arrow.setAttribute("class", `${SCRIPT_PREFIX}-spinner-arrow`);
    arrow.setAttribute("d", "M12 5.5v8.2m0 0 3.4-3.4M12 13.7l-3.4-3.4M7.4 18.4h9.2");

    svg.append(ring, arrow);
    wrapper.appendChild(svg);
    return wrapper;
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
    const navigationGapValue = Number(options.navigationGap);
    const navigationGap = Number.isFinite(navigationGapValue)
      ? navigationGapValue
      : Math.max(gap, 16);
    const margin = Number(options.margin || 8);
    const viewportWidth = Number(options.viewportWidth || 0);
    const viewportHeight = Number(options.viewportHeight || 0);
    const anchor = options.anchorRect;
    if (!anchor) {
      return calculatePanelPosition({ buttonSize, gap, margin, viewportWidth, viewportHeight });
    }
    const maxLeft = Math.max(margin, viewportWidth - buttonSize - margin);
    const maxTop = Math.max(margin, viewportHeight - buttonSize - margin);
    if (options.navigationRect) {
      const navigationEdges = getRectEdges(options.navigationRect);
      const left = Math.min(
        Math.max(margin, Math.round(navigationEdges.centerX - buttonSize / 2)),
        maxLeft,
      );
      let top = Math.round(navigationEdges.top - buttonSize - navigationGap);
      if (top < margin) {
        const belowTop = Math.round(navigationEdges.bottom + navigationGap);
        if (belowTop + buttonSize <= maxTop) {
          top = belowTop;
        }
      }
      return {
        left,
        top: Math.min(Math.max(margin, top), maxTop),
      };
    }

    const edges = getRectEdges(anchor);
    let left = Math.min(Math.max(margin, Math.round(edges.centerX - buttonSize / 2)), maxLeft);
    const previousEdges = options.previousRect ? getRectEdges(options.previousRect) : null;
    const previousGroupEdges = options.previousGroupRect
      ? getRectEdges(options.previousGroupRect)
      : previousEdges;
    const nextEdges = options.nextRect ? getRectEdges(options.nextRect) : null;
    let top = Math.round(edges.top - buttonSize - gap);
    if (previousEdges && top < previousEdges.bottom + Math.min(gap, 4)) {
      const betweenGap = edges.top - previousGroupEdges.bottom;
      let placed = false;
      if (betweenGap >= buttonSize) {
        top = Math.round(previousGroupEdges.bottom + (betweenGap - buttonSize) / 2);
        placed = true;
      } else if (options.previousGroupRect) {
        const abovePreviousTop = Math.round(previousGroupEdges.top - buttonSize - gap);
        if (abovePreviousTop >= margin) {
          left = Math.min(
            Math.max(margin, Math.round(previousGroupEdges.centerX - buttonSize / 2)),
            maxLeft,
          );
          top = abovePreviousTop;
          placed = true;
        }
      }
      if (!placed && nextEdges) {
        const betweenGap = nextEdges.top - edges.bottom;
        if (betweenGap >= buttonSize) {
          top = Math.round(edges.bottom + (betweenGap - buttonSize) / 2);
          placed = true;
        }
      }
      if (!placed) {
        const sideTop = Math.round(edges.centerY - buttonSize / 2);
        const leftSlot = Math.round(edges.left - buttonSize - gap);
        const rightSlot = Math.round(edges.right + gap);
        if (leftSlot >= margin) {
          left = leftSlot;
          top = sideTop;
        } else if (rightSlot <= maxLeft) {
          left = rightSlot;
          top = sideTop;
        }
      }
    } else if (top < margin && nextEdges) {
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
      return { placement: "right", left: margin, top: margin };
    }

    const edges = getRectEdges(anchorRect);
    const maxLeft = Math.max(margin, viewportWidth - menuWidth - margin);
    const maxTop = Math.max(margin, viewportHeight - menuHeight - margin);
    const centeredTop = clampNumber(
      Math.round(edges.top + edges.height / 2 - menuHeight / 2),
      margin,
      maxTop,
    );

    if (edges.right + gap + menuWidth <= viewportWidth - margin) {
      return {
        placement: "right",
        left: Math.round(edges.right + gap),
        top: centeredTop,
      };
    }

    const centeredLeft = clampNumber(
      Math.round(edges.left + edges.width / 2 - menuWidth / 2),
      margin,
      maxLeft,
    );

    if (edges.top - gap - menuHeight >= margin) {
      return {
        placement: "top",
        left: centeredLeft,
        top: Math.round(edges.top - menuHeight - gap),
      };
    }

    if (edges.left - gap - menuWidth >= margin) {
      return {
        placement: "left",
        left: Math.round(edges.left - menuWidth - gap),
        top: centeredTop,
      };
    }

    const bottomTop = Math.round(edges.bottom + gap);
    if (bottomTop + menuHeight <= viewportHeight - margin) {
      return {
        placement: "bottom",
        left: centeredLeft,
        top: bottomTop,
      };
    }

    return {
      placement: "bottom",
      left: centeredLeft,
      top: clampNumber(bottomTop, margin, maxTop),
    };
  }

  const RECOMMEND_ACTION_BAR_SELECTOR = [
    'section[class*="SectionActionBarContainer"]',
    '[class*="SectionActionBarContainer"]',
    'section[class*="ActionBarContainer"]',
    '[class*="ActionBarContainer"]',
  ].join(",");

  const RECOMMEND_ACTION_METRIC_SELECTOR =
    '[data-e2e="like-icon"], [data-e2e="comment-icon"], [data-e2e="favorite-icon"], [data-e2e="share-icon"]';

  const PROFILE_BROWSE_DIALOG_SELECTOR = '[role="dialog"], [aria-modal="true"]';
  const PROFILE_BROWSE_ELLIPSIS_SELECTOR = '[data-e2e="browse-ellipsis"]';
  const PROFILE_BROWSE_MEDIA_SELECTOR = '[data-e2e="browse-video"], video, img';

  function isActionBarClassName(className = "") {
    const value = String(className || "");
    return /ActionBarContainer/i.test(value) && !/FeedNavigation|NavigationContainer/i.test(value);
  }

  function hasVisibleRecommendFeedActionBar(doc = root?.document) {
    const win = doc?.defaultView || root;
    const viewportWidth = Number(win?.innerWidth || 0);
    const viewportHeight = Number(win?.innerHeight || 0);
    if (!doc?.querySelectorAll || !viewportWidth || !viewportHeight) return false;
    return Array.from(
      doc.querySelectorAll(RECOMMEND_ACTION_BAR_SELECTOR),
    ).some((section) => {
      if (!section || !isActionBarClassName(section.className)) return false;
      const rect = section.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) return false;
      if (getVisibleRectRatio(rect, viewportWidth, viewportHeight) < 0.45) return false;
      return Boolean(
        section.querySelector?.(RECOMMEND_ACTION_METRIC_SELECTOR),
      );
    });
  }

  function isVisibleProfileBrowseDialog(dialog = null, win = root) {
    if (!dialog?.querySelector) return false;
    const rect = dialog.getBoundingClientRect?.();
    const viewportWidth = Number(win?.innerWidth || 0);
    const viewportHeight = Number(win?.innerHeight || 0);
    if (!rect || !viewportWidth || !viewportHeight) return false;
    if (rect.width < 280 || rect.height < 280) return false;
    if (getVisibleRectRatio(rect, viewportWidth, viewportHeight) < 0.55) return false;
    const ellipsis = dialog.querySelector(PROFILE_BROWSE_ELLIPSIS_SELECTOR);
    if (!ellipsis) return false;
    const ellipsisRect = ellipsis.getBoundingClientRect?.();
    if (!ellipsisRect || ellipsisRect.width < 24 || ellipsisRect.height < 24) return false;
    if (getVisibleRectRatio(ellipsisRect, viewportWidth, viewportHeight) < 0.5) return false;
    return Boolean(dialog.querySelector(PROFILE_BROWSE_MEDIA_SELECTOR));
  }

  function getVisibleProfileBrowseDialog(doc = root?.document) {
    const win = doc?.defaultView || root;
    if (!doc?.querySelectorAll) return null;
    const dialogs = Array.from(doc.querySelectorAll(PROFILE_BROWSE_DIALOG_SELECTOR))
      .filter((dialog) => isVisibleProfileBrowseDialog(dialog, win))
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect?.();
        const rightRect = right.getBoundingClientRect?.();
        const leftArea = (leftRect?.width || 0) * (leftRect?.height || 0);
        const rightArea = (rightRect?.width || 0) * (rightRect?.height || 0);
        return rightArea - leftArea;
      });
    return dialogs[0] || null;
  }

  function hasVisibleProfileBrowseDialog(doc = root?.document) {
    return Boolean(getVisibleProfileBrowseDialog(doc));
  }

  function getTikTokPageType(locationLike = root?.location, doc = root?.document) {
    const rawPath = String(locationLike?.pathname || "/");
    const pathname = rawPath.replace(/\/+$/, "") || "/";
    if (/^\/(?:explore|messages|upload|following|friends)(?:\/|$)/i.test(pathname)) return "explore";
    if (/^\/live(?:\/|$)/i.test(pathname)) return "live";
    if (pathname === "/" || /^\/(?:foryou|feed|recommend)(?:\/|$)/i.test(pathname)) {
      return "recommend";
    }
    if (hasVisibleRecommendFeedActionBar(doc)) return "recommend";
    if (hasVisibleProfileBrowseDialog(doc)) return "profile-dialog";
    if (/^\/@[^/]+\/(?:video|photo)\/\d+/i.test(pathname) || /^\/(?:video|photo)\//i.test(pathname)) {
      return "detail";
    }
    if (/^\/@[^/]+(?:\/|$)/.test(pathname)) return "profile";
    const hasRecommendFeed = Boolean(
      doc?.querySelector?.('article[data-e2e="recommend-list-item-container"], [data-e2e="recommend-list-item-container"]'),
    );
    if (hasRecommendFeed) return "recommend";
    return "unknown";
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

  function getBoundingRect(rects = []) {
    const usableRects = rects.filter(Boolean);
    if (!usableRects.length) return null;
    const box = usableRects.reduce(
      (current, rect) => ({
        left: Math.min(current.left, rect.left),
        top: Math.min(current.top, rect.top),
        right: Math.max(current.right, rect.right),
        bottom: Math.max(current.bottom, rect.bottom),
      }),
      { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
    );
    const width = box.right - box.left;
    const height = box.bottom - box.top;
    return {
      element: usableRects[0].element || null,
      left: box.left,
      top: box.top,
      right: box.right,
      bottom: box.bottom,
      width,
      height,
      centerX: box.left + width / 2,
      centerY: box.top + height / 2,
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

  function getNativeActionVisualControl(element) {
    if (!element) return null;
    const candidates = Array.from(element.querySelectorAll?.("button,[role='button'],a") || []);
    if (element.matches?.("button,[role='button'],a")) candidates.unshift(element);
    let best = null;
    let bestScore = -Infinity;
    for (const candidate of candidates) {
      const rect = candidate?.getBoundingClientRect?.();
      if (!rect || rect.width < 34 || rect.height < 34) continue;
      const size = Math.max(rect.width, rect.height);
      const squarePenalty = Math.abs(rect.width - rect.height);
      const sizePenalty = Math.abs(size - 48);
      const tagBonus = candidate.tagName === "BUTTON" ? 18 : 0;
      const classBonus = /tux-button|button/i.test(String(candidate.className || "")) ? 8 : 0;
      const oversizedPenalty = size > 64 ? 80 : 0;
      const score = 120 - squarePenalty * 4 - sizePenalty + tagBonus + classBonus - oversizedPenalty;
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return best || getNativeActionControl(element);
  }


  function getOfficialActionButtonCandidate(element) {
    if (!element) return null;
    const candidates = Array.from(element.querySelectorAll?.("button,[role='button'],a") || []);
    if (element.matches?.("button,[role='button'],a")) candidates.unshift(element);
    return (
      candidates.find((candidate) => /(?:^|\s)tux-button__element|TUX|tux-button/i.test(String(candidate.className || ""))) ||
      getNativeActionVisualControl(element)
    );
  }

  function isOfficialActionMetricElement(element) {
    const value = String(element?.getAttribute?.("data-e2e") || "");
    return /^(like|comment|favorite|share)-icon$/i.test(value);
  }

  function getOfficialActionMetricElement(child) {
    if (!child) return null;
    if (isOfficialActionMetricElement(child)) return child;
    return (
      child.querySelector?.(RECOMMEND_ACTION_METRIC_SELECTOR) ||
      null
    );
  }

  function getBestSquareMetricElement(root) {
    if (!root) return null;
    const candidates = [];
    if (root.matches?.("button,[role='button'],a,span,div")) candidates.push(root);
    candidates.push(...Array.from(root.querySelectorAll?.("span,button,[role='button'],a,svg,div") || []));
    let best = null;
    let bestScore = -Infinity;
    for (const candidate of candidates) {
      const rect = candidate?.getBoundingClientRect?.();
      if (!rect || rect.width < 20 || rect.height < 20 || rect.width > 80 || rect.height > 80) continue;
      const size = Math.max(rect.width, rect.height);
      const squarePenalty = Math.abs(rect.width - rect.height) * 8;
      const className = String(candidate.className || "");
      const spanBonus = candidate.tagName === "SPAN" ? 24 : 0;
      const buttonBonus = candidate.tagName === "BUTTON" ? 16 : 0;
      const iconBonus = /icon|tux|button/i.test(className) ? 20 : 0;
      const svgPenalty = candidate.tagName === "svg" ? 18 : 0;
      const actionItemPenalty = candidate.getAttribute?.("data-e2e") ? 24 : 0;
      const score = 140 + spanBonus + buttonBonus + iconBonus - svgPenalty - actionItemPenalty - squarePenalty - Math.abs(size - 40) * 0.6;
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return best;
  }

  function clampNumber(value, min, max, fallback = min) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
  }


  function mergeClassNames(...values) {
    const result = [];
    const seen = new Set();
    for (const value of values) {
      for (const token of String(value || "").split(/\s+/).filter(Boolean)) {
        if (seen.has(token)) continue;
        seen.add(token);
        result.push(token);
      }
    }
    return result.join(" ");
  }

  const ACTION_BUTTON_VISUAL_SELECTOR =
    '[data-testid*="icon-button-container" i],[class*="tux-button--capsule" i],[class*="tux-button-rFq4rS" i]';

  function appendUniqueElement(elements, element) {
    if (element && !elements.includes(element)) elements.push(element);
  }

  function getActionButtonVisualElement(element) {
    if (!element) return null;
    if (element.matches?.(ACTION_BUTTON_VISUAL_SELECTOR)) return element;
    return (
      element.querySelector?.(ACTION_BUTTON_VISUAL_SELECTOR) ||
      element.closest?.(ACTION_BUTTON_VISUAL_SELECTOR) ||
      null
    );
  }

  function collectElementActionStyleCandidates(elements = []) {
    const candidates = [];
    for (const element of elements) {
      if (!element) continue;
      appendUniqueElement(candidates, element);
      appendUniqueElement(candidates, getActionButtonVisualElement(element));
      const control = getNativeActionControl(element);
      appendUniqueElement(candidates, control);
      appendUniqueElement(candidates, getActionButtonVisualElement(control));
      appendUniqueElement(candidates, element.parentElement);
      appendUniqueElement(candidates, control?.parentElement);
    }
    return candidates;
  }

  function getStyleValue(style, names = []) {
    for (const name of names) {
      const direct = style?.[name];
      if (direct) return direct;
      const cssValue = style?.getPropertyValue?.(name);
      if (cssValue) return cssValue;
    }
    return "";
  }

  function getElementActionStyleSample(win, elements = []) {
    const candidates = collectElementActionStyleCandidates(elements);

    let fallbackSample = null;
    for (const element of candidates) {
      const style = getComputedStyleSafe(win, element);
      if (!style) continue;
      const parentStyle = getComputedStyleSafe(win, element.parentElement);
      const rawBackground = getStyleValue(style, ["backgroundColor", "background-color"]);
      const parentBackground = getStyleValue(parentStyle, ["backgroundColor", "background-color"]);
      const backgroundColor = isTransparentColor(rawBackground) ? parentBackground : rawBackground;
      const color =
        getStyleValue(style, ["color"]) ||
        getStyleValue(parentStyle, ["color"]);
      const borderRadius =
        getStyleValue(style, ["borderRadius", "border-radius"]) ||
        getStyleValue(parentStyle, ["borderRadius", "border-radius"]);
      const backdropFilter =
        getStyleValue(style, ["backdropFilter", "backdrop-filter", "webkitBackdropFilter", "-webkit-backdrop-filter"]) ||
        getStyleValue(parentStyle, ["backdropFilter", "backdrop-filter", "webkitBackdropFilter", "-webkit-backdrop-filter"]);
      if (backgroundColor || color || borderRadius || backdropFilter) {
        const sample = { backgroundColor, color, borderRadius, backdropFilter };
        if (backgroundColor && !isTransparentColor(backgroundColor)) return sample;
        if (!fallbackSample) fallbackSample = sample;
      }
    }
    return fallbackSample;
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
    if (isTransparentColor(backgroundColor)) {
      const foreground = color || "rgba(255, 255, 255, 0.9)";
      const lightForeground = isLightColor(foreground);
      return {
        background: lightForeground ? "hsla(0, 0%, 100%, 0.13)" : "rgba(22, 24, 35, 0.08)",
        color: foreground,
        hoverBackground: lightForeground ? "hsla(0, 0%, 100%, 0.19)" : "rgba(22, 24, 35, 0.12)",
      };
    }
    const background = String(backgroundColor);
    const light = isLightColor(background);
    return {
      background,
      color: color || (light ? "rgb(22, 24, 35)" : "rgb(255, 255, 255)"),
      hoverBackground: light ? "rgb(232, 232, 232)" : "rgb(47, 47, 47)",
    };
  }
  function getPanelStyleSheet() {
    return `
        .${SCRIPT_PREFIX}-panel {
          position: fixed;
          right: 18px;
          top: 25vh;
          bottom: auto;
          left: auto;
          z-index: 2147483200;
          width: 48px;
          height: 48px;
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
          position: relative;
          left: auto !important;
          right: auto !important;
          top: auto !important;
          bottom: auto !important;
          z-index: 2147483200;
          flex: 0 0 var(--${SCRIPT_PREFIX}-action-item-height, 78px);
          width: var(--${SCRIPT_PREFIX}-action-item-width, var(--${SCRIPT_PREFIX}-action-size, 48px));
          height: var(--${SCRIPT_PREFIX}-action-item-height, 78px);
          margin: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: auto;
          contain: layout style;
          overflow: visible;
          isolation: isolate;
        }
        .${SCRIPT_PREFIX}-panel.profile-dialog {
          position: fixed;
          z-index: 2147483200;
          width: var(--${SCRIPT_PREFIX}-action-size, 40px);
          height: var(--${SCRIPT_PREFIX}-action-size, 40px);
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: auto;
          contain: layout style;
          overflow: visible;
          isolation: isolate;
        }
        .${SCRIPT_PREFIX}-launcher-shell {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          width: 48px;
          height: 48px;
          padding: 0;
          color: rgba(255, 255, 255, 0.9);
          box-sizing: border-box;
        }
        .${SCRIPT_PREFIX}-launcher-icon-wrapper {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 48px;
          height: 48px;
          color: inherit;
          box-sizing: border-box;
          line-height: 0;
        }
        .${SCRIPT_PREFIX}-launcher-container {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 48px;
          height: 48px;
          overflow: hidden;
          border-radius: var(--tux-v2-radius-control-capsule, 9999px);
          border: 0;
          box-shadow: none;
          box-sizing: border-box;
          transition: background 0.12s ease, opacity 0.12s ease;
        }
        .${SCRIPT_PREFIX}-launcher {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 48px;
          height: 48px;
          border-radius: 0;
          border: 0;
          padding: 0;
          color: inherit;
          background: transparent;
          box-sizing: border-box;
          line-height: 0;
        }
        .${SCRIPT_PREFIX}-panel.embedded .${SCRIPT_PREFIX}-launcher-shell {
          width: var(--${SCRIPT_PREFIX}-action-size, 48px);
          height: var(--${SCRIPT_PREFIX}-action-item-height, 78px);
          align-items: center;
          justify-content: center;
        }
        .${SCRIPT_PREFIX}-panel.embedded .${SCRIPT_PREFIX}-launcher-icon-wrapper,
        .${SCRIPT_PREFIX}-panel.embedded .${SCRIPT_PREFIX}-launcher-container,
        .${SCRIPT_PREFIX}-panel.embedded .${SCRIPT_PREFIX}-launcher {
          flex: 0 0 auto;
          width: var(--${SCRIPT_PREFIX}-action-size, 48px);
          height: var(--${SCRIPT_PREFIX}-action-size, 48px);
        }
        .${SCRIPT_PREFIX}-panel.embedded .${SCRIPT_PREFIX}-launcher-container {
          border-radius: var(--${SCRIPT_PREFIX}-action-radius, var(--tux-v2-radius-control-capsule, 9999px));
          border: 0;
          color: var(--${SCRIPT_PREFIX}-action-color, var(--tux-colorTextPrimary, rgba(255, 255, 255, 0.9)));
          background: var(--${SCRIPT_PREFIX}-action-bg, var(--ui-shape-neutral-4, hsla(0, 0%, 100%, 0.13)));
          -webkit-backdrop-filter: var(--${SCRIPT_PREFIX}-action-backdrop-filter, none);
          backdrop-filter: var(--${SCRIPT_PREFIX}-action-backdrop-filter, none);
          box-shadow: none;
        }
        .${SCRIPT_PREFIX}-panel.embedded.light .${SCRIPT_PREFIX}-launcher-container {
          color: var(--${SCRIPT_PREFIX}-action-color, var(--tux-colorTextPrimary, rgba(255, 255, 255, 0.9)));
          background: var(--${SCRIPT_PREFIX}-action-bg, var(--ui-shape-neutral-4, hsla(0, 0%, 100%, 0.13)));
        }
        .${SCRIPT_PREFIX}-launcher-shell:hover .${SCRIPT_PREFIX}-launcher-container:not(.${SCRIPT_PREFIX}-profile-official-skin),
        .${SCRIPT_PREFIX}-panel.open .${SCRIPT_PREFIX}-launcher-container:not(.${SCRIPT_PREFIX}-profile-official-skin) {
          background: var(--ui-shape-neutral-3, hsla(0, 0%, 100%, 0.19));
          color: var(--tux-colorTextPrimary, rgba(255, 255, 255, 0.9));
          transform: none;
        }
        .${SCRIPT_PREFIX}-panel.embedded .${SCRIPT_PREFIX}-launcher-shell:hover .${SCRIPT_PREFIX}-launcher-container,
        .${SCRIPT_PREFIX}-panel.embedded.open .${SCRIPT_PREFIX}-launcher-container {
          color: var(--${SCRIPT_PREFIX}-action-color, var(--tux-colorTextPrimary, rgba(255, 255, 255, 0.9)));
          background: var(--${SCRIPT_PREFIX}-action-hover-bg, var(--ui-shape-neutral-3, hsla(0, 0%, 100%, 0.19)));
          transform: none;
        }
        .${SCRIPT_PREFIX}-launcher svg {
          display: block;
          width: var(--${SCRIPT_PREFIX}-action-icon-size, 24px);
          height: var(--${SCRIPT_PREFIX}-action-icon-size, 24px);
          pointer-events: none;
          transform: translateY(var(--${SCRIPT_PREFIX}-action-icon-offset-y, -1px));
          transform-origin: center;
          overflow: visible;
        }
        .${SCRIPT_PREFIX}-panel.embedded .${SCRIPT_PREFIX}-launcher {
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          cursor: pointer;
          touch-action: manipulation;
          padding: var(--${SCRIPT_PREFIX}-action-button-padding, 0);
          border-radius: var(--${SCRIPT_PREFIX}-action-button-radius, 0);
          background: var(--${SCRIPT_PREFIX}-action-button-bg, transparent);
          font: inherit;
          line-height: 0 !important;
          text-align: center;
        }
        .${SCRIPT_PREFIX}-panel.embedded .${SCRIPT_PREFIX}-launcher svg {
          flex: 0 0 auto;
          width: var(--${SCRIPT_PREFIX}-action-icon-size, 24px);
          height: var(--${SCRIPT_PREFIX}-action-icon-size, 24px);
          margin: 0 auto;
          transform: none;
        }
        .${SCRIPT_PREFIX}-panel.profile-dialog .${SCRIPT_PREFIX}-launcher-shell,
        .${SCRIPT_PREFIX}-panel.profile-dialog .${SCRIPT_PREFIX}-launcher-icon-wrapper,
        .${SCRIPT_PREFIX}-panel.profile-dialog .${SCRIPT_PREFIX}-launcher-container,
        .${SCRIPT_PREFIX}-panel.profile-dialog .${SCRIPT_PREFIX}-launcher {
          flex: 0 0 auto;
          width: var(--${SCRIPT_PREFIX}-action-size, 40px);
          height: var(--${SCRIPT_PREFIX}-action-size, 40px);
        }
        .${SCRIPT_PREFIX}-panel.profile-dialog .${SCRIPT_PREFIX}-launcher-shell,
        .${SCRIPT_PREFIX}-panel.profile-dialog .${SCRIPT_PREFIX}-launcher-icon-wrapper,
        .${SCRIPT_PREFIX}-panel.profile-dialog .${SCRIPT_PREFIX}-launcher-container,
        .${SCRIPT_PREFIX}-panel.profile-dialog .${SCRIPT_PREFIX}-launcher {
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
        }
        .${SCRIPT_PREFIX}-panel.profile-dialog .${SCRIPT_PREFIX}-launcher-container:not(.${SCRIPT_PREFIX}-profile-official-skin) {
          border-radius: var(--${SCRIPT_PREFIX}-action-radius, 9999px);
          color: var(--${SCRIPT_PREFIX}-action-color, rgb(246, 246, 246));
          background: var(--${SCRIPT_PREFIX}-action-bg, transparent);
          -webkit-backdrop-filter: var(--${SCRIPT_PREFIX}-action-backdrop-filter, none);
          backdrop-filter: var(--${SCRIPT_PREFIX}-action-backdrop-filter, none);
        }
        .${SCRIPT_PREFIX}-panel.profile-dialog .${SCRIPT_PREFIX}-launcher-container.${SCRIPT_PREFIX}-profile-official-skin {
          position: static !important;
          left: auto !important;
          right: auto !important;
          top: auto !important;
          bottom: auto !important;
          margin: 0 !important;
          padding: 0 !important;
          width: var(--${SCRIPT_PREFIX}-action-size, 40px) !important;
          height: var(--${SCRIPT_PREFIX}-action-size, 40px) !important;
        }
        .${SCRIPT_PREFIX}-panel.profile-dialog .${SCRIPT_PREFIX}-launcher-shell:hover .${SCRIPT_PREFIX}-launcher-container:not(.${SCRIPT_PREFIX}-profile-official-skin),
        .${SCRIPT_PREFIX}-panel.profile-dialog.open .${SCRIPT_PREFIX}-launcher-container:not(.${SCRIPT_PREFIX}-profile-official-skin) {
          color: var(--${SCRIPT_PREFIX}-action-color, rgb(246, 246, 246));
          background: var(--${SCRIPT_PREFIX}-action-hover-bg, rgba(255, 255, 255, 0.08));
        }
        .${SCRIPT_PREFIX}-panel.profile-dialog .${SCRIPT_PREFIX}-launcher {
          cursor: pointer;
          touch-action: manipulation;
          padding: 0;
          border-radius: 0;
          background: transparent;
          line-height: 0 !important;
        }
        .${SCRIPT_PREFIX}-panel.profile-dialog .${SCRIPT_PREFIX}-launcher svg {
          flex: 0 0 auto;
          width: var(--${SCRIPT_PREFIX}-action-icon-size, 22px);
          height: var(--${SCRIPT_PREFIX}-action-icon-size, 22px);
          margin: 0 auto;
          transform: none;
        }
        .${SCRIPT_PREFIX}-profile-bulk-wrap {
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          flex: 0 0 auto;
          box-sizing: border-box;
        }
        .${SCRIPT_PREFIX}-profile-bulk-button {
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          width: 100% !important;
          height: 100% !important;
          padding: 0 !important;
          line-height: 0 !important;
          cursor: pointer;
          color: inherit;
          background: transparent !important;
        }
        .${SCRIPT_PREFIX}-profile-bulk-wrap:hover,
        .${SCRIPT_PREFIX}-profile-bulk-wrap.${SCRIPT_PREFIX}-profile-bulk-open {
          border-radius: 999px;
          background: #3e3e3e !important;
        }
        .${SCRIPT_PREFIX}-profile-bulk-button:focus-visible {
          outline: 2px solid rgba(255, 255, 255, 0.7);
          outline-offset: 2px;
          border-radius: 999px;
        }
        .${SCRIPT_PREFIX}-profile-bulk-button svg {
          width: 1em;
          height: 1em;
          display: block;
          pointer-events: none;
        }
        .${SCRIPT_PREFIX}-profile-bulk-menu {
          width: 160px;
        }
        .${SCRIPT_PREFIX}-profile-select-box {
          position: absolute;
          right: 8px;
          bottom: 8px;
          z-index: 5;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: var(--${SCRIPT_PREFIX}-profile-checkbox-size, 26px);
          height: var(--${SCRIPT_PREFIX}-profile-checkbox-size, 26px);
          border: 2px solid rgba(255, 255, 255, 0.92);
          border-radius: 999px;
          background: rgba(22, 24, 35, 0.72);
          box-shadow: none;
          cursor: pointer;
          box-sizing: border-box;
          backdrop-filter: blur(8px);
          padding: 0;
          line-height: 0;
          appearance: none;
          -webkit-appearance: none;
          transition: transform 140ms ease, background 140ms ease, border-color 140ms ease;
        }
        .${SCRIPT_PREFIX}-profile-select-box:hover {
          transform: scale(1.04);
          background: rgba(22, 24, 35, 0.86);
        }
        .${SCRIPT_PREFIX}-profile-select-box.selected {
          border-color: #fe2c55;
          background: #fe2c55;
          box-shadow: none;
        }
        .${SCRIPT_PREFIX}-profile-select-box input {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          margin: 0;
          padding: 0;
          opacity: 0 !important;
          cursor: pointer;
          appearance: none !important;
          -webkit-appearance: none !important;
        }
        .${SCRIPT_PREFIX}-profile-select-mark {
          position: relative;
          width: 100%;
          height: 100%;
          pointer-events: none;
        }
        .${SCRIPT_PREFIX}-profile-select-box.selected .${SCRIPT_PREFIX}-profile-select-mark::after {
          content: "";
          position: absolute;
          left: 30%;
          top: 20%;
          width: 34%;
          height: 52%;
          border: solid #fff;
          border-width: 0 3px 3px 0;
          transform: rotate(45deg);
          box-sizing: border-box;
        }
        .${SCRIPT_PREFIX}-bulk-confirm-modal {
          width: min(860px, calc(100vw - 42px));
          max-height: min(720px, calc(100vh - 42px));
        }
        .${SCRIPT_PREFIX}-bulk-list {
          display: grid;
          gap: 10px;
          max-height: min(520px, 58vh);
          overflow: auto;
          padding-right: 4px;
        }
        .${SCRIPT_PREFIX}-bulk-row {
          display: grid;
          grid-template-columns: 28px 72px minmax(0, 1fr) 72px;
          gap: 12px;
          align-items: center;
          border: 1px solid rgba(127, 127, 127, 0.22);
          border-radius: 12px;
          padding: 10px;
          background: rgba(127, 127, 127, 0.06);
        }
        .${SCRIPT_PREFIX}-bulk-row input {
          width: 18px;
          height: 18px;
          accent-color: #fe2c55;
        }
        .${SCRIPT_PREFIX}-bulk-cover {
          width: 72px;
          height: 96px;
          border-radius: 8px;
          object-fit: cover;
          background: #222;
        }
        .${SCRIPT_PREFIX}-bulk-desc {
          min-width: 0;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
          font-size: 13px;
          line-height: 1.45;
        }
        .${SCRIPT_PREFIX}-bulk-type {
          justify-self: end;
          border-radius: 999px;
          padding: 6px 10px;
          font-size: 12px;
          font-weight: 700;
          background: rgba(254, 44, 85, 0.12);
          color: #fe2c55;
          white-space: nowrap;
        }
        .${SCRIPT_PREFIX}-bulk-footer {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: center;
          margin-top: 14px;
          padding-top: 12px;
          border-top: 1px solid rgba(127, 127, 127, 0.2);
        }
        .${SCRIPT_PREFIX}-advanced-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }
        .${SCRIPT_PREFIX}-check-left label {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          margin: 0;
          cursor: pointer;
          font-weight: 600;
        }
        .${SCRIPT_PREFIX}-check-left input {
          width: 16px !important;
          height: 16px;
          margin: 0;
          accent-color: #fe2c55;
          order: -1;
        }
        .${SCRIPT_PREFIX}-profile-slider-field {
          grid-column: 1 / -1;
          display: grid;
          gap: 10px;
        }
        .${SCRIPT_PREFIX}-profile-slider-head {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }
        .${SCRIPT_PREFIX}-profile-slider-head label {
          margin: 0;
          flex: 0 0 auto;
        }
        .${SCRIPT_PREFIX}-profile-slider-desc {
          min-width: 0;
          color: #777;
          font-size: 12px;
          line-height: 1.35;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .${SCRIPT_PREFIX}-modal.dark .${SCRIPT_PREFIX}-profile-slider-desc { color: #aaa; }
        .${SCRIPT_PREFIX}-profile-slider-value {
          margin-left: auto;
          flex: 0 0 auto;
          min-width: 48px;
          text-align: right;
          color: #fe2c55;
          font-weight: 800;
          font-variant-numeric: tabular-nums;
        }
        .${SCRIPT_PREFIX}-profile-slider-field input[type="range"] {
          width: 100%;
          accent-color: #fe2c55;
        }
        .${SCRIPT_PREFIX}-menu {
          position: absolute;
          z-index: 2147483601;
          left: 50%;
          bottom: 52px;
          transform: none;
          transform-origin: var(--${SCRIPT_PREFIX}-menu-origin, 50% 50%);
          display: none;
          visibility: hidden;
          width: 160px;
          overflow: hidden;
          border-radius: 14px;
          background:
            radial-gradient(circle at var(--${SCRIPT_PREFIX}-menu-origin-x, 50%) var(--${SCRIPT_PREFIX}-menu-origin-y, 50%), rgba(255, 255, 255, 0.10), rgba(255, 255, 255, 0.00) 54px),
            rgba(18, 18, 18, 0.96);
          border: 1px solid rgba(255, 255, 255, 0.10);
          box-shadow: 0 14px 42px rgba(0, 0, 0, 0.42);
          opacity: 1;
          color: #fff;
          color-scheme: dark;
          font-family: Arial, sans-serif;
          box-sizing: border-box;
          will-change: transform, opacity, filter;
        }
        .${SCRIPT_PREFIX}-menu.open,
        .${SCRIPT_PREFIX}-menu.closing {
          display: block;
        }
        .${SCRIPT_PREFIX}-menu.open[data-placement],
        .${SCRIPT_PREFIX}-menu.closing[data-placement] {
          visibility: visible;
        }
        .${SCRIPT_PREFIX}-menu.open:not(.closing)[data-placement] {
          animation: ${SCRIPT_PREFIX}-menu-slide-fade-in 145ms cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        .${SCRIPT_PREFIX}-menu.closing[data-placement] {
          pointer-events: none;
          animation: ${SCRIPT_PREFIX}-menu-slide-fade-out 105ms cubic-bezier(0.4, 0, 1, 1) both;
        }
        .${SCRIPT_PREFIX}-menu[data-placement="right"] {
          --${SCRIPT_PREFIX}-menu-origin: 0% 50%;
          --${SCRIPT_PREFIX}-menu-origin-x: 0%;
          --${SCRIPT_PREFIX}-menu-origin-y: 50%;
          --${SCRIPT_PREFIX}-menu-start-x: -10px;
          --${SCRIPT_PREFIX}-menu-start-y: 0px;
        }
        .${SCRIPT_PREFIX}-menu[data-placement="left"] {
          --${SCRIPT_PREFIX}-menu-origin: 100% 50%;
          --${SCRIPT_PREFIX}-menu-origin-x: 100%;
          --${SCRIPT_PREFIX}-menu-origin-y: 50%;
          --${SCRIPT_PREFIX}-menu-start-x: 10px;
          --${SCRIPT_PREFIX}-menu-start-y: 0px;
        }
        .${SCRIPT_PREFIX}-menu[data-placement="top"] {
          --${SCRIPT_PREFIX}-menu-origin: 50% 100%;
          --${SCRIPT_PREFIX}-menu-origin-x: 50%;
          --${SCRIPT_PREFIX}-menu-origin-y: 100%;
          --${SCRIPT_PREFIX}-menu-start-x: 0px;
          --${SCRIPT_PREFIX}-menu-start-y: 10px;
        }
        .${SCRIPT_PREFIX}-menu[data-placement="bottom"],
        .${SCRIPT_PREFIX}-menu[data-placement="bottom-start"],
        .${SCRIPT_PREFIX}-menu[data-placement="bottom-end"] {
          --${SCRIPT_PREFIX}-menu-origin: 50% 0%;
          --${SCRIPT_PREFIX}-menu-origin-x: 50%;
          --${SCRIPT_PREFIX}-menu-origin-y: 0%;
          --${SCRIPT_PREFIX}-menu-start-x: 0px;
          --${SCRIPT_PREFIX}-menu-start-y: -10px;
        }
        .${SCRIPT_PREFIX}-panel.light .${SCRIPT_PREFIX}-menu,
        .${SCRIPT_PREFIX}-menu.light {
          color: #111;
          color-scheme: light;
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
        .${SCRIPT_PREFIX}-panel.light .${SCRIPT_PREFIX}-button,
        .${SCRIPT_PREFIX}-menu.light .${SCRIPT_PREFIX}-button { color: #111; }
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
        .${SCRIPT_PREFIX}-notification-stack {
          position: fixed;
          top: 76px;
          right: 18px;
          z-index: 2147483702;
          width: min(372px, calc(100vw - 28px));
          height: var(--${SCRIPT_PREFIX}-notification-stack-collapsed-height, 90px);
          pointer-events: none;
          perspective: 900px;
          transition: height 150ms cubic-bezier(0.2, 0.8, 0.2, 1);
        }
        .${SCRIPT_PREFIX}-notification-stack:hover {
          height: var(--${SCRIPT_PREFIX}-notification-stack-expanded-height, var(--${SCRIPT_PREFIX}-notification-stack-collapsed-height, 92px));
        }
        .${SCRIPT_PREFIX}-notification-card {
          position: absolute;
          top: 0;
          right: 0;
          width: 100%;
          display: grid;
          grid-template-columns: 34px minmax(0, 1fr) 34px;
          gap: 10px;
          align-items: center;
          padding: 14px 10px 14px 14px;
          border-radius: 14px;
          color: var(--tux-v2-color-ui-shape-text-1-on-primary, #fff);
          background: rgba(18, 18, 18, 0.94);
          border: 1px solid rgba(255, 255, 255, 0.12);
          box-shadow: 0 14px 42px rgba(0, 0, 0, 0.36);
          -webkit-backdrop-filter: blur(18px);
          backdrop-filter: blur(18px);
          font: 13px/1.42 Arial, sans-serif;
          pointer-events: auto;
          overflow: hidden;
          transform-origin: 50% 0;
          transform: translate3d(0, var(--${SCRIPT_PREFIX}-stack-y, 0px), 0) scale(var(--${SCRIPT_PREFIX}-stack-scale, 1));
          opacity: var(--${SCRIPT_PREFIX}-stack-opacity, 1);
          transition: transform 170ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 120ms ease, background 150ms ease, border-color 150ms ease;
          animation: ${SCRIPT_PREFIX}-notification-card-in 170ms cubic-bezier(0.18, 0.89, 0.32, 1.12);
          isolation: isolate;
        }
        .${SCRIPT_PREFIX}-notification-stack:hover .${SCRIPT_PREFIX}-notification-card {
          transform: translate3d(0, var(--${SCRIPT_PREFIX}-stack-expanded-y, var(--${SCRIPT_PREFIX}-stack-y, 0px)), 0) scale(1);
          opacity: 1;
        }
        .${SCRIPT_PREFIX}-notification-card.light {
          color: #111;
          background: rgba(255, 255, 255, 0.96);
          border-color: rgba(0, 0, 0, 0.08);
          box-shadow: 0 14px 40px rgba(0, 0, 0, 0.18);
        }
        .${SCRIPT_PREFIX}-notification-card::before {
          content: none;
        }
        .${SCRIPT_PREFIX}-notification-card > * {
          position: relative;
          z-index: 3;
        }
        .${SCRIPT_PREFIX}-notification-card.${SCRIPT_PREFIX}-download-status.busy,
        .${SCRIPT_PREFIX}-notification-card.${SCRIPT_PREFIX}-download-status.album,
        .${SCRIPT_PREFIX}-notification-card.${SCRIPT_PREFIX}-download-status.image {
          background: rgba(18, 18, 18, 0.94);
          border-color: rgba(255, 255, 255, 0.18);
        }
        .${SCRIPT_PREFIX}-notification-card.light.${SCRIPT_PREFIX}-download-status.busy,
        .${SCRIPT_PREFIX}-notification-card.light.${SCRIPT_PREFIX}-download-status.album,
        .${SCRIPT_PREFIX}-notification-card.light.${SCRIPT_PREFIX}-download-status.image {
          background: rgba(255, 255, 255, 0.96);
          border-color: rgba(0, 0, 0, 0.10);
        }
        .${SCRIPT_PREFIX}-notification-card.${SCRIPT_PREFIX}-download-status.busy::after,
        .${SCRIPT_PREFIX}-notification-card.${SCRIPT_PREFIX}-download-status.album::after,
        .${SCRIPT_PREFIX}-notification-card.${SCRIPT_PREFIX}-download-status.image::after {
          content: "";
          position: absolute;
          inset: 0;
          padding: 1px;
          border-radius: inherit;
          background: conic-gradient(
            from var(--${SCRIPT_PREFIX}-border-angle, 0deg),
            rgba(255, 255, 255, 0.10) 0deg,
            rgba(255, 255, 255, 0.10) 205deg,
            rgba(255, 255, 255, 0.86) 252deg,
            rgba(255, 255, 255, 0.24) 296deg,
            rgba(255, 255, 255, 0.10) 360deg
          );
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          pointer-events: none;
          z-index: 2;
          animation: ${SCRIPT_PREFIX}-notification-border-orbit 900ms linear infinite;
        }
        .${SCRIPT_PREFIX}-notification-card.light.${SCRIPT_PREFIX}-download-status.busy::after,
        .${SCRIPT_PREFIX}-notification-card.light.${SCRIPT_PREFIX}-download-status.album::after,
        .${SCRIPT_PREFIX}-notification-card.light.${SCRIPT_PREFIX}-download-status.image::after {
          background: conic-gradient(
            from var(--${SCRIPT_PREFIX}-border-angle, 0deg),
            rgba(22, 24, 35, 0.08) 0deg,
            rgba(22, 24, 35, 0.08) 205deg,
            rgba(22, 24, 35, 0.42) 252deg,
            rgba(22, 24, 35, 0.14) 296deg,
            rgba(22, 24, 35, 0.08) 360deg
          );
        }
        .${SCRIPT_PREFIX}-notification-icon,
        .${SCRIPT_PREFIX}-download-status-icon {
          width: 34px;
          height: 34px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          background: rgba(255, 255, 255, 0.10);
          color: #fff;
          font-weight: 700;
          font-size: 17px;
        }
        .${SCRIPT_PREFIX}-notification-card.light .${SCRIPT_PREFIX}-notification-icon,
        .${SCRIPT_PREFIX}-notification-card.light .${SCRIPT_PREFIX}-download-status-icon {
          background: rgba(22, 24, 35, 0.06);
          color: #111;
        }
        .${SCRIPT_PREFIX}-notification-card.error .${SCRIPT_PREFIX}-notification-icon,
        .${SCRIPT_PREFIX}-notification-card.error .${SCRIPT_PREFIX}-download-status-icon {
          background: rgba(254, 44, 85, 0.18);
          color: #fe2c55;
        }
        .${SCRIPT_PREFIX}-notification-card.success .${SCRIPT_PREFIX}-notification-icon,
        .${SCRIPT_PREFIX}-notification-card.success .${SCRIPT_PREFIX}-download-status-icon {
          background: rgba(37, 244, 238, 0.14);
          color: #25f4ee;
        }
        .${SCRIPT_PREFIX}-notification-card.${SCRIPT_PREFIX}-download-status.busy .${SCRIPT_PREFIX}-download-status-icon,
        .${SCRIPT_PREFIX}-notification-card.${SCRIPT_PREFIX}-download-status.album .${SCRIPT_PREFIX}-download-status-icon,
        .${SCRIPT_PREFIX}-notification-card.${SCRIPT_PREFIX}-download-status.image .${SCRIPT_PREFIX}-download-status-icon {
          background: rgba(255, 255, 255, 0.10);
          color: #25f4ee;
        }
        .${SCRIPT_PREFIX}-notification-card.light.${SCRIPT_PREFIX}-download-status.busy .${SCRIPT_PREFIX}-download-status-icon,
        .${SCRIPT_PREFIX}-notification-card.light.${SCRIPT_PREFIX}-download-status.album .${SCRIPT_PREFIX}-download-status-icon,
        .${SCRIPT_PREFIX}-notification-card.light.${SCRIPT_PREFIX}-download-status.image .${SCRIPT_PREFIX}-download-status-icon {
          background: rgba(22, 24, 35, 0.06);
          color: #fe2c55;
        }
        .${SCRIPT_PREFIX}-download-status-spinner {
          width: 36px;
          height: 36px;
          display: inline-grid;
          place-items: center;
          color: currentColor;
        }
        .${SCRIPT_PREFIX}-download-status-spinner svg {
          width: 36px;
          height: 36px;
          display: block;
          animation: ${SCRIPT_PREFIX}-download-spin 720ms linear infinite;
        }
        .${SCRIPT_PREFIX}-download-status-spinner .${SCRIPT_PREFIX}-spinner-ring {
          fill: none;
          stroke: currentColor;
          stroke-width: 1.9;
          opacity: 0.28;
        }
        .${SCRIPT_PREFIX}-download-status-spinner .${SCRIPT_PREFIX}-spinner-arrow {
          fill: none;
          stroke: currentColor;
          stroke-width: 2.1;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        .${SCRIPT_PREFIX}-notification-main,
        .${SCRIPT_PREFIX}-download-status-main { min-width: 0; }
        .${SCRIPT_PREFIX}-notification-head,
        .${SCRIPT_PREFIX}-download-status-head {
          display: flex;
          align-items: baseline;
          gap: 8px;
          min-width: 0;
        }
        .${SCRIPT_PREFIX}-notification-title,
        .${SCRIPT_PREFIX}-download-status-title {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-weight: 700;
          font-size: 14px;
        }
        .${SCRIPT_PREFIX}-notification-meta,
        .${SCRIPT_PREFIX}-download-status-meta {
          flex: none;
          color: rgba(255, 255, 255, 0.74);
          font-weight: 700;
          font-size: 13px;
        }
        .${SCRIPT_PREFIX}-notification-card.light .${SCRIPT_PREFIX}-notification-meta,
        .${SCRIPT_PREFIX}-notification-card.light .${SCRIPT_PREFIX}-download-status-meta {
          color: rgba(22, 24, 35, 0.56);
        }
        .${SCRIPT_PREFIX}-notification-card.error .${SCRIPT_PREFIX}-notification-meta,
        .${SCRIPT_PREFIX}-notification-card.error .${SCRIPT_PREFIX}-download-status-meta { color: #fe2c55; }
        .${SCRIPT_PREFIX}-notification-card.success .${SCRIPT_PREFIX}-notification-meta,
        .${SCRIPT_PREFIX}-notification-card.success .${SCRIPT_PREFIX}-download-status-meta { color: #25f4ee; }
        .${SCRIPT_PREFIX}-notification-detail,
        .${SCRIPT_PREFIX}-download-status-detail {
          margin-top: 4px;
          color: rgba(255, 255, 255, 0.70);
          font-size: 12px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .${SCRIPT_PREFIX}-notification-card.light .${SCRIPT_PREFIX}-notification-detail,
        .${SCRIPT_PREFIX}-notification-card.light .${SCRIPT_PREFIX}-download-status-detail {
          color: rgba(22, 24, 35, 0.62);
        }
        .${SCRIPT_PREFIX}-notification-close,
        .${SCRIPT_PREFIX}-download-status-close {
          width: 34px;
          height: 34px;
          border: 0;
          border-radius: 999px;
          color: rgba(255, 255, 255, 0.72);
          background: transparent;
          cursor: pointer;
          font-size: 22px;
          line-height: 1;
          padding: 0;
          display: grid;
          place-items: center;
          align-self: center;
        }
        .${SCRIPT_PREFIX}-notification-close:hover,
        .${SCRIPT_PREFIX}-notification-close:focus-visible,
        .${SCRIPT_PREFIX}-download-status-close:hover,
        .${SCRIPT_PREFIX}-download-status-close:focus-visible {
          color: #fff;
          background: rgba(255, 255, 255, 0.12);
        }
        .${SCRIPT_PREFIX}-notification-card.light .${SCRIPT_PREFIX}-notification-close,
        .${SCRIPT_PREFIX}-notification-card.light .${SCRIPT_PREFIX}-download-status-close {
          color: rgba(22, 24, 35, 0.58);
        }
        .${SCRIPT_PREFIX}-notification-card.light .${SCRIPT_PREFIX}-notification-close:hover,
        .${SCRIPT_PREFIX}-notification-card.light .${SCRIPT_PREFIX}-notification-close:focus-visible,
        .${SCRIPT_PREFIX}-notification-card.light .${SCRIPT_PREFIX}-download-status-close:hover,
        .${SCRIPT_PREFIX}-notification-card.light .${SCRIPT_PREFIX}-download-status-close:focus-visible {
          color: #111;
          background: rgba(22, 24, 35, 0.06);
        }
        .${SCRIPT_PREFIX}-notification-card.fading {
          opacity: 0;
          pointer-events: none;
          transform: translateY(-6px) scale(0.97);
          transition: opacity 70ms ease, transform 70ms ease;
        }
        .${SCRIPT_PREFIX}-notification-card.attention {
          animation: ${SCRIPT_PREFIX}-notification-card-shake 360ms ease-in-out,
            ${SCRIPT_PREFIX}-notification-card-flash 1000ms ease-out;
        }
        .${SCRIPT_PREFIX}-notification-card.light.attention {
          animation: ${SCRIPT_PREFIX}-notification-card-shake 360ms ease-in-out,
            ${SCRIPT_PREFIX}-notification-card-flash-light 1000ms ease-out;
        }
        @property --${SCRIPT_PREFIX}-border-angle {
          syntax: '<angle>';
          inherits: false;
          initial-value: 0deg;
        }
        @keyframes ${SCRIPT_PREFIX}-download-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes ${SCRIPT_PREFIX}-notification-border-orbit {
          to { --${SCRIPT_PREFIX}-border-angle: 360deg; }
        }
        @keyframes ${SCRIPT_PREFIX}-menu-slide-fade-in {
          0% {
            opacity: 0;
            filter: blur(5px);
            transform: translate3d(var(--${SCRIPT_PREFIX}-menu-start-x, 0px), var(--${SCRIPT_PREFIX}-menu-start-y, 0px), 0) scale(0.985);
          }
          100% {
            opacity: 1;
            filter: blur(0);
            transform: translate3d(0, 0, 0) scale(1);
          }
        }
        @keyframes ${SCRIPT_PREFIX}-menu-slide-fade-out {
          0% {
            opacity: 1;
            filter: blur(0);
            transform: translate3d(0, 0, 0) scale(1);
          }
          100% {
            opacity: 0;
            filter: blur(4px);
            transform: translate3d(var(--${SCRIPT_PREFIX}-menu-start-x, 0px), var(--${SCRIPT_PREFIX}-menu-start-y, 0px), 0) scale(0.985);
          }
        }
        @keyframes ${SCRIPT_PREFIX}-notification-card-in {
          from { opacity: 0; transform: translateX(22px) translateY(-10px) scale(0.96) rotateX(-6deg); }
          to { opacity: 1; transform: translateX(0) translateY(0) scale(1) rotateX(0); }
        }
        @keyframes ${SCRIPT_PREFIX}-notification-card-shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(7px); }
          60% { transform: translateX(-5px); }
          80% { transform: translateX(3px); }
        }
        @keyframes ${SCRIPT_PREFIX}-notification-card-flash {
          0% { background: rgba(72, 72, 72, 0.98); border-color: rgba(255, 255, 255, 0.28); }
          100% { background: rgba(18, 18, 18, 0.94); border-color: rgba(255, 255, 255, 0.12); }
        }
        @keyframes ${SCRIPT_PREFIX}-notification-card-flash-light {
          0% { background: rgba(22, 24, 35, 0.10); border-color: rgba(22, 24, 35, 0.18); }
          100% { background: rgba(255, 255, 255, 0.96); border-color: rgba(0, 0, 0, 0.08); }
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
        .${SCRIPT_PREFIX}-modal input[type="checkbox"] {
          width: auto;
          min-width: 18px;
          height: 18px;
          padding: 0;
          accent-color: #fe2c55;
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
          font-size: 14px;
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
          border-color: #3e3e3e;
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
          border-color: #3e3e3e;
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
          font-size: 14px;
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
          border-color: #3e3e3e;
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
          border-color: #3e3e3e;
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
    if (options.allowDocumentFallbackScan) {
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
        .filter((element) => !this.app.isOwnUiElement?.(element))
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
        .filter((element) => !this.app.isOwnUiElement?.(element))
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
        if (!host || this.app.isOwnUiElement?.(host)) continue;
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

    findStackedNavigationGroupContext(anchorRect) {
      if (!anchorRect) return null;
      const viewportWidth = this.app.window.innerWidth || 0;
      const viewportHeight = this.app.window.innerHeight || 0;
      const maxDistance = Math.max(140, Math.min(320, viewportHeight * 0.42));
      const controls = Array.from(
        this.app.document.querySelectorAll?.('button,[role="button"],a') || [],
      )
        .filter((element) => !this.app.isOwnUiElement?.(element))
        .filter((element) => element !== anchorRect.element)
        .map((element) => this.getElementRect(element))
        .filter((rect) => {
          if (!rect) return false;
          if (rect.width < 24 || rect.width > 96 || rect.height < 24 || rect.height > 112) return false;
          if (getVisibleRectRatio(rect, viewportWidth, viewportHeight) < 0.55) return false;
          if (rect.bottom > anchorRect.top + 2) return false;
          if (anchorRect.top - rect.bottom > maxDistance) return false;
          if (Math.abs(rect.centerX - anchorRect.centerX) > 112) return false;
          return true;
        })
        .sort((left, right) => left.top - right.top);
      const columns = [];
      for (const rect of controls) {
        let column = columns.find((entry) => Math.abs(entry.centerX - rect.centerX) <= 42);
        if (!column) {
          column = { centerX: rect.centerX, rects: [] };
          columns.push(column);
        }
        column.rects.push(rect);
        column.centerX =
          column.rects.reduce((total, item) => total + item.centerX, 0) / column.rects.length;
      }

      const candidates = [];
      for (const column of columns) {
        const sorted = column.rects.slice().sort((left, right) => left.top - right.top);
        let run = [];
        const flushRun = () => {
          if (run.length < 2) {
            run = [];
            return;
          }
          const groupRect = getBoundingRect(run);
          if (!groupRect || groupRect.width > 128 || groupRect.height < 64 || groupRect.height > 180) {
            run = [];
            return;
          }
          const buttonRect = run.slice().sort((left, right) => right.bottom - left.bottom)[0];
          const verticalDistance = Math.max(0, anchorRect.top - groupRect.bottom);
          const centerDistance = Math.abs(groupRect.centerX - anchorRect.centerX);
          candidates.push({
            rect: groupRect,
            buttonRect,
            score: verticalDistance * 2 + centerDistance,
          });
          run = [];
        };

        for (const rect of sorted) {
          if (!run.length) {
            run = [rect];
            continue;
          }
          const previous = run[run.length - 1];
          const gap = Math.max(0, rect.top - previous.bottom);
          const maxGap = Math.max(12, Math.min(36, previous.height * 0.75));
          if (gap <= maxGap) {
            run.push(rect);
          } else {
            flushRun();
            run = [rect];
          }
        }
        flushRun();
      }

      return candidates.sort((left, right) => left.score - right.score)[0] || null;
    }

    findNavigationContext(anchorRect = null) {
      const navigationRect = this.findNavigationHostRect();
      if (navigationRect) {
        const viewportWidth = this.app.window.innerWidth || 0;
        const viewportHeight = this.app.window.innerHeight || 0;
        const buttonRect = Array.from(
          navigationRect.element.querySelectorAll?.("button,[role='button']") || [],
        )
          .map((element) => this.getElementRect(element))
          .filter((rect) => {
            if (!rect) return false;
            if (rect.width < 24 || rect.width > 96 || rect.height < 24 || rect.height > 112) return false;
            return getVisibleRectRatio(rect, viewportWidth, viewportHeight) >= 0.55;
          })
          .sort((left, right) => right.bottom - left.bottom)[0] || null;
        return { rect: navigationRect, buttonRect };
      }

      if (anchorRect) return this.findStackedNavigationGroupContext(anchorRect);

      const fallbackAnchorRect = this.findNavigationAnchorRect();
      return fallbackAnchorRect ? { rect: fallbackAnchorRect, buttonRect: fallbackAnchorRect } : null;
    }

    findNavigationAnchorRect() {
      const controls = Array.from(
        this.app.document.querySelectorAll('button,[role="button"]'),
      )
        .filter((element) => !this.app.isOwnUiElement?.(element))
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
      const referenceMediaRect = this.getElementRect(this.app.extractor?.getVisibleMediaElement?.());
      const scoreHostRect = (rect) => {
        const className = String(rect.element.className || "");
        let score =
          scoreActionBarRect(rect, viewportWidth, viewportHeight) +
          (className.includes("SectionActionBarContainer") ? 12 : 0);
        if (referenceMediaRect) {
          const overlap =
            Math.max(
              0,
              Math.min(rect.bottom, referenceMediaRect.bottom) -
                Math.max(rect.top, referenceMediaRect.top),
            ) / Math.max(1, Math.min(rect.height, referenceMediaRect.height));
          const verticalDistance =
            Math.abs(rect.centerY - referenceMediaRect.centerY) / Math.max(1, viewportHeight);
          if (rect.left >= referenceMediaRect.right - 20) score += 12;
          score += overlap * 60 - verticalDistance * 80;
        }
        return score;
      };
      const hosts = Array.from(this.app.document.querySelectorAll(RECOMMEND_ACTION_BAR_SELECTOR))
        .filter((element) => !this.app.isOwnUiElement?.(element))
        .filter((element) => isActionBarClassName(element.className))
        .map((element) => this.getElementRect(element))
        .filter((rect) => {
          if (!this.isVisibleActionBarRect(rect)) return false;
          const buttons = Array.from(rect.element.querySelectorAll?.("button,[role='button'],a") || [])
            .filter((button) => !this.app.panel?.contains(button));
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

    findPreviousActionControlContext(anchorRect) {
      if (!anchorRect) return null;
      const viewportWidth = this.app.window.innerWidth || 0;
      const viewportHeight = this.app.window.innerHeight || 0;
      const maxDistance = Math.max(120, Math.min(220, viewportWidth * 0.28));
      const rects = Array.from(this.app.document.querySelectorAll?.('button,[role="button"],a') || [])
        .filter((element) => !this.app.isOwnUiElement?.(element))
        .filter((element) => element !== anchorRect.element)
        .map((element) => this.getElementRect(element))
        .filter((rect) => {
          if (!rect) return false;
          if (rect.width < 24 || rect.width > 96 || rect.height < 24 || rect.height > 112) return false;
          if (getVisibleRectRatio(rect, viewportWidth, viewportHeight) < 0.55) return false;
          if (Math.abs(rect.centerX - anchorRect.centerX) > 48) return false;
          if (rect.bottom > anchorRect.top + 2) return false;
          if (anchorRect.top - rect.bottom > maxDistance) return false;
          return true;
        })
        .sort((left, right) => left.top - right.top);
      const previousRect = rects.slice().sort((left, right) => right.bottom - left.bottom)[0] || null;
      if (!previousRect) return null;

      const groupGap = Math.max(12, Math.min(36, previousRect.height * 0.75));
      const groupRects = [previousRect];
      let groupTop = previousRect.top;
      const aboveNearestFirst = rects
        .filter((rect) => rect !== previousRect && rect.bottom <= groupTop + 2)
        .sort((left, right) => right.bottom - left.bottom);
      for (const rect of aboveNearestFirst) {
        const gap = Math.max(0, groupTop - rect.bottom);
        if (gap > groupGap) break;
        groupRects.push(rect);
        groupTop = Math.min(groupTop, rect.top);
      }

      return { rect: previousRect, groupRect: getBoundingRect(groupRects) };
    }

    findActionControlColumnContext() {
      const videoRect = this.getElementRect(this.app.extractor?.getVisibleMediaElement?.());
      if (!videoRect) return null;
      const controls = Array.from(
        this.app.document.querySelectorAll?.('button,[role="button"],a') || [],
      )
        .filter((element) => !this.app.isOwnUiElement?.(element))
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
      const navigationContext = this.findNavigationContext(anchorRect);
      const previousRects = best.rects
        .slice(0, anchorIndex)
        .filter((rect) => Math.abs(rect.centerX - anchorRect.centerX) <= 48);
      const previousRect = previousRects.slice().reverse()[0] || null;
      const previousGroupRect = getBoundingRect(previousRects);
      const nextRect =
        best.rects.slice(anchorIndex + 1).find((rect) => Math.abs(rect.centerX - anchorRect.centerX) <= 48) ||
        null;
      return {
        host: null,
        hostRect: best.hostRect,
        anchor: anchorRect.element,
        anchorRect,
        previousRect,
        previousGroupRect,
        navigationRect: navigationContext?.rect || null,
        navigationButtonRect: navigationContext?.buttonRect || null,
        nextRect,
        fallback: true,
      };
    }

    getNativeActionChildren(host) {
      return Array.from(host?.children || []).filter((child) => !this.app.isOwnUiElement?.(child));
    }

    getActionBarInsertionReference(host) {
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
      const navigationContext = this.findNavigationContext(anchorRect);
      const previousContext = this.findPreviousActionControlContext(anchorRect);
      const previousRect = previousContext?.rect || null;
      const previousGroupRect = previousContext?.groupRect || null;
      let nextRect = null;
      for (const child of nativeChildren.slice(anchorIndex + 1)) {
        if (!child || child === this.app.panel || isAvatarActionChild(child)) continue;
        const rect = this.getElementRect(child);
        if (!rect || rect.width < 24 || rect.height < 24) continue;
        if (anchorRect && Math.abs(rect.centerX - anchorRect.centerX) > 48) continue;
        nextRect = rect;
        break;
      }
      return {
        host,
        hostRect,
        anchor,
        anchorRect,
        previousRect,
        previousGroupRect,
        navigationRect: navigationContext?.rect || null,
        navigationButtonRect: navigationContext?.buttonRect || null,
        nextRect,
      };
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



  class RecommendPlacementAdapter {
    constructor(app) {
      this.app = app;
    }

    mount() {
      const host = this.app.findActionBarHost();
      if (host && this.app.mountPanelInActionBar(host)) return true;
      this.app.hidePanelForInactivePlacement();
      return false;
    }

    refresh() {
      return this.mount();
    }

    unmount() {
      this.app.hidePanelForInactivePlacement();
    }
  }

  class ProfileBrowseDialogAdapter {
    constructor(app) {
      this.app = app;
    }

    findDialog() {
      return getVisibleProfileBrowseDialog(this.app.document);
    }

    findEllipsis(dialog = null) {
      const button = dialog?.querySelector?.(PROFILE_BROWSE_ELLIPSIS_SELECTOR) || null;
      if (!button) return null;
      const rect = button.getBoundingClientRect?.();
      const viewportWidth = this.app.window.innerWidth || 0;
      const viewportHeight = this.app.window.innerHeight || 0;
      if (!rect || rect.width <= 0 || rect.height <= 0) return null;
      if (getVisibleRectRatio(rect, viewportWidth, viewportHeight) < 0.5) return null;
      return button;
    }

    getPositionSignature() {
      const dialog = this.findDialog();
      const ellipsis = this.findEllipsis(dialog);
      const rect = ellipsis?.getBoundingClientRect?.();
      if (!dialog || !ellipsis || !rect) return "no-profile-dialog";
      return [
        Math.round(rect.left),
        Math.round(rect.top),
        Math.round(rect.width),
        Math.round(rect.height),
        this.app.window.location?.href || "",
      ].join(",");
    }

    mount() {
      const dialog = this.findDialog();
      const ellipsis = this.findEllipsis(dialog);
      if (dialog && ellipsis && this.app.mountPanelNearProfileBrowseEllipsis(dialog, ellipsis)) {
        return true;
      }
      this.app.hidePanelForInactivePlacement();
      return false;
    }

    refresh() {
      return this.mount();
    }

    unmount() {
      this.app.hidePanelForInactivePlacement();
    }
  }


  class ProfilePageBulkAdapter {
    constructor(app) {
      this.app = app;
      this.buttonWrapper = null;
      this.button = null;
      this.menu = null;
      this.selectionMode = false;
      this.scanFrame = null;
      this.scanInterval = null;
      this.scrollHandler = () => this.scheduleScan();
      this.mutationObserver = null;
      this.outsideHandler = null;
      this.menuCloseTimer = null;
    }

    get document() {
      return this.app.document;
    }

    get window() {
      return this.app.window;
    }

    get selectionState() {
      if (!this.app.profileBulkSelectionState) {
        this.app.profileBulkSelectionState = { profileKey: "", selectedItems: new Map() };
      }
      return this.app.profileBulkSelectionState;
    }

    get selectedItems() {
      const state = this.selectionState;
      if (!(state.selectedItems instanceof Map)) state.selectedItems = new Map();
      return state.selectedItems;
    }

    isProfilePage() {
      return this.app.getCurrentPageType() === "profile";
    }

    getProfileKey() {
      const match = String(this.window.location?.pathname || "").match(/^\/(@[^/]+)/);
      return match ? match[1] : "";
    }

    syncProfileContext() {
      const profileKey = this.getProfileKey();
      if (!profileKey) return;
      const state = this.selectionState;
      if (state.profileKey && state.profileKey !== profileKey) {
        state.selectedItems.clear();
      }
      state.profileKey = profileKey;
    }

    findUserMoreButton() {
      return this.document.querySelector('[data-e2e="user-more"]');
    }

    mount() {
      if (!this.isProfilePage()) {
        this.unmount();
        return false;
      }
      this.syncProfileContext();
      const userMore = this.findUserMoreButton();
      if (userMore) {
        this.ensureButton(userMore);
      } else {
        this.unmountButtonOnly();
      }
      if (!this.selectionMode) this.enterSelectionMode();
      else this.scheduleRecoveryScan();
      this.updateMenuLabels();
      return Boolean(userMore);
    }

    unmountButtonOnly() {
      this.closeMenu();
      this.buttonWrapper?.remove?.();
      this.buttonWrapper = null;
      this.button = null;
    }

    suspend() {
      this.closeMenu(true);
      this.disableSelectionMode(false);
      this.unmountButtonOnly();
    }

    unmount() {
      this.closeMenu();
      this.disableSelectionMode(false);
      this.unmountButtonOnly();
    }

    ensureButton(userMore) {
      const nativeWrapper = userMore.parentElement || null;
      const parent = nativeWrapper?.parentElement || userMore.parentElement;
      if (!parent) return;

      const syncOfficialVisual = () => {
        const wrapperClass = [
          String(nativeWrapper?.className || ""),
          `${SCRIPT_PREFIX}-profile-bulk-wrap`,
        ].filter(Boolean).join(" ");
        const buttonClass = [String(userMore.className || ""), `${SCRIPT_PREFIX}-profile-bulk-button`]
          .filter(Boolean)
          .join(" ");
        this.buttonWrapper.className = wrapperClass;
        this.button.className = buttonClass;

        const wrapperStyle = nativeWrapper?.getAttribute?.("style") || "";
        if (wrapperStyle) this.buttonWrapper.setAttribute("style", wrapperStyle);
        else this.buttonWrapper.removeAttribute("style");
        const buttonStyle = userMore?.getAttribute?.("style") || "";
        if (buttonStyle) this.button.setAttribute("style", buttonStyle);
        else this.button.removeAttribute("style");

        const wrapperRect = nativeWrapper?.getBoundingClientRect?.();
        const buttonRect = userMore?.getBoundingClientRect?.();
        const wrapperSize = Math.round(wrapperRect?.width || buttonRect?.width || 40);
        const wrapperHeight = Math.round(wrapperRect?.height || buttonRect?.height || 40);
        this.buttonWrapper.style.setProperty("width", `${wrapperSize}px`);
        this.buttonWrapper.style.setProperty("height", `${wrapperHeight}px`);
        this.buttonWrapper.style.setProperty("display", "inline-flex", "important");
        this.buttonWrapper.style.setProperty("align-items", "center", "important");
        this.buttonWrapper.style.setProperty("justify-content", "center", "important");
        this.buttonWrapper.style.setProperty("flex", "0 0 auto");
        this.button.style.setProperty("width", "100%", "important");
        this.button.style.setProperty("height", "100%", "important");
        this.button.style.setProperty("display", "flex", "important");
        this.button.style.setProperty("align-items", "center", "important");
        this.button.style.setProperty("justify-content", "center", "important");
        this.button.style.setProperty("padding", "0", "important");
        this.button.style.setProperty("line-height", "0", "important");
        this.button.style.setProperty("background", "transparent", "important");
        this.button.style.setProperty("color", "inherit");
      };

      if (!this.buttonWrapper) {
        this.buttonWrapper = createElement(this.document, "div", "");
        this.button = createElement(this.document, "button", "");
        this.button.type = "button";
        this.button.dataset.tthelperProfileBulk = "1";
        this.button.setAttribute("aria-label", this.app.t("bulk_download"));
        this.button.innerHTML = `
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
            <path d="M4.75 6.25a1.25 1.25 0 0 1 1.25-1.25h9.7a1.25 1.25 0 1 1 0 2.5H6a1.25 1.25 0 0 1-1.25-1.25Zm0 5.75A1.25 1.25 0 0 1 6 10.75h8.2a1.25 1.25 0 1 1 0 2.5H6A1.25 1.25 0 0 1 4.75 12Zm0 5.75A1.25 1.25 0 0 1 6 16.5h5.2a1.25 1.25 0 1 1 0 2.5H6a1.25 1.25 0 0 1-1.25-1.25Zm15.98-5.4a1.1 1.1 0 0 1 .02 1.56l-3.72 3.84a1.1 1.1 0 0 1-1.57.02l-1.9-1.82a1.1 1.1 0 1 1 1.52-1.59l1.11 1.06 2.96-3.05a1.1 1.1 0 0 1 1.58-.02Z"></path>
          </svg>
        `;
        this.button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.toggleMenu();
        });
        this.buttonWrapper.appendChild(this.button);
      }

      syncOfficialVisual();
      const reference = nativeWrapper || userMore;
      if (this.buttonWrapper.parentElement !== parent || this.buttonWrapper.previousSibling !== reference) {
        parent.insertBefore(this.buttonWrapper, reference.nextSibling);
      }
    }

    ensureMenu() {
      if (this.menu) return this.menu;
      const menu = createElement(this.document, "div", `${SCRIPT_PREFIX}-menu ${SCRIPT_PREFIX}-profile-bulk-menu ${this.app.getTheme()}`);
      menu.addEventListener("pointerdown", (event) => event.stopPropagation());
      menu.addEventListener("click", (event) => event.stopPropagation());
      menu.addEventListener("mouseleave", () => this.toggleMenu(false));

      this.downloadSelectedButton = createElement(this.document, "button", `${SCRIPT_PREFIX}-button`, "");
      this.downloadSelectedButton.addEventListener("click", () => {
        this.closeMenu(true);
        this.openConfirmModal();
      });

      this.cancelSelectionButton = createElement(this.document, "button", `${SCRIPT_PREFIX}-button secondary`, "");
      this.cancelSelectionButton.addEventListener("click", () => {
        this.closeMenu(true);
        this.clearSelection();
      });

      this.settingsButton = createElement(this.document, "button", `${SCRIPT_PREFIX}-button secondary`, "");
      this.settingsButton.addEventListener("click", () => {
        this.closeMenu(true);
        this.app.openSettings();
      });

      menu.append(this.downloadSelectedButton, this.cancelSelectionButton, this.settingsButton);
      this.document.body.appendChild(menu);
      this.menu = menu;
      return menu;
    }

    toggleMenu(force = null) {
      const menu = this.ensureMenu();
      const isOpen = menu.classList.contains("open");
      const isClosing = menu.classList.contains("closing");
      const shouldOpen = force === null ? !isOpen || isClosing : Boolean(force);

      if (this.menuCloseTimer) {
        this.window.clearTimeout?.(this.menuCloseTimer);
        this.menuCloseTimer = null;
      }

      if (shouldOpen) {
        this.enterSelectionMode();
        this.updateMenuLabels();
        menu.classList.remove("closing");
        menu.classList.add("open");
        this.buttonWrapper?.classList?.add?.(`${SCRIPT_PREFIX}-profile-bulk-open`);
        this.positionMenu();
        this.bindOutsideClose();
        return;
      }

      if (!isOpen && !isClosing) return;
      menu.classList.add("open", "closing");
      this.positionMenu();
      this.buttonWrapper?.classList?.remove?.(`${SCRIPT_PREFIX}-profile-bulk-open`);
      this.menuCloseTimer = this.window.setTimeout?.(() => {
        this.menuCloseTimer = null;
        menu.classList.remove("open", "closing");
        this.clearMenuPosition();
        this.unbindOutsideClose();
      }, 170) || null;
    }

    closeMenu(immediate = false) {
      if (!this.menu) return;
      if (!immediate) {
        this.toggleMenu(false);
        return;
      }
      if (this.menuCloseTimer) {
        this.window.clearTimeout?.(this.menuCloseTimer);
        this.menuCloseTimer = null;
      }
      this.menu.classList.remove("open", "closing");
      this.buttonWrapper?.classList?.remove?.(`${SCRIPT_PREFIX}-profile-bulk-open`);
      this.clearMenuPosition();
      this.unbindOutsideClose();
    }

    clearMenuPosition() {
      if (!this.menu) return;
      for (const property of ["left", "right", "top", "bottom"]) {
        this.menu.style[property] = "";
      }
      this.menu.style.position = "";
      this.menu.style.transform = "";
      delete this.menu.dataset.placement;
    }

    bindOutsideClose() {
      if (this.outsideHandler) return;
      this.outsideHandler = (event) => {
        if (this.menu?.contains?.(event.target) || this.buttonWrapper?.contains?.(event.target)) return;
        this.closeMenu();
      };
      this.document.addEventListener("pointerdown", this.outsideHandler, true);
    }

    unbindOutsideClose() {
      if (!this.outsideHandler) return;
      this.document.removeEventListener("pointerdown", this.outsideHandler, true);
      this.outsideHandler = null;
    }

    positionMenu() {
      const menu = this.ensureMenu();
      this.clearMenuPosition();
      const rect = this.buttonWrapper?.getBoundingClientRect?.();
      if (!rect) return;
      const menuRect = menu.getBoundingClientRect?.();
      const placement = calculatePanelMenuPlacement({
        panelRect: rect,
        launcherRect: rect,
        menuWidth: menuRect?.width || 160,
        menuHeight: menuRect?.height || 160,
        viewportWidth: this.window.innerWidth || 0,
        viewportHeight: this.window.innerHeight || 0,
      });
      menu.classList.toggle("light", this.app.getTheme() === "light");
      menu.classList.toggle("dark", this.app.getTheme() === "dark");
      menu.style.position = "fixed";
      menu.style.left = `${Math.round(placement.left)}px`;
      menu.style.top = `${Math.round(placement.top)}px`;
      menu.style.right = "auto";
      menu.style.bottom = "auto";
      menu.style.transform = "none";
      menu.dataset.placement = placement.placement;
    }

    formatBulkItemCount(count) {
      return String(count);
    }

    updateMenuLabels() {
      const count = this.selectedItems.size;
      if (this.button) this.button.setAttribute("aria-label", this.app.t("bulk_download"));
      if (this.downloadSelectedButton) {
        this.downloadSelectedButton.textContent = `${this.app.t("bulk_download_selected")}（${this.formatBulkItemCount(count)}）`;
        this.downloadSelectedButton.disabled = false;
      }
      if (this.cancelSelectionButton) {
        this.cancelSelectionButton.textContent = this.app.t("bulk_cancel_selection");
        this.cancelSelectionButton.disabled = count <= 0;
      }
      if (this.settingsButton) this.settingsButton.textContent = this.app.t("settings");
    }

    enterSelectionMode() {
      if (!this.selectionMode) {
        this.selectionMode = true;
        this.ensureSelectionScanner();
      }
      this.scheduleScan();
    }

    ensureSelectionScanner() {
      if (!this.scanInterval && typeof this.window.setInterval === "function") {
        this.scanInterval = this.window.setInterval(() => this.scheduleScan(), 800);
      }
      this.document.addEventListener?.("scroll", this.scrollHandler, true);
      if (!this.mutationObserver && typeof this.window.MutationObserver === "function" && this.document.body) {
        this.mutationObserver = new this.window.MutationObserver(() => this.scheduleScan());
        this.mutationObserver.observe(this.document.body, { childList: true, subtree: true });
      }
    }

    clearSelection() {
      this.selectedItems.clear();
      this.document.querySelectorAll(`.${SCRIPT_PREFIX}-profile-select-box`).forEach((box) => {
        box.classList.remove("selected");
        box.setAttribute("aria-checked", "false");
      });
      this.document.querySelectorAll(`.${SCRIPT_PREFIX}-profile-card-selected`).forEach((node) => node.classList.remove(`${SCRIPT_PREFIX}-profile-card-selected`));
      this.updateMenuLabels();
      this.scheduleScan();
    }

    disableSelectionMode(clearSelected = false) {
      this.selectionMode = false;
      if (clearSelected) this.selectedItems.clear();
      if (this.scanInterval) {
        this.window.clearInterval?.(this.scanInterval);
        this.scanInterval = null;
      }
      if (this.scanFrame) {
        this.window.cancelAnimationFrame?.(this.scanFrame);
        this.scanFrame = null;
      }
      this.document.removeEventListener?.("scroll", this.scrollHandler, true);
      this.mutationObserver?.disconnect?.();
      this.mutationObserver = null;
      this.document.querySelectorAll(`.${SCRIPT_PREFIX}-profile-select-box`).forEach((node) => node.remove());
      this.document.querySelectorAll(`[data-tthelper-select-ready]`).forEach((node) => {
        delete node.dataset.tthelperSelectReady;
        node.removeAttribute("data-tthelper-select-ready");
      });
      this.document.querySelectorAll(`.${SCRIPT_PREFIX}-profile-card-selected`).forEach((node) => node.classList.remove(`${SCRIPT_PREFIX}-profile-card-selected`));
    }

    scheduleRecoveryScan() {
      this.scheduleScan();
      const delays = [0, 120, 350, 800, 1400];
      for (const delay of delays) {
        this.window.setTimeout?.(() => this.scheduleScan(), delay);
      }
    }

    scheduleScan() {
      if (!this.selectionMode || this.scanFrame) return;
      const run = () => {
        this.scanFrame = null;
        this.scanVisibleCards();
      };
      if (typeof this.window.requestAnimationFrame === "function") {
        this.scanFrame = this.window.requestAnimationFrame(run);
      } else {
        this.scanFrame = this.window.setTimeout(run, 50);
      }
    }

    scanVisibleCards() {
      if (!this.selectionMode || !this.isProfilePage()) return;
      const config = this.app.configStore.get();
      const size = `${Math.round(clampNumber(Number(config.profile_bulk_checkbox_size), 18, 40, 26))}px`;
      const anchors = Array.from(this.document.querySelectorAll('a[href*="/video/"], a[href*="/photo/"]'));
      for (const anchor of anchors) {
        const item = this.extractItemFromAnchor(anchor);
        if (!item?.id || !item.card) continue;
        this.attachCheckbox(item, size);
      }
      this.updateMenuLabels();
    }

    extractItemFromAnchor(anchor) {
      const href = anchor?.href || anchor?.getAttribute?.("href") || "";
      const id = getVideoIdFromUrl(href);
      if (!id) return null;
      const card = anchor.closest?.('[data-e2e="user-post-item"]') || anchor.closest?.('div') || anchor;
      const img = card.querySelector?.("img") || anchor.querySelector?.("img") || null;
      const coverUrl = img?.currentSrc || img?.src || img?.getAttribute?.("src") || "";
      const desc = String(img?.alt || card?.textContent || anchor?.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      return {
        id,
        href: new URL(href, this.window.location.href).href,
        pageUrl: new URL(href, this.window.location.href).href,
        coverUrl,
        desc,
        type: "unknown",
        card,
      };
    }

    attachCheckbox(item, size) {
      const card = item.card;
      if (!card) return;

      const existingBoxes = Array.from(card.querySelectorAll?.(`.${SCRIPT_PREFIX}-profile-select-box`) || []);
      for (const box of existingBoxes) {
        if (box.dataset.tthelperItemId && box.dataset.tthelperItemId !== item.id) box.remove();
      }

      const setBoxState = (box) => {
        const checked = this.selectedItems.has(item.id);
        box.dataset.tthelperItemId = item.id;
        box.style.setProperty(`--${SCRIPT_PREFIX}-profile-checkbox-size`, size);
        box.classList.toggle("selected", checked);
        box.setAttribute("aria-checked", checked ? "true" : "false");
      };

      const currentPosition = getComputedStyleSafe(this.window, card)?.position || "";
      if (!currentPosition || currentPosition === "static") card.style.position = "relative";

      let box = card.querySelector?.(`.${SCRIPT_PREFIX}-profile-select-box[data-tthelper-item-id="${item.id}"]`)
        || card.querySelector?.(`.${SCRIPT_PREFIX}-profile-select-box`);

      if (!box) {
        box = createElement(this.document, "button", `${SCRIPT_PREFIX}-profile-select-box`);
        box.type = "button";
        box.setAttribute("role", "checkbox");
        box.setAttribute("aria-label", this.app.t("bulk_download_selected"));
        box.dataset.tthelperItemId = item.id;

        const toggleSelected = () => {
          const nextChecked = !this.selectedItems.has(item.id);
          if (nextChecked) {
            const fresh = this.extractItemFromAnchor(card.querySelector?.('a[href*="/video/"], a[href*="/photo/"]') || null) || item;
            this.selectedItems.set(item.id, { ...item, ...fresh, card: null });
          } else {
            this.selectedItems.delete(item.id);
          }
          setBoxState(box);
          this.updateMenuLabels();
        };

        box.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
        box.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          toggleSelected();
        });
        box.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          toggleSelected();
        });
        const mark = createElement(this.document, "span", `${SCRIPT_PREFIX}-profile-select-mark`);
        box.appendChild(mark);
        card.appendChild(box);
      }

      card.dataset.tthelperSelectReady = item.id;
      setBoxState(box);
    }

    tryResolveMedia(item) {
      const config = this.app.configStore.get();
      const candidates = [
        parsePageDataFromDocument(this.document),
        ...getWindowDataCandidates(this.window),
      ].filter(Boolean);
      for (const data of candidates) {
        const media = extractMediaFromPageData(data, item.pageUrl || item.href, config);
        if (hasUsableMedia(media)) return media;
      }
      const cached = this.app.runtimeCache?.getMedia?.(item.pageUrl || item.href, config);
      if (hasUsableMedia(cached)) return cached;
      return null;
    }

    getItemTypeLabel(item) {
      const media = this.tryResolveMedia(item);
      if (media?.isImagePost || ensureArray(media?.images).length) return this.app.t("bulk_type_album");
      if (media?.video?.primaryUrl) return this.app.t("bulk_type_video");
      return this.app.t("bulk_type_unknown");
    }

    openConfirmModal() {
      const items = Array.from(this.selectedItems.values());
      if (!items.length) {
        this.app.toast(this.app.t("bulk_no_selection"));
        return;
      }
      const modal = this.app.createModal(this.app.t("bulk_confirm_title"), "", { closeOnBackdrop: false });
      modal.classList.add(`${SCRIPT_PREFIX}-bulk-confirm-modal`);
      const main = modal.querySelector("main");
      const selected = new Set(items.map((item) => item.id));
      const list = createElement(this.document, "div", `${SCRIPT_PREFIX}-bulk-list`);
      const footer = createElement(this.document, "div", `${SCRIPT_PREFIX}-bulk-footer`);
      const countLabel = createElement(this.document, "div", `${SCRIPT_PREFIX}-readonly`);
      const actions = createElement(this.document, "div", `${SCRIPT_PREFIX}-row`);
      const close = this.app.actionButton(this.app.t("cancel"), () => modal.parentElement?.remove?.(), "secondary");
      const start = this.app.actionButton(this.app.t("bulk_start_download"), () => {
        const finalItems = items.filter((item) => selected.has(item.id));
        modal.parentElement?.remove?.();
        this.app.downloadProfileBulkItems(finalItems);
      }, "primary");
      const updateCount = () => {
        countLabel.textContent = `${this.app.t("bulk_selected_count")} ${this.formatBulkItemCount(selected.size)}`;
        start.disabled = selected.size <= 0;
      };

      for (const item of items) {
        const row = createElement(this.document, "div", `${SCRIPT_PREFIX}-bulk-row`);
        const checkbox = createElement(this.document, "input");
        checkbox.type = "checkbox";
        checkbox.checked = true;
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) selected.add(item.id);
          else selected.delete(item.id);
          updateCount();
        });
        const cover = createElement(this.document, "img", `${SCRIPT_PREFIX}-bulk-cover`);
        cover.alt = "";
        if (item.coverUrl) cover.src = item.coverUrl;
        const desc = createElement(this.document, "div", `${SCRIPT_PREFIX}-bulk-desc`, item.desc || item.pageUrl || item.id);
        const type = createElement(this.document, "div", `${SCRIPT_PREFIX}-bulk-type`, this.getItemTypeLabel(item));
        row.append(checkbox, cover, desc, type);
        list.appendChild(row);
      }
      actions.append(close, start);
      footer.append(countLabel, actions);
      main.append(list, footer);
      updateCount();
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
      this.profileBulkSelectionState = { profileKey: "", selectedItems: new Map() };
      this.recommendPlacementAdapter = new RecommendPlacementAdapter(this);
      this.profileBrowseDialogAdapter = new ProfileBrowseDialogAdapter(this);
      this.profilePageBulkAdapter = new ProfilePageBulkAdapter(this);
      this.downloader = new Downloader(win, gmXmlHttpRequest, gmDownload);
      this.panel = null;
      this.menu = null;
      this.launcher = null;
      this.currentMedia = null;
      this.currentActionBarHost = null;
      this.currentActionBarContext = null;
      this.currentPlacementMode = "inactive";
      this.lastHref = "";
      this.positionObserver = null;
      this.positionFrame = null;
      this.positionPoll = null;
      this.routeChangeCleanup = null;
      this.routeChangeFrame = null;
      this.lastPanelPositionSignature = "";
      this.outsideMenuBound = false;
      this.menuCloseTimer = null;
      this.openImageOverlay = null;
      this.isCurrentLiveItem = false;
      this.isDownloading = false;
      this.isCapturingFrame = false;
      this.lastToastAnchorRect = null;
      this.lastToastAnchorAt = 0;
      this.downloadStatusEl = null;
      this.downloadStatusHideTimer = null;
      this.notificationStackEl = null;
      this.notificationId = 0;
      this.imageDownloadButton = null;
      this.imageOverlayWatcherBound = false;
      this.lastImageOpenGestureAt = 0;
      this.appStartTime = Date.now();
      this.tampermonkeyMenuRegistered = false;
    }

    start() {
      this.injectStyles();
      this.renderPanel();
      this.registerTampermonkeyMenu();
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

    registerTampermonkeyMenu() {
      if (this.tampermonkeyMenuRegistered || typeof gmRegisterMenuCommand !== "function") return;
      this.tampermonkeyMenuRegistered = true;
      try {
        gmRegisterMenuCommand(this.t("settings"), () => this.openSettings());
      } catch (_error) {
        this.tampermonkeyMenuRegistered = false;
      }
    }

    renderPanel() {
      if (this.menu) this.menu.remove();
      if (this.panel) this.panel.remove();
      const panel = createElement(this.document, "div", `${SCRIPT_PREFIX}-panel`);
      const launcherShell = createElement(this.document, "div", `${SCRIPT_PREFIX}-launcher-shell`);
      const launcherIconWrapper = createElement(
        this.document,
        "span",
        `${SCRIPT_PREFIX}-launcher-icon-wrapper`,
      );
      const launcherContainer = createElement(
        this.document,
        "div",
        `${SCRIPT_PREFIX}-launcher-container`,
      );
      const launcher = createElement(
        this.document,
        "button",
        `${SCRIPT_PREFIX}-launcher`,
      );
      launcher.type = "button";
      launcher.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
          <path d="M12 3v12" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"></path>
          <path d="M7 11l5 5 5-5" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"></path>
          <path d="M5 20h14" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"></path>
        </svg>
      `;
      launcher.addEventListener("click", (event) => {
        event.stopPropagation();
        this.toggleMenu();
      });
      launcherContainer.appendChild(launcher);
      launcherIconWrapper.appendChild(launcherContainer);
      launcherShell.appendChild(launcherIconWrapper);

      const menu = createElement(this.document, "div", `${SCRIPT_PREFIX}-menu`);
      menu.addEventListener("pointerdown", (event) => event.stopPropagation());
      menu.addEventListener("click", (event) => event.stopPropagation());
      menu.addEventListener("mouseleave", () => this.toggleMenu(false));
      const downloadButton = createElement(
        this.document,
        "button",
        `${SCRIPT_PREFIX}-button`,
        this.t("download"),
      );
      downloadButton.addEventListener("click", () => {
        this.captureToastAnchor(downloadButton);
        this.toggleMenu(false);
        this.downloadVideo(downloadButton);
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

      const debugInfoButton = createElement(
        this.document,
        "button",
        `${SCRIPT_PREFIX}-button secondary`,
        this.t("debug_info"),
      );
      debugInfoButton.addEventListener("click", () => {
        this.toggleMenu(false);
        this.copyDebugInfo("full");
      });

      const testNoticeButton = createElement(
        this.document,
        "button",
        `${SCRIPT_PREFIX}-button secondary`,
        "测试通知",
      );
      testNoticeButton.addEventListener("click", () => {
        this.toggleMenu(false);
        this.toast("测试普通通知", {
          detail: "普通通知会自动关闭，点击 × 可提前关闭。",
          iconText: "i",
        });
      });

      const testBusyButton = createElement(
        this.document,
        "button",
        `${SCRIPT_PREFIX}-button secondary`,
        "测试下载中",
      );
      testBusyButton.addEventListener("click", () => {
        this.toggleMenu(false);
        this.showVideoPreparing("demo-video.mp4");
      });

      const testAlbumButton = createElement(
        this.document,
        "button",
        `${SCRIPT_PREFIX}-button secondary`,
        "测试图集进度",
      );
      testAlbumButton.addEventListener("click", () => {
        this.toggleMenu(false);
        this.showAlbumProgress(2, 5, "demo-image-02.jpg");
      });

      const testErrorButton = createElement(
        this.document,
        "button",
        `${SCRIPT_PREFIX}-button secondary`,
        "测试失败",
      );
      testErrorButton.addEventListener("click", () => {
        this.toggleMenu(false);
        this.showDownloadError("这是一个测试错误，点击 × 关闭。");
      });

      const menuItems = [
        downloadButton,
        frameButton,
        detailsButton,
        settingsButton,
        debugInfoButton,
        testNoticeButton,
        testBusyButton,
        testAlbumButton,
        testErrorButton,
      ];
      menu.append(...menuItems);
      panel.append(launcherShell);
      this.document.body.appendChild(menu);
      this.panel = panel;
      this.menu = menu;
      this.launcher = launcher;
      this.downloadButtonEl = downloadButton;
      this.frameButtonEl = frameButton;
      this.detailsButtonEl = detailsButton;
      this.settingsButtonEl = settingsButton;
      this.debugInfoButtonEl = debugInfoButton;
      this.testNoticeButtonEl = testNoticeButton;
      this.testBusyButtonEl = testBusyButton;
      this.testAlbumButtonEl = testAlbumButton;
      this.testErrorButtonEl = testErrorButton;
      this.applyPanelState();
      this.mountPanel();
      this.bindMenuOutsideClose();
      this.renderImageDownloadButton();
      this.bindImageOverlayWatcher();
    }

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

    bindImageOverlayWatcher() {
      if (this.imageOverlayWatcherBound) return;
      this.imageOverlayWatcherBound = true;
      const handleClick = (event) => {
        const target = event.target;
        if (!target) return;
        if (this.getCurrentPageType() !== "recommend") return;
        if (this.panel?.contains(target) || this.imageDownloadButton?.contains(target)) return;
        const isImage =
          target.tagName === "IMG" ||
          (typeof target.closest === "function" &&
            (target.closest("img") || target.closest('[style*="background-image"]')));
        if (!isImage) return;
        this.lastImageOpenGestureAt = Date.now();
        this.window.setTimeout?.(() => this.refreshImageOverlayState(), 80);
      };
      this.document.addEventListener?.("click", handleClick, true);
    }

    refreshImageOverlayState() {
      if (this.getCurrentPageType() !== "recommend") {
        const wasOpen = Boolean(this.openImageOverlay);
        this.openImageOverlay = null;
        this.renderImageDownloadButton();
        if (wasOpen) {
          this.mountPanel();
          this.applyPanelState();
        }
        return;
      }

      const recentImageOpenGesture =
        this.lastImageOpenGestureAt > 0 &&
        Date.now() - this.lastImageOpenGestureAt <= IMAGE_OVERLAY_RECENT_GESTURE_MS;
      const previousOverlayElement = this.openImageOverlay?.element || null;
      const overlay = findOpenImageOverlay(this.document, this.window, this.panel, {
        recentImageOpenGesture,
        previousOverlayElement,
        allowDocumentFallbackScan: recentImageOpenGesture || Boolean(previousOverlayElement),
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
      const isPending = this.panel.classList.contains("pending");
      const isClosing = this.panel.classList.contains("closing");
      const isEmbedded = this.panel.classList.contains("embedded");
      const isProfileDialog = this.panel.classList.contains("profile-dialog");
      const config = this.configStore.get();
      const nextClassName = [
        `${SCRIPT_PREFIX}-panel`,
        this.getTheme(),
        isEmbedded ? "embedded" : "",
        isProfileDialog ? "profile-dialog" : "",
        isOpen ? "open" : "",
        isPending ? "pending" : "",
        isClosing ? "closing" : "",
      ]
        .filter(Boolean)
        .join(" ");
      if (this.panel.className !== nextClassName) {
        this.panel.className = nextClassName;
      }
      if (this.menu) {
        const nextMenuClassName = [
          `${SCRIPT_PREFIX}-menu`,
          this.getTheme(),
          isOpen ? "open" : "",
          isClosing ? "closing" : "",
        ]
          .filter(Boolean)
          .join(" ");
        if (this.menu.className !== nextMenuClassName) {
          this.menu.className = nextMenuClassName;
        }
      }
      if (this.launcher) {
        this.launcher.setAttribute("aria-label", this.t("menu"));
        this.launcher.removeAttribute?.("title");
      }
      const hideMediaActionsForLive = Boolean(this.isCurrentLiveItem);
      if (this.downloadButtonEl) {
        this.downloadButtonEl.textContent = this.t("download");
        this.downloadButtonEl.hidden = hideMediaActionsForLive;
      }
      if (this.frameButtonEl) this.frameButtonEl.textContent = this.t("frame_capture");
      if (this.detailsButtonEl) {
        this.detailsButtonEl.textContent = this.t("details");
        this.detailsButtonEl.hidden = hideMediaActionsForLive;
      }
      if (this.settingsButtonEl) this.settingsButtonEl.textContent = this.t("settings");
      const showDebugItems = Boolean(config.show_debug_info_menu);
      if (this.debugInfoButtonEl) {
        this.debugInfoButtonEl.textContent = this.t("debug_info");
        this.debugInfoButtonEl.hidden = !showDebugItems;
      }
      const showTestItems = Boolean(config.show_test_notification_menu);
      for (const button of [
        this.testNoticeButtonEl,
        this.testBusyButtonEl,
        this.testAlbumButtonEl,
        this.testErrorButtonEl,
      ]) {
        if (button) button.hidden = !showTestItems;
      }
      if (this.imageDownloadButton) this.renderImageDownloadButton();
    }

    toggleMenu(force = null) {
      if (!this.panel) return;
      const isOpen = this.panel.classList.contains("open");
      const isClosing = this.panel.classList.contains("closing");
      const shouldOpen = force === null ? !isOpen || isClosing : Boolean(force);

      if (this.menuCloseTimer) {
        this.window.clearTimeout?.(this.menuCloseTimer);
        this.menuCloseTimer = null;
      }

      if (shouldOpen) {
        this.panel.classList.remove("closing");
        this.panel.classList.add("open");
        this.refreshMedia();
        this.applyPanelState();
        this.updatePanelMenuPosition();
        return;
      }

      if (!isOpen && !isClosing) return;
      this.panel.classList.add("open", "closing");
      this.applyPanelState();
      this.updatePanelMenuPosition();
      this.menuCloseTimer = this.window.setTimeout?.(() => {
        this.menuCloseTimer = null;
        this.panel?.classList.remove("open", "closing");
        this.applyPanelState();
        this.mountPanel();
        this.updatePanelMenuPosition();
      }, 170) || null;
    }

    clearPanelMenuPosition() {
      if (!this.menu) return;
      for (const property of ["left", "right", "top", "bottom"]) {
        this.menu.style[property] = "";
      }
      this.menu.style.position = "";
      this.menu.style.transform = "";
      delete this.menu.dataset.placement;
    }

    updatePanelMenuPosition() {
      if (!this.panel || !this.menu) return;
      this.clearPanelMenuPosition();
      if (!this.panel.classList.contains("open")) return;
      const panelRect = this.panel.getBoundingClientRect?.();
      const launcherRect = this.launcher?.getBoundingClientRect?.();
      const menuRect = this.menu.getBoundingClientRect?.();
      const placement = calculatePanelMenuPlacement({
        panelRect,
        launcherRect,
        menuWidth: menuRect?.width || 160,
        menuHeight: menuRect?.height || 320,
        viewportWidth: this.window.innerWidth || 0,
        viewportHeight: this.window.innerHeight || 0,
      });
      this.menu.style.position = "fixed";
      this.menu.style.left = `${Math.round(placement.left)}px`;
      this.menu.style.top = `${Math.round(placement.top)}px`;
      this.menu.style.right = "auto";
      this.menu.style.bottom = "auto";
      this.menu.style.transform = "none";
      this.menu.dataset.placement = placement.placement;
    }


    bindMenuOutsideClose() {
      if (this.outsideMenuBound) return;
      this.outsideMenuBound = true;
      this.document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") this.toggleMenu(false);
      });
      this.document.addEventListener("pointerdown", (event) => {
        if (!this.panel?.classList.contains("open")) return;
        const target = event.target;
        if (this.menu?.contains?.(target) || this.launcher?.contains?.(target)) return;
        this.toggleMenu(false);
      });
    }

    isOwnUiElement(element) {
      return Boolean(
        element &&
          (this.panel?.contains?.(element) ||
            this.menu?.contains?.(element) ||
            this.imageDownloadButton?.contains?.(element) ||
            element === this.panel ||
            element === this.menu ||
            element === this.imageDownloadButton)
      );
    }

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

    applyEmbeddedThemeVariables(resolveComputedColors) {
      const theme = this.getTheme();
      if (theme === "light") {
        this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-bg`, "rgb(241, 241, 241)");
        this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-color`, "rgb(22, 24, 35)");
        this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-hover-bg`, "rgb(232, 232, 232)");
        this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-radius`, "50%");
        this.panel.style.removeProperty(`--${SCRIPT_PREFIX}-action-backdrop-filter`);
        return;
      }
      if (theme === "dark") {
        this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-bg`, "hsla(0, 0%, 100%, 0.13)");
        this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-color`, "rgba(255, 255, 255, 0.9)");
        this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-hover-bg`, "hsla(0, 0%, 100%, 0.19)");
        this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-radius`, "50%");
        this.panel.style.removeProperty(`--${SCRIPT_PREFIX}-action-backdrop-filter`);
        return;
      }
      if (typeof this.window.getComputedStyle !== "function") return;
      const computed = resolveComputedColors?.();
      if (!computed) return;
      const palette = getEmbeddedLauncherPalette(computed.backgroundColor, computed.color);
      this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-bg`, palette.background);
      this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-color`, palette.color);
      this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-hover-bg`, palette.hoverBackground);
      if (computed.borderRadius) {
        this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-radius`, computed.borderRadius);
      } else {
        this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-radius`, "50%");
      }
      if (computed.backdropFilter && computed.backdropFilter !== "none") {
        this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-backdrop-filter`, computed.backdropFilter);
      } else {
        this.panel.style.removeProperty(`--${SCRIPT_PREFIX}-action-backdrop-filter`);
      }
    }

    getEmbeddedNativeButtonSample(host) {
      const nativeChildren = this.getNativeActionChildren(host);
      const sampleChildren = [
        ...nativeChildren.filter((child) => !isAvatarActionChild(child)),
        ...nativeChildren,
      ];
      let best = null;
      let bestScore = -Infinity;

      for (const child of sampleChildren) {
        if (!child || isAvatarActionChild(child)) continue;
        const action = getOfficialActionMetricElement(child);
        if (!action) continue;
        const actionRect = action.getBoundingClientRect?.();
        if (!actionRect || actionRect.width < 24 || actionRect.height < 32) continue;
        const visual = getBestSquareMetricElement(action) || getOfficialActionButtonCandidate(action) || action;
        const visualRect = visual?.getBoundingClientRect?.();
        if (!visualRect || visualRect.width < 20 || visualRect.height < 20) continue;
        const button = getOfficialActionButtonCandidate(action);
        const buttonRect = button?.getBoundingClientRect?.();
        const dataE2E = String(action.getAttribute?.("data-e2e") || "");
        const priority = /comment-icon/i.test(dataE2E)
          ? 12
          : /like-icon/i.test(dataE2E)
            ? 10
            : /favorite-icon/i.test(dataE2E)
              ? 8
              : /share-icon/i.test(dataE2E)
                ? 6
                : 0;
        const size = Math.max(visualRect.width, visualRect.height);
        const squarePenalty = Math.abs(visualRect.width - visualRect.height) * 6;
        const score = 260 + priority - squarePenalty - Math.abs(size - Math.min(48, Math.max(32, size))) * 0.5;
        if (score > bestScore) {
          bestScore = score;
          best = {
            child: action,
            action,
            visual,
            control: button || visual,
            styleElement: button || visual || action,
            childRect: actionRect,
            actionRect,
            controlRect: visualRect,
            visualRect,
            buttonRect,
          };
        }
      }
      if (best) return best;

      for (const child of sampleChildren) {
        if (!child || isAvatarActionChild(child)) continue;
        const control = getOfficialActionButtonCandidate(child);
        const controlRect = control?.getBoundingClientRect?.();
        if (!controlRect || controlRect.width < 28 || controlRect.height < 28) continue;
        const childRect = child?.getBoundingClientRect?.();
        const size = Math.max(controlRect.width, controlRect.height);
        const squarePenalty = Math.abs(controlRect.width - controlRect.height);
        const officialBonus = /(?:^|\s)tux-button__element|TUX|tux-button/i.test(String(control.className || "")) ? 40 : 0;
        const buttonBonus = control.tagName === "BUTTON" ? 16 : 0;
        const sizePenalty = Math.abs(size - 40);
        const oversizedPenalty = size > 64 ? 100 : 0;
        const score = 140 + officialBonus + buttonBonus - squarePenalty * 5 - sizePenalty - oversizedPenalty;
        if (score > bestScore) {
          bestScore = score;
          best = { child, action: child, visual: control, control, styleElement: control, childRect, actionRect: childRect, controlRect, visualRect: controlRect };
        }
      }
      return best;
    }

    applyOfficialEmbeddedButtonClass(nativeControl = null) {
      if (!this.launcher) return;
      const baseClass = `${SCRIPT_PREFIX}-launcher`;
      if (!nativeControl) {
        this.launcher.className = baseClass;
        return;
      }
      const nativeClassName = String(nativeControl.className || "");
      const nextClassName = mergeClassNames(nativeClassName, baseClass, `${SCRIPT_PREFIX}-official-launcher`);
      if (this.launcher.className !== nextClassName) {
        this.launcher.className = nextClassName;
      }
    }

    applyProfileDialogOfficialSkin(nativeControl = null) {
      const container = this.panel?.querySelector?.(`.${SCRIPT_PREFIX}-launcher-container`) || null;
      if (!container) return;
      const baseClass = `${SCRIPT_PREFIX}-launcher-container`;
      if (!nativeControl) {
        if (container.className !== baseClass) container.className = baseClass;
        return;
      }
      const nativeClassName = String(nativeControl.className || "");
      const nextClassName = mergeClassNames(baseClass, `${SCRIPT_PREFIX}-profile-official-skin`, nativeClassName);
      if (container.className !== nextClassName) {
        container.className = nextClassName;
      }
    }

    syncEmbeddedButtonMetrics(host) {
      if (!this.panel || !host) return;
      const sample = this.getEmbeddedNativeButtonSample(host);
      const nativeChild = sample?.child || null;
      const nativeControl = sample?.control || null;
      const styleElement = sample?.styleElement || nativeControl || nativeChild;
      const controlRect = sample?.controlRect || nativeControl?.getBoundingClientRect?.();
      const childRect = sample?.childRect || nativeChild?.getBoundingClientRect?.();

      const rawControlSize = controlRect ? Math.max(controlRect.width, controlRect.height) : 48;
      const controlSize = Math.round(clampNumber(rawControlSize, 28, 64, 48));
      const itemWidth = childRect
        ? Math.round(clampNumber(childRect.width || controlSize, controlSize, 88, controlSize))
        : controlSize;
      const itemHeight = childRect
        ? Math.round(clampNumber(childRect.height || controlSize * 1.625, controlSize, 104, Math.round(controlSize * 1.625)))
        : Math.round(controlSize * 1.625);
      const iconSize = Math.round(clampNumber(controlSize * 0.62, 18, 28, Math.round(controlSize * 0.55)));

      this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-size`, `${controlSize}px`);
      this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-item-width`, `${itemWidth}px`);
      this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-item-height`, `${itemHeight}px`);
      this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-icon-size`, `${iconSize}px`);
      this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-icon-offset-y`, "0px");
      this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-gap`, "0px");
      this.applyProfileDialogOfficialSkin(null);
      this.applyOfficialEmbeddedButtonClass(nativeControl);

      const nativeStyle = getComputedStyleSafe(this.window, styleElement);
      if (nativeStyle) {
        const buttonPadding = getStyleValue(nativeStyle, ["padding"]);
        const buttonRadius = getStyleValue(nativeStyle, ["borderRadius", "border-radius"]);
        const buttonBackground = getStyleValue(nativeStyle, ["backgroundColor", "background-color"]);
        if (buttonPadding) this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-button-padding`, buttonPadding);
        if (buttonRadius) this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-button-radius`, buttonRadius);
        if (buttonBackground) this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-button-bg`, buttonBackground);
      }
      this.applyEmbeddedThemeVariables(() => {
        if (!styleElement) return null;
        return getElementActionStyleSample(this.window, [styleElement, nativeControl, nativeChild]);
      });
    }

    clearEmbeddedButtonMetrics() {
      if (!this.panel) return;
      this.panel.style.removeProperty(`--${SCRIPT_PREFIX}-action-size`);
      this.panel.style.removeProperty(`--${SCRIPT_PREFIX}-action-icon-size`);
      this.panel.style.removeProperty(`--${SCRIPT_PREFIX}-action-icon-offset-y`);
      this.panel.style.removeProperty(`--${SCRIPT_PREFIX}-action-item-width`);
      this.panel.style.removeProperty(`--${SCRIPT_PREFIX}-action-item-height`);
      this.panel.style.removeProperty(`--${SCRIPT_PREFIX}-action-gap`);
      this.panel.style.removeProperty(`--${SCRIPT_PREFIX}-action-button-padding`);
      this.panel.style.removeProperty(`--${SCRIPT_PREFIX}-action-button-radius`);
      this.panel.style.removeProperty(`--${SCRIPT_PREFIX}-action-button-bg`);
      this.applyOfficialEmbeddedButtonClass(null);
      this.applyProfileDialogOfficialSkin(null);
      this.panel.style.removeProperty(`--${SCRIPT_PREFIX}-action-bg`);
      this.panel.style.removeProperty(`--${SCRIPT_PREFIX}-action-color`);
      this.panel.style.removeProperty(`--${SCRIPT_PREFIX}-action-hover-bg`);
      this.panel.style.removeProperty(`--${SCRIPT_PREFIX}-action-radius`);
      this.panel.style.removeProperty(`--${SCRIPT_PREFIX}-action-backdrop-filter`);
    }

    applyProfileDialogButtonTheme(anchorElement = null) {
      if (!this.panel) return;
      const anchorStyle = getComputedStyleSafe(this.window, anchorElement);
      const anchorBg = getStyleValue(anchorStyle, ["backgroundColor", "background-color"]);
      const anchorColor = getStyleValue(anchorStyle, ["color"]);
      const anchorRadius = getStyleValue(anchorStyle, ["borderRadius", "border-radius"]);
      const anchorBackdropFilter = getStyleValue(anchorStyle, ["backdropFilter", "-webkit-backdrop-filter"]);
      const bg = anchorBg && anchorBg !== "transparent" && !/^rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/i.test(anchorBg)
        ? anchorBg
        : "rgba(84, 84, 84, 0.5)";
      const color = anchorColor || "rgb(255, 255, 255)";
      this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-bg`, bg);
      this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-color`, color);
      this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-hover-bg`, bg);
      this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-radius`, anchorRadius || "100px");
      if (anchorBackdropFilter && anchorBackdropFilter !== "none") {
        this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-backdrop-filter`, anchorBackdropFilter);
      } else {
        this.panel.style.removeProperty(`--${SCRIPT_PREFIX}-action-backdrop-filter`);
      }
      this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-button-bg`, "transparent");
      this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-button-radius`, "0px");
      this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-button-padding`, "0px");
    }

    syncProfileDialogButtonMetrics(anchorElement) {
      if (!this.panel || !anchorElement) return;
      const rect = anchorElement.getBoundingClientRect?.();
      const rawSize = rect ? Math.max(rect.width, rect.height) : 40;
      const controlSize = Math.round(clampNumber(rawSize, 32, 56, 40));
      const iconSize = Math.round(clampNumber(controlSize * 0.56, 18, 28, 22));
      this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-size`, `${controlSize}px`);
      this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-icon-size`, `${iconSize}px`);
      this.panel.style.setProperty(`--${SCRIPT_PREFIX}-action-icon-offset-y`, "0px");
      this.applyOfficialEmbeddedButtonClass(null);
      this.applyProfileDialogButtonTheme(anchorElement);
      this.applyProfileDialogOfficialSkin(anchorElement);
    }

    getCurrentPageType() {
      return getTikTokPageType(this.window.location, this.document);
    }

    shouldEmbedPanelInActionBar(pageType = this.getCurrentPageType()) {
      return pageType === "recommend";
    }

    clearPanelFixedPosition() {
      if (!this.panel?.style) return;
      for (const property of ["left", "right", "top", "bottom"]) {
        this.panel.style[property] = "auto";
      }
    }

    mountPanelInActionBar(host) {
      if (!this.panel || !host) return false;
      if (this.menu && this.menu.parentElement !== this.document.body) {
        this.document.body.appendChild(this.menu);
      }
      const reference = this.getActionBarInsertionReference(host);
      if (this.panel.parentElement !== host || this.panel.nextSibling !== reference) {
        host.insertBefore(this.panel, reference || host.firstChild);
      }
      this.currentPlacementMode = "recommend";
      this.currentActionBarHost = host;
      this.currentActionBarContext = this.findActionBarPositionContext();
      this.panel.classList.remove("pending", "profile-dialog");
      this.panel.classList.add("embedded");
      this.clearPanelFixedPosition();
      this.syncEmbeddedButtonMetrics(host);
      this.updatePanelMenuPosition();
      return true;
    }

    mountPanelNearProfileBrowseEllipsis(dialog, ellipsis) {
      if (!this.panel || !dialog || !ellipsis) return false;
      if (this.panel.parentElement !== this.document.body) {
        this.document.body.appendChild(this.panel);
      }
      if (this.menu && this.menu.parentElement !== this.document.body) {
        this.document.body.appendChild(this.menu);
      }
      const rect = ellipsis.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) return false;
      const size = Math.round(clampNumber(Math.max(rect.width, rect.height), 32, 56, 40));
      const margin = 8;
      const viewportWidth = this.window.innerWidth || 0;
      const viewportHeight = this.window.innerHeight || 0;
      const preferredLeft = rect.left - size - margin;
      const fallbackLeft = rect.right + margin;
      const left = preferredLeft >= margin
        ? preferredLeft
        : Math.min(Math.max(fallbackLeft, margin), Math.max(margin, viewportWidth - size - margin));
      const top = clampNumber(rect.top + rect.height / 2 - size / 2, margin, Math.max(margin, viewportHeight - size - margin), rect.top);

      this.currentPlacementMode = "profile-dialog";
      this.currentActionBarHost = null;
      this.currentActionBarContext = { anchor: dialog, anchorRect: this.getElementRect(ellipsis), host: null };
      this.panel.classList.remove("pending", "embedded");
      this.panel.classList.add("profile-dialog");
      this.panel.style.left = `${Math.round(left)}px`;
      this.panel.style.top = `${Math.round(top)}px`;
      this.panel.style.right = "auto";
      this.panel.style.bottom = "auto";
      this.syncProfileDialogButtonMetrics(ellipsis);
      this.updatePanelMenuPosition();
      return true;
    }

    hidePanelForInactivePlacement() {
      if (!this.panel) return;
      if (this.panel.parentElement !== this.document.body) {
        this.document.body.appendChild(this.panel);
      }
      if (this.menu && this.menu.parentElement !== this.document.body) {
        this.document.body.appendChild(this.menu);
      }
      this.currentPlacementMode = "inactive";
      this.currentActionBarHost = null;
      this.currentActionBarContext = null;
      this.clearEmbeddedButtonMetrics();
      this.panel.classList.add("pending");
      this.panel.classList.remove("embedded", "profile-dialog", "open", "closing");
      this.clearPanelMenuPosition();
    }

    mountPanel() {
      if (!this.panel) return;

      const pageType = this.getCurrentPageType();

      if (pageType === "profile-dialog") {
        this.profilePageBulkAdapter?.suspend?.();
        this.profileBrowseDialogAdapter?.mount?.();
        return;
      }

      if (pageType === "profile") {
        this.recommendPlacementAdapter?.unmount?.();
        this.profileBrowseDialogAdapter?.unmount?.();
        this.hidePanelForInactivePlacement();
        this.profilePageBulkAdapter?.mount?.();
        return;
      }

      this.profilePageBulkAdapter?.unmount?.();

      if (!this.shouldEmbedPanelInActionBar(pageType)) {
        this.recommendPlacementAdapter?.unmount?.();
        this.profileBrowseDialogAdapter?.unmount?.();
        return;
      }

      if (this.openImageOverlay) {
        this.hidePanelForInactivePlacement();
        return;
      }

      this.recommendPlacementAdapter?.mount?.();
    }

    updatePanelPosition(_actionContext = null) {
      if (!this.panel) return;
      this.mountPanel();
    }

    getCurrentActionAnchor() {
      if (this.currentPlacementMode === "profile-dialog") return null;
      return this.actionBarLocator.getCurrentActionAnchor();
    }

    getCurrentLiveContextText(anchorElement = null) {
      const visibleMedia = this.extractor?.getVisibleMediaElement?.() || null;
      const visibleVideo = this.extractor?.getVisibleVideoElement?.() || null;
      const actionContext = this.currentActionBarContext || null;
      const context =
        this.extractor?.getMediaContextElement?.(anchorElement) ||
        this.extractor?.getMediaContextElement?.(visibleMedia) ||
        this.extractor?.getMediaContextElement?.(visibleVideo) ||
        null;
      const actionText = unique([
        anchorElement?.textContent || "",
        this.currentActionBarHost?.textContent || "",
        actionContext?.anchor?.textContent || "",
        actionContext?.host?.textContent || "",
      ]).join(" ");
      const contextText = unique([
        context?.textContent || "",
        visibleMedia?.parentElement?.textContent || "",
        visibleVideo?.parentElement?.textContent || "",
      ]).join(" ");
      return { actionText, contextText };
    }

    isCurrentLiveContext(anchorElement = null) {
      if (this.getCurrentPageType() === "live") return true;
      const { actionText, contextText } = this.getCurrentLiveContextText(anchorElement);
      return isLikelyLiveContextText(actionText, contextText);
    }

    refreshMedia() {
      this.mountPanel();
      const anchor = this.getCurrentActionAnchor();
      this.isCurrentLiveItem = this.isCurrentLiveContext(anchor);
      if (this.isCurrentLiveItem) {
        this.currentMedia = null;
        return null;
      }
      const requireContext =
        this.panel?.classList.contains("embedded") && this.currentPlacementMode !== "profile-dialog";
      this.currentMedia = this.extractor.getCurrentMedia(
        this.configStore.get(),
        anchor,
        { requireContext },
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
      const extension = normalizeFileExtension(suffix, "mp4");
      return extension ? `${base}.${extension}` : base;
    }

    getImageFilename(media, image = {}, index = 0) {
      const config = this.configStore.get();
      const base = buildFilename(media, config);
      const url = String(image.url || "");
      const extension = normalizeFileExtension(
        url.match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i)?.[1],
        "jpg",
      );
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
          {
            requireContext:
              this.panel?.classList.contains("embedded") && this.currentPlacementMode !== "profile-dialog",
          },
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

    summarizeElementForDebug(element = null) {
      if (!element) return null;
      const rect = toPlainRect(element.getBoundingClientRect?.());
      return {
        tag: String(element.tagName || "").toLowerCase(),
        id: element.id || "",
        className: String(element.className || "").slice(0, 240),
        dataE2e: element.getAttribute?.("data-e2e") || "",
        href: element.href || element.getAttribute?.("href") || "",
        src: element.currentSrc || element.src || element.getAttribute?.("src") || "",
        poster: element.poster || element.getAttribute?.("poster") || "",
        rect,
        text: String(element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 320),
      };
    }

    summarizeComputedStyleForDebug(element = null) {
      if (!element) return null;
      const style = getComputedStyleSafe(this.window, element);
      if (!style) return null;
      const svg = element.querySelector?.("svg") || null;
      const svgStyle = getComputedStyleSafe(this.window, svg);
      const path = element.querySelector?.("svg path") || null;
      const pathStyle = getComputedStyleSafe(this.window, path);
      return {
        element: this.summarizeElementForDebug(element),
        style: {
          display: getStyleValue(style, ["display"]),
          position: getStyleValue(style, ["position"]),
          backgroundColor: getStyleValue(style, ["backgroundColor", "background-color"]),
          color: getStyleValue(style, ["color"]),
          opacity: getStyleValue(style, ["opacity"]),
          border: getStyleValue(style, ["border"]),
          borderRadius: getStyleValue(style, ["borderRadius", "border-radius"]),
          boxShadow: getStyleValue(style, ["boxShadow", "box-shadow"]),
          filter: getStyleValue(style, ["filter"]),
          backdropFilter: getStyleValue(style, ["backdropFilter", "backdrop-filter", "webkitBackdropFilter", "-webkit-backdrop-filter"]),
          mixBlendMode: getStyleValue(style, ["mixBlendMode", "mix-blend-mode"]),
          padding: getStyleValue(style, ["padding"]),
          margin: getStyleValue(style, ["margin"]),
          width: getStyleValue(style, ["width"]),
          height: getStyleValue(style, ["height"]),
        },
        cssVars: {
          "--ui-shape-neutral-3": style.getPropertyValue?.("--ui-shape-neutral-3") || "",
          "--ui-shape-neutral-4": style.getPropertyValue?.("--ui-shape-neutral-4") || "",
          "--tux-colorBGInput": style.getPropertyValue?.("--tux-colorBGInput") || "",
          "--tux-colorTextPrimary": style.getPropertyValue?.("--tux-colorTextPrimary") || "",
          "--tux-colorBGSecondary": style.getPropertyValue?.("--tux-colorBGSecondary") || "",
        },
        svg: svg ? {
          className: String(svg.className || ""),
          width: svg.getAttribute?.("width") || "",
          height: svg.getAttribute?.("height") || "",
          fillAttr: svg.getAttribute?.("fill") || "",
          strokeAttr: svg.getAttribute?.("stroke") || "",
          computed: svgStyle ? {
            color: getStyleValue(svgStyle, ["color"]),
            fill: getStyleValue(svgStyle, ["fill"]),
            stroke: getStyleValue(svgStyle, ["stroke"]),
            opacity: getStyleValue(svgStyle, ["opacity"]),
          } : null,
        } : null,
        path: path ? {
          fillAttr: path.getAttribute?.("fill") || "",
          strokeAttr: path.getAttribute?.("stroke") || "",
          computed: pathStyle ? {
            color: getStyleValue(pathStyle, ["color"]),
            fill: getStyleValue(pathStyle, ["fill"]),
            stroke: getStyleValue(pathStyle, ["stroke"]),
            opacity: getStyleValue(pathStyle, ["opacity"]),
          } : null,
        } : null,
      };
    }

    collectActionStyleDebugSamples(host = null) {
      const rootElement = host || this.document;
      const selectors = `${RECOMMEND_ACTION_METRIC_SELECTOR}, button[class*="tux-button__element"]`;
      const seen = new Set();
      return Array.from(rootElement?.querySelectorAll?.(selectors) || [])
        .filter((element) => {
          if (!element || seen.has(element)) return false;
          seen.add(element);
          const rect = element.getBoundingClientRect?.();
          return rect && rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= (this.window.innerHeight || 0);
        })
        .slice(0, 12)
        .map((element) => this.summarizeComputedStyleForDebug(element));
    }

    summarizeLocatorRectForDebug(rect = null) {
      if (!rect) return null;
      const plain = toPlainRect(rect);
      if (!plain) return null;
      return {
        ...plain,
        centerX: Number.isFinite(Number(rect.centerX)) ? Number(rect.centerX) : plain.left + plain.width / 2,
        centerY: Number.isFinite(Number(rect.centerY)) ? Number(rect.centerY) : plain.top + plain.height / 2,
        element: this.summarizeElementForDebug(rect.element),
      };
    }

    stringifyDebugInfo(data) {
      const seen = new WeakSet();
      const ElementCtor = this.window?.Element;
      return JSON.stringify(
        data,
        (key, value) => {
          if (ElementCtor && value instanceof ElementCtor) {
            return this.summarizeElementForDebug(value);
          }
          if (value && typeof value === "object") {
            if (seen.has(value)) return "[Circular]";
            seen.add(value);
          }
          if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
          return value;
        },
        2,
      );
    }

    summarizeMediaForDebug(media = null) {
      if (!media) return null;
      return {
        id: media.id || "",
        pageUrl: media.pageUrl || "",
        shareUrl: media.shareUrl || "",
        isImagePost: Boolean(media.isImagePost),
        imageCount: ensureArray(media.images).length,
        hasVideoPrimaryUrl: Boolean(media.video?.primaryUrl),
        videoSourceCount: ensureArray(media.video?.sources).length,
        author: {
          uniqueId: media.author?.uniqueId || "",
          nickname: media.author?.nickname || "",
        },
        desc: String(media.desc || "").slice(0, 240),
        firstImageUrl: ensureArray(media.images)[0]?.url || "",
        videoQuality: media.video?.quality || "",
      };
    }

    collectFullDebugInfo() {
      return {
        version: "debug-full-v3",
        capturedAt: new Date().toISOString(),
        url: this.window.location?.href || "",
        pageType: this.getCurrentPageType(),
        currentPlacementMode: this.currentPlacementMode,
        viewport: {
          width: this.window.innerWidth || 0,
          height: this.window.innerHeight || 0,
          scrollY: this.window.scrollY || 0,
        },
        panel: {
          className: this.panel?.className || "",
          open: Boolean(this.panel?.classList.contains("open")),
          pending: Boolean(this.panel?.classList.contains("pending")),
          embedded: Boolean(this.panel?.classList.contains("embedded")),
          profileDialog: Boolean(this.panel?.classList.contains("profile-dialog")),
          rect: this.summarizeElementForDebug(this.panel)?.rect || null,
        },
        selectedMedia: this.summarizeMediaForDebug(this.currentMedia),
        actionAnchor: this.summarizeElementForDebug(this.getCurrentActionAnchor()),
        profileBulk: this.profilePageBulkAdapter?.getDebugSnapshot?.() || null,
      };
    }

    collectDebugInfo() {
      return this.collectFullDebugInfo();
    }

    copyTextToClipboard(value = "", successMessage = "") {
      const text = String(value || "");
      if (!text) return;
      try {
        const result = this.window.navigator.clipboard?.writeText(text);
        if (result?.catch) result.catch(() => {});
        this.toast(successMessage || this.t("copied"));
      } catch (_err) {
        this.toast(text);
      }
    }

    copyDebugInfo(kind = "media") {
      let json = "";
      try {
        json = this.stringifyDebugInfo(this.collectDebugInfo(kind));
        const writeText = this.window.navigator.clipboard?.writeText;
        if (typeof writeText !== "function") {
          this.toast(json);
          return;
        }
        const result = writeText.call(this.window.navigator.clipboard, json);
        if (result?.catch) {
          result
            .then(() => this.toast(this.t("debug_info_copied"), { detail: this.t("debug_info_copied_detail") }))
            .catch(() => this.toast(json));
          return;
        }
        this.toast(this.t("debug_info_copied"), { detail: this.t("debug_info_copied_detail") });
      } catch (err) {
        const message = err?.message ? String(err.message) : String(err || "");
        this.toast(`${this.t("debug_info_copied")}: ${message}`);
      }
    }


    async downloadVideo(anchorElement = null) {
      if (this.isDownloading) {
        this.nudgeDownloadStatus();
        return;
      }
      this.captureToastAnchor(anchorElement || this.downloadButtonEl || this.launcher);
      this.isDownloading = true;
      this.showDownloadPreparing();

      try {
        const media = await this.waitForCurrentMedia();
        const images = ensureArray(media?.images).filter((image) => image?.url);
        if (!media?.video?.primaryUrl && images.length) {
          let lastFilename = "";
          let successCount = 0;
          const failures = [];
          for (const [index, image] of images.entries()) {
            const filename = this.getImageFilename(media, image, index);
            lastFilename = filename;
            this.showAlbumProgress(index + 1, images.length, filename);
            try {
              await this.downloader.downloadUrl(
                unique([image.url, ...ensureArray(image.fallbackUrls)]),
                filename,
              );
              successCount += 1;
            } catch (err) {
              failures.push({ index: index + 1, filename, message: err?.message || String(err) });
            }
          }
          if (!failures.length) {
            this.showDownloadSuccess(lastFilename);
          } else if (successCount > 0) {
            this.showDownloadError(
              `${this.t("download_album")}: ${successCount}/${images.length}, ${this.t("download_failed")}: ${failures.length}`,
            );
          } else {
            this.showDownloadError(failures[0]?.message || this.t("download_failed"));
          }
          return;
        }
        if (!media?.video?.primaryUrl) {
          this.showDownloadError(this.t("no_media"));
          return;
        }
        const filename = this.getFilename(media, media.video.format || "mp4");
        const urls = [media.video.primaryUrl, ...media.video.fallbackUrls];
        this.showVideoPreparing(filename);
        try {
          await this.downloader.downloadUrl(urls, filename);
          this.showDownloadSuccess(filename);
        } catch (err) {
          this.showDownloadError(err?.message || String(err));
        }
      } finally {
        this.isDownloading = false;
      }
    }

    async downloadAsset(url, filename, anchorElement = null) {
      if (this.isDownloading) {
        this.nudgeDownloadStatus();
        return;
      }
      this.captureToastAnchor(anchorElement || this.downloadButtonEl || this.launcher);
      this.isDownloading = true;

      try {
        const urls = unique(ensureArray(url));
        if (!urls.length) {
          this.showDownloadError(this.t("asset_empty"));
          return;
        }
        this.showImageDownloading(filename);
        try {
          await this.downloader.downloadUrl(urls, filename);
          this.showDownloadSuccess(filename);
        } catch (err) {
          this.showDownloadError(err?.message || String(err));
        }
      } finally {
        this.isDownloading = false;
      }
    }

    getOverlayImageFilename(media, url) {
      const config = this.configStore.get();
      const base = buildFilename(media || {}, config) || `tiktok_${Date.now()}`;
      const extension = normalizeFileExtension(
        String(url).match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i)?.[1],
        "jpg",
      );
      return normalizeFilename(`${base}_comment_image.${extension}`, {
        maxLength: Number(config.filename_max_length || DEFAULT_CONFIG.filename_max_length) + 20,
      });
    }

    async downloadOverlayImage() {
      if (this.isDownloading) {
        this.nudgeDownloadStatus();
        return;
      }
      this.captureToastAnchor(this.imageDownloadButton || this.downloadButtonEl || this.launcher);
      this.isDownloading = true;

      try {
        const overlay = this.openImageOverlay;
        if (!overlay?.imageUrl) {
          this.showDownloadError(this.t("asset_empty"));
          return;
        }
        const media = this.currentMedia || {};
        const filename = this.getOverlayImageFilename(media, overlay.imageUrl);
        this.showImageDownloading(filename);
        try {
          await this.downloader.downloadUrl(overlay.imageUrl, filename);
          this.showDownloadSuccess(filename);
        } catch (err) {
          this.showDownloadError(err?.message || String(err));
        }
      } finally {
        this.isDownloading = false;
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
      try {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
      } catch (err) {
        throw new Error(`Canvas draw failed: ${err?.message || err}`);
      }
      const blob = await new Promise((resolve, reject) => {
        try {
          canvas.toBlob((value) => resolve(value), "image/png");
        } catch (err) {
          reject(err);
        }
      });
      if (!blob) {
        throw new Error(
          "Canvas export failed. The video may be blocked by browser cross-origin restrictions.",
        );
      }
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
      if (this.isCapturingFrame) return;
      this.isCapturingFrame = true;

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
      } finally {
        this.isCapturingFrame = false;
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
        const button = makePillButton(label, () => this.downloadAsset(urls, filename, button));
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


    getProfileBulkTaskDelayMs() {
      return 1500 + Math.floor(Math.random() * 501);
    }

    formatTemplateMessage(key, values = {}) {
      let text = this.t(key);
      for (const [name, value] of Object.entries(values)) {
        text = text.replaceAll("${" + name + "}", String(value));
      }
      return text;
    }

    formatBulkItemCount(count) {
      return String(count);
    }

    formatBulkProgressCount(index, total) {
      return `${index}/${total}`;
    }

    showBulkDownloadProgress(index, total, detail = "") {
      this.setDownloadStatus({
        type: "busy",
        title: `${this.t("bulk_downloading")} ${this.formatBulkProgressCount(index, total)}`,
        detail,
        spinner: false,
      });
    }

    resolveProfileBulkMedia(item = {}) {
      const config = this.configStore.get();
      const pageUrl = item.pageUrl || item.href || "";
      const dataCandidates = [
        parsePageDataFromDocument(this.document),
        ...getWindowDataCandidates(this.window),
      ].filter(Boolean);
      for (const data of dataCandidates) {
        const media = extractMediaFromPageData(data, pageUrl, config);
        if (hasUsableMedia(media)) return media;
      }
      const cached = this.runtimeCache?.getMedia?.(pageUrl, config);
      if (hasUsableMedia(cached)) return cached;
      return null;
    }

    async downloadResolvedMedia(media, item = {}, context = {}) {
      const images = ensureArray(media?.images).filter((image) => image?.url);
      if (!media?.video?.primaryUrl && images.length) {
        let successCount = 0;
        const failures = [];
        for (const [index, image] of images.entries()) {
          const filename = this.getImageFilename(media, image, index);
          this.showBulkDownloadProgress(
            context.index || 1,
            context.total || 1,
            `${this.t("bulk_type_album")} ${index + 1}/${images.length} · ${filename}`,
          );
          try {
            await this.downloader.downloadUrl(
              unique([image.url, ...ensureArray(image.fallbackUrls)]),
              filename,
            );
            successCount += 1;
          } catch (err) {
            failures.push(err?.message || String(err));
          }
          if (index < images.length - 1) await this.wait(500);
        }
        if (successCount > 0) return { ok: true, filename: `${successCount}/${images.length}` };
        return { ok: false, message: failures[0] || this.t("download_failed") };
      }
      if (!media?.video?.primaryUrl) {
        return { ok: false, message: this.t("no_media") };
      }
      const filename = this.getFilename(media, media.video.format || "mp4");
      await this.downloader.downloadUrl([media.video.primaryUrl, ...ensureArray(media.video.fallbackUrls)], filename);
      return { ok: true, filename };
    }

    async downloadProfileBulkItems(items = []) {
      const queue = ensureArray(items).filter(Boolean);
      if (!queue.length) {
        this.toast(this.t("bulk_no_selection"));
        return;
      }
      if (this.isDownloading) {
        this.nudgeDownloadStatus();
        return;
      }
      this.isDownloading = true;
      const failures = [];
      let success = 0;
      try {
        for (let index = 0; index < queue.length; index += 1) {
          const item = queue[index];
          if (index > 0) await this.wait(this.getProfileBulkTaskDelayMs());
          this.showBulkDownloadProgress(index + 1, queue.length, item.desc || item.pageUrl || item.id || "");
          try {
            const media = this.resolveProfileBulkMedia(item);
            if (!hasUsableMedia(media)) {
              failures.push({ item, message: this.t("no_media") });
              continue;
            }
            const result = await this.downloadResolvedMedia(media, item, {
              index: index + 1,
              total: queue.length,
            });
            if (result?.ok) success += 1;
            else failures.push({ item, message: result?.message || this.t("download_failed") });
          } catch (err) {
            failures.push({ item, message: err?.message || String(err) });
          }
        }
        const detail = this.formatTemplateMessage("bulk_download_result", {
          success,
          failed: failures.length,
        });
        if (failures.length) {
          this.setDownloadStatus({
            type: success > 0 ? "error" : "error",
            title: this.t("bulk_download_done"),
            detail,
          });
        } else {
          this.setDownloadStatus({
            type: "success",
            title: this.t("bulk_download_done"),
            detail,
            autoHideMs: 3500,
          });
        }
      } finally {
        this.isDownloading = false;
      }
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
      const settingsTitle = createElement(this.document, "h2", `${SCRIPT_PREFIX}-settings-title`, this.t("settings"));
      header.appendChild(settingsTitle);
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

      const profileCheckboxSizeWrapper = createElement(this.document, "div", `${SCRIPT_PREFIX}-field ${SCRIPT_PREFIX}-profile-slider-field`);
      const profileCheckboxSizeHead = createElement(this.document, "div", `${SCRIPT_PREFIX}-profile-slider-head`);
      const profileCheckboxSizeLabel = createElement(this.document, "label", "", this.t("profile_bulk_checkbox_size"));
      const profileCheckboxSizeDesc = createElement(
        this.document,
        "span",
        `${SCRIPT_PREFIX}-profile-slider-desc`,
        this.t("tooltip_profile_bulk_checkbox_size"),
      );
      const profileCheckboxSizeValue = createElement(this.document, "span", `${SCRIPT_PREFIX}-profile-slider-value`);
      const profileCheckboxSize = createElement(this.document, "input");
      profileCheckboxSize.type = "range";
      profileCheckboxSize.dataset.configKey = "profile_bulk_checkbox_size";
      profileCheckboxSize.min = "18";
      profileCheckboxSize.max = "40";
      profileCheckboxSize.step = "2";
      profileCheckboxSize.value = String(config.profile_bulk_checkbox_size ?? DEFAULT_CONFIG.profile_bulk_checkbox_size);
      const updateProfileCheckboxSizeValue = () => {
        profileCheckboxSizeValue.textContent = `${Math.round(clampNumber(Number(profileCheckboxSize.value), 18, 40, DEFAULT_CONFIG.profile_bulk_checkbox_size))}px`;
      };
      profileCheckboxSize.addEventListener("input", updateProfileCheckboxSizeValue);
      updateProfileCheckboxSizeValue();
      profileCheckboxSizeHead.append(profileCheckboxSizeLabel, profileCheckboxSizeDesc, profileCheckboxSizeValue);
      profileCheckboxSizeWrapper.append(profileCheckboxSizeHead, profileCheckboxSize);
      profileCheckboxSize.wrapper = profileCheckboxSizeWrapper;
      const profileBulkGrid = createElement(this.document, "div", `${SCRIPT_PREFIX}-settings-grid`);
      profileBulkGrid.append(profileCheckboxSize.wrapper);

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

      const makeLeftCheckbox = (labelText, key, checked) => {
        const wrapper = createElement(this.document, "div", `${SCRIPT_PREFIX}-field ${SCRIPT_PREFIX}-check-left`);
        const label = createElement(this.document, "label");
        const input = createElement(this.document, "input");
        input.type = "checkbox";
        input.dataset.configKey = key;
        input.checked = Boolean(checked);
        label.append(input, createElement(this.document, "span", "", labelText));
        wrapper.appendChild(label);
        input.wrapper = wrapper;
        return input;
      };
      const advancedGrid = createElement(this.document, "div", `${SCRIPT_PREFIX}-advanced-grid`);
      const showTestMenu = makeLeftCheckbox(
        this.t("show_test_notification_menu"),
        "show_test_notification_menu",
        config.show_test_notification_menu,
      );
      const showDebugInfoMenu = makeLeftCheckbox(
        this.t("show_debug_info_menu"),
        "show_debug_info_menu",
        config.show_debug_info_menu,
      );
      advancedGrid.append(showTestMenu.wrapper, showDebugInfoMenu.wrapper);
      const advancedFieldset = makeFieldset(this.t("advanced_section"), advancedGrid);
      advancedFieldset.hidden = true;
      let settingsTitleClickCount = 0;
      let settingsTitleClickTimer = null;
      settingsTitle.addEventListener("click", () => {
        settingsTitleClickCount += 1;
        if (settingsTitleClickTimer) this.window.clearTimeout?.(settingsTitleClickTimer);
        settingsTitleClickTimer = this.window.setTimeout?.(() => {
          settingsTitleClickCount = 0;
          settingsTitleClickTimer = null;
        }, 1500) || null;
        if (settingsTitleClickCount >= 5) {
          advancedFieldset.hidden = false;
          settingsTitleClickCount = 0;
        }
      });

      main.append(
        makeFieldset(this.t("appearance_section"), appearanceGrid),
        makeFieldset(this.t("download_section"), downloadGrid),
        makeFieldset(this.t("profile_bulk_section"), profileBulkGrid),
        makeFieldset(this.t("filename_section"), filenameGrid),
        makeFieldset(this.t("shortcut_section"), shortcutGrid),
        advancedFieldset,
      );

      headerActions.append(
        this.actionButton(this.t("save"), () => {
          const formValues = {};
          modal.querySelectorAll("[data-config-key]").forEach((input) => {
            formValues[input.dataset.configKey] = input.value;
          });
          formValues.show_test_notification_menu = Boolean(showTestMenu.checked);
          formValues.show_debug_info_menu = Boolean(showDebugInfoMenu.checked);
          formValues.filename_max_length = Number(formValues.filename_max_length || 80);
          formValues.profile_bulk_checkbox_size = clampNumber(
            Number(formValues.profile_bulk_checkbox_size),
            18,
            40,
            DEFAULT_CONFIG.profile_bulk_checkbox_size,
          );
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

    captureToastAnchor(element) {
      const rect = toPlainRect(element?.getBoundingClientRect?.());
      if (!rect || rect.width <= 0 || rect.height <= 0) return null;
      this.lastToastAnchorRect = rect;
      this.lastToastAnchorAt = Date.now();
      return rect;
    }

    getNotificationStackElement() {
      if (this.notificationStackEl?.isConnected) return this.notificationStackEl;
      const stack = createElement(this.document, "div", `${SCRIPT_PREFIX}-notification-stack`);
      this.document.body.appendChild(stack);
      this.notificationStackEl = stack;
      return stack;
    }

    updateNotificationStackLayout() {
      const stack = this.notificationStackEl;
      if (!stack?.isConnected) return;
      const cards = Array.from(stack.querySelectorAll(`.${SCRIPT_PREFIX}-notification-card`));
      let expandedY = 0;
      let collapsedHeight = 0;
      const gap = 6;
      cards.forEach((card, index) => {
        const depth = Math.min(index, 5);
        const height = Math.max(68, Math.round(card.offsetHeight || card.getBoundingClientRect?.().height || 78));
        const collapsedY = depth * 7;
        card.style.zIndex = String(1000 - index);
        card.style.setProperty(`--${SCRIPT_PREFIX}-stack-y`, `${collapsedY}px`);
        card.style.setProperty(`--${SCRIPT_PREFIX}-stack-expanded-y`, `${expandedY}px`);
        card.style.setProperty(`--${SCRIPT_PREFIX}-stack-scale`, String(1 - depth * 0.026));
        card.style.setProperty(`--${SCRIPT_PREFIX}-stack-opacity`, String(index > 5 ? 0 : 1 - depth * 0.06));
        expandedY += height + gap;
        collapsedHeight = Math.max(collapsedHeight, height + collapsedY);
      });
      const expandedHeight = Math.max(92, Math.min(expandedY, (this.window.innerHeight || 720) - 92));
      stack.style.setProperty(`--${SCRIPT_PREFIX}-notification-stack-collapsed-height`, `${Math.max(92, collapsedHeight)}px`);
      stack.style.setProperty(`--${SCRIPT_PREFIX}-notification-stack-expanded-height`, `${expandedHeight}px`);
      stack.style.setProperty(`--${SCRIPT_PREFIX}-notification-stack-height`, `${Math.max(92, collapsedHeight)}px`);
    }

    removeNotificationCard(card, { immediate = false } = {}) {
      if (!card) return;
      const remove = () => {
        card.remove();
        this.updateNotificationStackLayout();
      };
      if (immediate) {
        remove();
        return;
      }
      card.classList.add("fading");
      this.window.setTimeout?.(remove, 75);
    }

    createNotificationCard({ type = "info", title = "", detail = "", meta = "", iconText = "i", spinner = false, download = false } = {}) {
      const stack = this.getNotificationStackElement();
      const card = createElement(
        this.document,
        "div",
        `${SCRIPT_PREFIX}-notification-card${download ? ` ${SCRIPT_PREFIX}-download-status` : ""}`,
      );
      card.classList.add(this.getTheme(), type);
      card.dataset.notificationId = String(++this.notificationId);

      const icon = createElement(
        this.document,
        "div",
        download ? `${SCRIPT_PREFIX}-download-status-icon` : `${SCRIPT_PREFIX}-notification-icon`,
      );
      const main = createElement(
        this.document,
        "div",
        download ? `${SCRIPT_PREFIX}-download-status-main` : `${SCRIPT_PREFIX}-notification-main`,
      );
      const head = createElement(
        this.document,
        "div",
        download ? `${SCRIPT_PREFIX}-download-status-head` : `${SCRIPT_PREFIX}-notification-head`,
      );
      const titleEl = createElement(
        this.document,
        "div",
        download ? `${SCRIPT_PREFIX}-download-status-title` : `${SCRIPT_PREFIX}-notification-title`,
        title,
      );
      const metaEl = createElement(
        this.document,
        "div",
        download ? `${SCRIPT_PREFIX}-download-status-meta` : `${SCRIPT_PREFIX}-notification-meta`,
        meta,
      );
      const detailEl = createElement(
        this.document,
        "div",
        download ? `${SCRIPT_PREFIX}-download-status-detail` : `${SCRIPT_PREFIX}-notification-detail`,
        detail,
      );
      const close = createElement(
        this.document,
        "button",
        download ? `${SCRIPT_PREFIX}-download-status-close` : `${SCRIPT_PREFIX}-notification-close`,
        "×",
      );

      close.type = "button";
      close.setAttribute("aria-label", this.t("close"));
      close.addEventListener("click", () => this.removeNotificationCard(card));

      if (spinner) {
        icon.appendChild(createDownloadSpinner(this.document));
      } else {
        icon.textContent = iconText || "i";
      }

      head.append(titleEl, metaEl);
      main.append(head, detailEl);
      card.append(icon, main, close);
      stack.prepend(card);
      this.updateNotificationStackLayout();

      return { card, icon, titleEl, metaEl, detailEl };
    }

    getDownloadStatusElement() {
      if (this.downloadStatusEl?.isConnected) {
        const stack = this.getNotificationStackElement();
        if (this.downloadStatusEl.parentElement !== stack || stack.firstElementChild !== this.downloadStatusEl) {
          stack.prepend(this.downloadStatusEl);
          this.updateNotificationStackLayout();
        }
        return this.downloadStatusEl;
      }

      const refs = this.createNotificationCard({
        type: "busy",
        title: "",
        detail: "",
        iconText: "↓",
        spinner: false,
        download: true,
      });
      this.downloadStatusEl = refs.card;
      this.downloadStatusIconEl = refs.icon;
      this.downloadStatusTitleEl = refs.titleEl;
      this.downloadStatusMetaEl = refs.metaEl;
      this.downloadStatusDetailEl = refs.detailEl;

      const close = this.downloadStatusEl.querySelector(`.${SCRIPT_PREFIX}-download-status-close`);
      close?.addEventListener?.("click", () => {
        this.stopDownloadTitleDots();
        if (this.downloadStatusEl) this.removeNotificationCard(this.downloadStatusEl);
        this.downloadStatusEl = null;
      }, { once: true });

      return this.downloadStatusEl;
    }

    stripAnimatedDotsTitle(title = "") {
      return String(title || "").replace(/[.。…]+$/g, "").trim();
    }

    stopDownloadTitleDots() {
      if (this.downloadStatusDotsTimer) {
        this.window.clearInterval?.(this.downloadStatusDotsTimer);
        this.downloadStatusDotsTimer = null;
      }
      this.downloadStatusDotsBaseTitle = "";
      this.downloadStatusDotsIndex = 0;
    }

    startDownloadTitleDots(title = "") {
      this.stopDownloadTitleDots();
      this.downloadStatusDotsBaseTitle = this.stripAnimatedDotsTitle(title);
      this.downloadStatusDotsIndex = 0;
      const render = () => {
        if (!this.downloadStatusTitleEl) return;
        const count = (this.downloadStatusDotsIndex % 3) + 1;
        this.downloadStatusTitleEl.textContent = `${this.downloadStatusDotsBaseTitle}${".".repeat(count)}`;
        this.downloadStatusDotsIndex += 1;
      };
      render();
      this.downloadStatusDotsTimer = this.window.setInterval?.(render, 320);
    }

    setDownloadStatus({ type = "busy", title = "", detail = "", meta = "", spinner = false, autoHideMs = 0 } = {}) {
      if (this.downloadStatusHideTimer) {
        this.window.clearTimeout?.(this.downloadStatusHideTimer);
        this.downloadStatusHideTimer = null;
      }

      const card = this.getDownloadStatusElement();
      card.className = `${SCRIPT_PREFIX}-notification-card ${SCRIPT_PREFIX}-download-status ${this.getTheme()} ${type}`;

      const isActiveDownload = ["busy", "album", "image"].includes(type);
      if (this.downloadStatusTitleEl) {
        if (isActiveDownload) this.startDownloadTitleDots(title || "");
        else {
          this.stopDownloadTitleDots();
          this.downloadStatusTitleEl.textContent = title || "";
        }
      }
      if (this.downloadStatusMetaEl) this.downloadStatusMetaEl.textContent = meta || "";
      if (this.downloadStatusDetailEl) this.downloadStatusDetailEl.textContent = detail || "";
      if (this.downloadStatusIconEl) {
        this.downloadStatusIconEl.textContent = "";
        if (type === "success") {
          this.downloadStatusIconEl.textContent = "✓";
        } else if (type === "error") {
          this.downloadStatusIconEl.textContent = "!";
        } else if (type === "album") {
          this.downloadStatusIconEl.textContent = "▦";
        } else if (type === "image") {
          this.downloadStatusIconEl.textContent = "◧";
        } else {
          this.downloadStatusIconEl.textContent = "↓";
        }
      }

      this.updateNotificationStackLayout();
      if (autoHideMs > 0) this.hideDownloadStatus(autoHideMs);
      return card;
    }

    hideDownloadStatus(delay = 0, immediate = false) {
      const remove = () => {
        const card = this.downloadStatusEl;
        if (!card) return;
        this.stopDownloadTitleDots();
        this.removeNotificationCard(card, { immediate });
        if (this.downloadStatusEl === card) this.downloadStatusEl = null;
      };

      if (this.downloadStatusHideTimer) {
        this.window.clearTimeout?.(this.downloadStatusHideTimer);
        this.downloadStatusHideTimer = null;
      }

      if (immediate || delay <= 0) {
        remove();
        return;
      }

      this.downloadStatusHideTimer = this.window.setTimeout?.(remove, delay);
    }

    nudgeDownloadStatus(message = this.t("download_already_running")) {
      const card = this.getDownloadStatusElement();
      card.classList.remove("attention");
      void card.offsetWidth;
      card.classList.add("attention");

      const detailEl = this.downloadStatusDetailEl;
      const previousDetail = detailEl?.textContent || "";
      if (detailEl && message) {
        detailEl.textContent = message;
      }

      this.window.setTimeout?.(() => card.classList.remove("attention"), 1050);
      this.window.clearTimeout?.(this.downloadStatusRepeatHintTimer);
      this.downloadStatusRepeatHintTimer = this.window.setTimeout?.(() => {
        if (detailEl?.isConnected && detailEl.textContent === message) {
          detailEl.textContent = previousDetail;
        }
      }, 1600);
    }

    showDownloadPreparing(detail = "") {
      this.setDownloadStatus({
        type: "busy",
        title: this.t("download_preparing"),
        detail,
        spinner: false,
      });
    }

    showVideoPreparing(filename = "") {
      this.setDownloadStatus({
        type: "busy",
        title: this.t("preparing_video_download"),
        detail: filename,
        spinner: false,
      });
    }

    showAlbumProgress(index, total, filename = "") {
      this.setDownloadStatus({
        type: "album",
        title: `${index}/${total} ${this.t("downloading_album")}`,
        detail: filename,
        meta: "",
        spinner: false,
      });
    }

    showImageDownloading(filename = "") {
      this.setDownloadStatus({
        type: "image",
        title: this.t("downloading_image"),
        detail: filename,
        spinner: false,
      });
    }

    showDownloadSuccess(filename = "") {
      this.setDownloadStatus({
        type: "success",
        title: this.t("download_completed"),
        detail: filename,
        autoHideMs: 3000,
      });
    }

    showDownloadError(message = "") {
      this.setDownloadStatus({
        type: "error",
        title: this.t("download_failed"),
        detail: message,
      });
    }

    toast(message, options = {}) {
      const refs = this.createNotificationCard({
        type: options.type || "info",
        title: String(message || ""),
        detail: options.detail || "",
        meta: options.meta || "",
        iconText: options.iconText || "i",
        spinner: Boolean(options.spinner),
        download: false,
      });
      const autoHideMs = Number(options.autoHideMs ?? 3200);
      if (!options.persist && autoHideMs > 0) {
        this.window.setTimeout?.(() => this.removeNotificationCard(refs.card), autoHideMs);
      }
      return refs.card;
    }

    bindHotkey() {
      this.document.addEventListener("keydown", (event) => {
        if (event.repeat) return;
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
        event.stopPropagation();
        action.run();
      });
    }

    watchRouteChanges() {
      if (this.routeChangeCleanup) return;
      const win = this.window;
      const history = win.history;
      const eventName = `${SCRIPT_PREFIX}:locationchange`;
      this.lastHref = win.location.href;

      const scheduleRouteRefresh = () => {
        if (this.routeChangeFrame) return;
        const run = () => {
          this.routeChangeFrame = null;
          if (win.location.href === this.lastHref) return;
          this.lastHref = win.location.href;
          win.setTimeout?.(() => {
            this.refreshMedia();
            this.mountPanel();
            this.applyPanelState();
          }, 120);
        };
        if (typeof win.requestAnimationFrame === "function") {
          this.routeChangeFrame = win.requestAnimationFrame(run);
        } else {
          this.routeChangeFrame = win.setTimeout(run, 50);
        }
      };

      const dispatchLocationChange = () => {
        try {
          win.dispatchEvent(new win.Event(eventName));
        } catch (_err) {
          scheduleRouteRefresh();
        }
      };

      const restoreFns = [];
      const patchHistoryMethod = (methodName) => {
        if (!history || typeof history[methodName] !== "function") return;
        const original = history[methodName];
        if (original.__tthelperPatched) return;
        const patched = function patchedHistoryMethod(...args) {
          const result = original.apply(this, args);
          dispatchLocationChange();
          return result;
        };
        try {
          Object.defineProperty(patched, "__tthelperPatched", { value: true });
          Object.defineProperty(patched, "__tthelperOriginal", { value: original });
        } catch (_err) {}
        try {
          history[methodName] = patched;
          restoreFns.push(() => {
            if (history[methodName] === patched) history[methodName] = original;
          });
        } catch (_err) {}
      };

      patchHistoryMethod("pushState");
      patchHistoryMethod("replaceState");
      win.addEventListener?.(eventName, scheduleRouteRefresh);
      win.addEventListener?.("popstate", scheduleRouteRefresh);
      win.addEventListener?.("hashchange", scheduleRouteRefresh);
      this.routeChangeCleanup = () => {
        win.removeEventListener?.(eventName, scheduleRouteRefresh);
        win.removeEventListener?.("popstate", scheduleRouteRefresh);
        win.removeEventListener?.("hashchange", scheduleRouteRefresh);
        for (const restore of restoreFns) restore();
      };
    }

    getPanelPositionSignature() {
      const config = this.configStore?.get?.() || {};
      const pageType = this.getCurrentPageType();
      let actionBarSignature = "";
      if (this.shouldEmbedPanelInActionBar(pageType)) {
        const host = this.findActionBarHost();
        const rect = this.getElementRect(host);
        const childCount = this.getNativeActionChildren(host).length;
        actionBarSignature = rect
          ? `${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)},${childCount}`
          : "no-action-bar";
      } else if (pageType === "profile-dialog") {
        actionBarSignature = this.profileBrowseDialogAdapter?.getPositionSignature?.() || "no-profile-dialog";
      } else if (pageType === "profile") {
        const userMore = this.profilePageBulkAdapter?.findUserMoreButton?.() || this.document.querySelector?.('[data-e2e="user-more"]');
        const rect = this.getElementRect(userMore);
        const parent = userMore?.parentElement?.parentElement || userMore?.parentElement || null;
        actionBarSignature = rect
          ? `profile-more:${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)},${parent?.children?.length || 0}`
          : "profile-no-user-more";
      }
      return [
        this.window.location?.href || "",
        pageType,
        this.window.innerWidth || 0,
        this.window.innerHeight || 0,
        this.openImageOverlay?.imageUrl || "",
        actionBarSignature,
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
    normalizeSafeDownloadUrl,
    isAllowedDownloadHost,
    isLikelyLiveContextText,
    shouldInspectRuntimeResponse,
    normalizeFileExtension,
    toShortId,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { __test: testApi };
  }

  const INSTALL_FLAG = "__tthelperInstalled__";

  if (root?.document && !root[INSTALL_FLAG]) {
    Object.defineProperty(root, INSTALL_FLAG, {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    });

    const runtimeCache = new RuntimeMediaCache();
    new RuntimeResponseObserver(root, runtimeCache).install();

    const start = () => {
      const app = new TikTokDlApp(root, runtimeCache);
      app.start();
    };
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
      start();
    }
  }
})(typeof unsafeWindow !== "undefined" ? unsafeWindow : globalThis);
