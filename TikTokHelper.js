// ==UserScript==
// @name			TikTokHelper
// @name:zh-CN		TikTokHelper - TikTok 下载助手
// @description		Add compact download tools for TikTok videos, photo posts, profile pop-ups, and manually selected profile posts.
// @description:zh-CN	为 TikTok 网页端添加紧凑的下载工具，支持推荐页、图集、个人页视频弹窗和个人主页手动多选下载。
// @namespace		https://github.com/zimabx/TikTokHelper
// @supportURL		https://github.com/zimabx/TikTokHelper/issues
// @version			1.0.1
// @author			zimabx
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
// @run-at          document-end
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
  const PANEL_POSITION_CHECK_THROTTLE_MS = 32;

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
    language: "auto",
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
      current_item_not_found: "Could not confirm the current TikTok post.",
      current_item_author_not_found: "The current post was found, but its creator could not be confirmed.",
      current_item_author_ambiguous: "The current post was found, but multiple creator identities conflict.",
      current_item_ambiguous: "Multiple post IDs were found in the current area.",
      detail_data_missing: "The post detail page did not contain usable media data.",
      detail_id_mismatch: "The returned post did not match the selected post.",
      asset_empty: "Asset URL is empty.",
      download_preparing: "Preparing download...",
      download_completed: "Download completed",
      preparing_video_download: "Preparing video download...",
      downloading_video: "Downloading video",
      downloading_music: "Downloading music",
      downloading_album: "Downloading album",
      downloading_image: "Downloading image",
      download_failed: "Download failed",
      download_cancelled: "Download cancelled",
      settings_saved: "Settings saved.",
      details_title: "TikTok Helper Details",
      appearance_section: "Appearance",
      download_section: "Download",
      filename_section: "Filename",
      language: "Language",
      video_resolution: "Video Resolution",
      details_tab_json: "JSON",
      video_sources: "Video Sources",
      image_album: "Image Album",
      raw_json: "Raw JSON",
      url: "URL",
      open: "Open",
      quality: "Quality",
      resolution: "Resolution",
      codec: "Codec",
      bitrate: "Bitrate",
      size: "Size",
      source: "Source",
      watermarked: "Watermarked",
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
      available_fields: "Available attributes",
      filename_max_length: "Filename Max Length",
      album_index_format: "Album Increment",
      copy: "Copy",
      save: "Save",
      cancel: "Cancel",
      id: "ID",
      author: "Author",
      description: "Description",
      tooltip_language: "Choose the interface language. Auto follows your browser language.",
      tooltip_video_resolution: "Pick which TikTok video source should be preferred when multiple qualities are available.",
      tooltip_available_fields: "All filename attributes supported by this script. Click one to insert its `${name}` token at the current cursor position.",
      tooltip_custom_template: "Plain filename template. Click an available attribute below to insert it at the current cursor position. Example: `${nickname}_${short_id}_${desc}`.",
      tooltip_filename_max_length: "Maximum filename length before the extension is added. Invalid filename characters are replaced automatically.",
      tooltip_album_index_format: "Numbering style appended to each image in an album.",
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
      bulk_download_result_detailed: "Success ${success}, failed ${failed}.",
      bulk_download_cancelled: "Bulk download cancelled",
      show_test_notification_menu: "Show notification test items",
      show_debug_info_menu: "Show test info item",
      template: "Template",
    },
    zh: {
      menu: "TikTok Helper 菜单",
      download: "下载",
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
      current_item_not_found: "无法确认当前 TikTok 作品。",
      current_item_author_not_found: "已确认当前作品，但无法确认作者账号。",
      current_item_author_ambiguous: "已确认当前作品，但存在互相冲突的作者身份。",
      current_item_ambiguous: "当前区域中发现了多个冲突的作品 ID。",
      detail_data_missing: "作品详情页中没有可用的媒体数据。",
      detail_id_mismatch: "详情页返回的作品与当前选择的作品不一致。",
      asset_empty: "资源链接为空。",
      download_preparing: "正在准备下载...",
      download_completed: "下载完成",
      preparing_video_download: "正在准备视频下载...",
      downloading_video: "正在下载视频",
      downloading_music: "正在下载音乐",
      downloading_album: "正在下载图集",
      downloading_image: "正在下载图片",
      download_failed: "下载失败",
      download_cancelled: "下载已取消",
      settings_saved: "设置已保存。",
      details_title: "TikTok Helper 详情",
      appearance_section: "外观",
      download_section: "下载",
      filename_section: "文件名",
      language: "语言",
      video_resolution: "视频分辨率",
      details_tab_json: "JSON",
      video_sources: "视频源",
      image_album: "图集",
      raw_json: "原始 JSON",
      url: "链接",
      open: "打开",
      quality: "清晰度",
      resolution: "分辨率",
      codec: "编码",
      bitrate: "码率",
      size: "大小",
      source: "来源",
      watermarked: "带水印",
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
      available_fields: "可用属性",
      filename_max_length: "文件名最大长度",
      album_index_format: "图集递增",
      copy: "复制",
      save: "保存",
      cancel: "取消",
      id: "ID",
      author: "作者",
      description: "描述",
      tooltip_language: "选择界面语言。自动会跟随浏览器语言。",
      tooltip_video_resolution: "当 TikTok 提供多个视频源时，优先选择哪一种清晰度。",
      tooltip_available_fields: "脚本支持的全部文件名属性。点击属性会在模板当前光标处插入 `${name}`。",
      tooltip_custom_template: "手动填写普通文件名模板。点击下方可用属性会在当前光标处插入。示例：`${nickname}_${short_id}_${desc}`。",
      tooltip_filename_max_length: "扩展名前的文件名最大长度。非法文件名字符会自动替换。",
      tooltip_album_index_format: "图集中每张图片追加的序号样式。",
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
      bulk_download_result_detailed: "成功 ${success}，失败 ${failed}。",
      bulk_download_cancelled: "批量下载已取消",
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

  function insertTextAtSelection(input, text) {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    input.setRangeText(String(text ?? ""), start, end, "end");
    input.focus({ preventScroll: true });
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
    const filenameMaxLength = Number(next.filename_max_length);
    next.filename_max_length =
      Number.isFinite(filenameMaxLength) && filenameMaxLength > 0
        ? Math.floor(filenameMaxLength)
        : DEFAULT_CONFIG.filename_max_length;
    next.album_index_format = normalizeAlbumIndexFormat(next.album_index_format);
    if (!VIDEO_QUALITY_OPTIONS.includes(next.video_quality)) {
      next.video_quality = DEFAULT_CONFIG.video_quality;
    }
    if (!LANGUAGE_OPTIONS.some(([value]) => value === next.language)) {
      next.language = DEFAULT_CONFIG.language;
    }
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
    if (!doc?.querySelector) return null;
    const script = doc.querySelector(
      'script#__UNIVERSAL_DATA_FOR_REHYDRATION__[type="application/json"],script#SIGI_STATE[type="application/json"]',
    );
    return parseJsonScriptText(script?.textContent || "");
  }

  function getWindowDataCandidates(win) {
    return [
      win?.__UNIVERSAL_DATA_FOR_REHYDRATION__,
      win?.SIGI_STATE,
      win?.__NEXT_DATA__,
      win?.__INITIAL_STATE__,
    ].filter((value) => value && typeof value === "object");
  }

  function collectPageDataCandidates(doc, win) {
    return [
      parsePageDataFromDocument(doc),
      ...getWindowDataCandidates(win),
    ].filter(Boolean);
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

  function getVideoElementResourceUrls(videoElement) {
    if (!videoElement) return [];
    return unique([
      pickVideoElementSource(videoElement),
      videoElement.poster || "",
      videoElement.getAttribute?.("poster") || "",
    ]);
  }

  function compactMatchText(value = "") {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function getReactInternalRoots(element = null) {
    if (!element || (typeof element !== "object" && typeof element !== "function")) return [];
    const roots = [];
    let keys = [];
    try {
      keys = Object.getOwnPropertyNames(element);
    } catch (_err) {
      return roots;
    }
    const prefixes = ["__reactProps$", "__reactFiber$", "__reactContainer$"];
    for (const prefix of prefixes) {
      for (const key of keys) {
        if (!key.startsWith(prefix)) continue;
        try {
          const value = element[key];
          if (value && typeof value === "object") roots.push(value);
        } catch (_err) {}
      }
    }
    return roots;
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

  function detectVideoSourceWatermark(sourceType = "unknown", raw = {}, address = {}) {
    const positive = firstDefined(
      raw?.hasWatermark,
      raw?.has_watermark,
      raw?.isWatermark,
      raw?.is_watermark,
      address?.hasWatermark,
      address?.has_watermark,
      address?.isWatermark,
      address?.is_watermark,
    );
    const positiveFlag = normalizeBoolFlag(positive);
    if (positiveFlag !== null) return positiveFlag ? "watermarked" : "clean";

    const negative = firstDefined(
      raw?.withoutWatermark,
      raw?.without_watermark,
      raw?.noWatermark,
      raw?.no_watermark,
      address?.withoutWatermark,
      address?.without_watermark,
      address?.noWatermark,
      address?.no_watermark,
    );
    const negativeFlag = normalizeBoolFlag(negative);
    if (negativeFlag !== null) return negativeFlag ? "clean" : "watermarked";

    return sourceType === "download" ? "watermarked" : "unknown";
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
      sourceType: String(input.sourceType || "unknown"),
      sourceIndex: Number.isInteger(input.sourceIndex) ? input.sourceIndex : null,
      watermarkStatus: detectVideoSourceWatermark(
        String(input.sourceType || "unknown"),
        input.raw,
        input.address,
      ),
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
    };
    const rawPropertyInputs = [input.raw, input.address].filter(
      (value) => value && typeof value === "object",
    );
    Object.defineProperty(source, "rawProperties", {
      configurable: true,
      enumerable: false,
      get() {
        const value = collectSourceProperties(...rawPropertyInputs);
        Object.defineProperty(source, "rawProperties", {
          configurable: true,
          enumerable: false,
          writable: false,
          value,
        });
        return value;
      },
    });
    source.resolution = getSourceResolution(source);
    source.label = sourceLabel(source);
    return source.url ? source : null;
  }

  function getDirectVideoSource(video, address, sizeFallbackPaths, sourceType) {
    return makeVideoSource({
      sourceType,
      raw: video,
      address,
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
      quality:
        sourceType === "download"
          ? ""
          : video.videoQuality || video.definition || video.ratio || "",
      qualityType:
        sourceType === "download"
          ? undefined
          : firstDefined(video.QualityType, video.qualityType, video.quality_type),
      format: video.format || "",
      size:
        video.size ||
        video.DataSize ||
        video.dataSize ||
        readNumberPath(video, sizeFallbackPaths),
    });
  }

  function getVideoSourceFromBitrateInfo(info = {}, video = {}, index = 0) {
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
      sourceType: "bitrate",
      sourceIndex: index,
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

  function extractVideoSources(video = {}) {
    const bitrateSources = ensureArray(
      video.bitrateInfo ||
        video.bitrate_info ||
        video.bitrateInfos ||
        video.bitrate_infos,
    )
      .map((info, index) => ({ info, index }))
      .sort((left, right) => {
        const leftBitrate = Number(left.info?.Bitrate || left.info?.bitrate || 0);
        const rightBitrate = Number(right.info?.Bitrate || right.info?.bitrate || 0);
        return rightBitrate - leftBitrate;
      })
      .map(({ info, index }) => getVideoSourceFromBitrateInfo(info, video, index))
      .filter(Boolean);
    const directSources = [
      getDirectVideoSource(
        video,
        video.playAddr || video.PlayAddr || video.play_addr,
        ["playAddr.dataSize", "PlayAddr.DataSize"],
        "play",
      ),
      getDirectVideoSource(
        video,
        video.downloadAddr || video.DownloadAddr || video.download_addr,
        ["downloadAddr.dataSize", "DownloadAddr.DataSize"],
        "download",
      ),
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

  function compareKnownBitrate(left, right, direction = 1) {
    const leftBitrate = Number(left?.bitrate || 0);
    const rightBitrate = Number(right?.bitrate || 0);
    const leftKnown = leftBitrate > 0;
    const rightKnown = rightBitrate > 0;
    if (leftKnown && rightKnown) return (leftBitrate - rightBitrate) * direction;
    if (leftKnown !== rightKnown) return leftKnown ? -1 : 1;
    return 0;
  }

  function compareByResolutionThenBitrate(left, right, direction = 1) {
    const leftResolution = Number(left?.resolution || 0);
    const rightResolution = Number(right?.resolution || 0);
    if (leftResolution !== rightResolution) {
      return (leftResolution - rightResolution) * direction;
    }
    return compareKnownBitrate(left, right, direction);
  }

  function selectVideoSource(sources, preference = DEFAULT_CONFIG.video_quality) {
    const allCandidates = ensureArray(sources).filter((source) => source?.url);
    if (!allCandidates.length) return null;
    const normalCandidates = allCandidates.filter((source) => source.sourceType !== "download");
    const nonWatermarkedCandidates = normalCandidates.filter(
      (source) => source.watermarkStatus !== "watermarked",
    );
    const candidates = nonWatermarkedCandidates.length
      ? nonWatermarkedCandidates
      : normalCandidates.length
        ? normalCandidates
        : allCandidates;
    const value = String(preference || DEFAULT_CONFIG.video_quality);
    if (value === "highest_bitrate") {
      return [...candidates].sort((left, right) => compareKnownBitrate(left, right, -1))[0];
    }
    if (value === "lowest") {
      return [...candidates].sort((left, right) => compareByResolutionThenBitrate(left, right, 1))[0];
    }
    const targetMatch = value.match(/^(\d{3,4})p$/);
    if (targetMatch) {
      const target = Number(targetMatch[1]);
      const exact = candidates.filter((source) => Number(source.resolution || 0) === target);
      if (exact.length) {
        return exact.sort((left, right) => compareKnownBitrate(left, right, -1))[0];
      }
      return [...candidates].sort((left, right) => {
        const leftDistance = Math.abs(Number(left.resolution || 0) - target);
        const rightDistance = Math.abs(Number(right.resolution || 0) - target);
        if (leftDistance !== rightDistance) return leftDistance - rightDistance;
        return compareKnownBitrate(left, right, -1);
      })[0];
    }
    return [...candidates].sort((left, right) => compareByResolutionThenBitrate(left, right, -1))[0];
  }

  function extractVideoUrls(video = {}, qualityPreference = DEFAULT_CONFIG.video_quality) {
    const sources = extractVideoSources(video);
    const primarySource = selectVideoSource(sources, qualityPreference);
    const automaticSources = sources.filter(
      (source) =>
        source.sourceType !== "download" &&
        source.watermarkStatus !== "watermarked",
    );
    const fallbackSources = automaticSources.length ? automaticSources : sources;
    const urls = unique([
      primarySource?.url || "",
      ...(primarySource?.fallbackUrls || []),
      ...fallbackSources.flatMap((source) => [source.url, ...source.fallbackUrls]),
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

  function getVideoItemId(item = {}) {
    return String(
      item.id || item.awemeId || item.aweme_id || item.itemId || item.item_id || "",
    );
  }


  function normalizeTikTokItemFragment(rawItem = {}) {
    if (!rawItem || typeof rawItem !== "object") return null;
    const id = getVideoItemId(rawItem);
    if (!id) return rawItem;
    const nestedAuthor = rawItem.author || rawItem.authorInfo || {};
    const author = mergeFilledItemRecords([
      {
        id: firstString(
          nestedAuthor.id,
          nestedAuthor.uid,
          nestedAuthor.userId,
          nestedAuthor.user_id,
          rawItem.authorId,
          rawItem.author_id,
        ),
        uniqueId: firstString(
          nestedAuthor.uniqueId,
          nestedAuthor.unique_id,
          nestedAuthor.shortId,
          nestedAuthor.short_id,
          rawItem.authorUniqueId,
          rawItem.author_unique_id,
        ),
        secUid: firstString(
          nestedAuthor.secUid,
          nestedAuthor.sec_uid,
          rawItem.authorSecId,
          rawItem.author_sec_id,
          rawItem.authorSecUid,
          rawItem.author_sec_uid,
        ),
        nickname: firstString(
          nestedAuthor.nickname,
          nestedAuthor.nickName,
          rawItem.nickname,
          rawItem.authorNickname,
          rawItem.author_nickname,
        ),
        signature: firstString(
          nestedAuthor.signature,
          nestedAuthor.desc,
          rawItem.authorSignature,
          rawItem.author_signature,
        ),
        avatarThumb: firstUrl(
          nestedAuthor.avatarThumb,
          nestedAuthor.avatar_thumb,
          rawItem.avatarThumb,
          rawItem.avatar_thumb,
        ),
        avatarMedium: firstUrl(
          nestedAuthor.avatarMedium,
          nestedAuthor.avatar_medium,
          rawItem.avatarMedium,
          rawItem.avatar_medium,
        ),
        avatarLarger: firstUrl(
          nestedAuthor.avatarLarger,
          nestedAuthor.avatar_larger,
          rawItem.avatarLarger,
          rawItem.avatar_larger,
        ),
      },
      nestedAuthor,
    ]);
    return {
      ...rawItem,
      id,
      author,
    };
  }

  function isItemDataFragment(value) {
    if (!value || typeof value !== "object" || !getVideoItemId(value)) return false;
    return Boolean(
      value.video ||
        getImagePostPayload(value) ||
        value.author ||
        value.authorInfo ||
        value.authorStats ||
        value.desc ||
        value.description ||
        value.music ||
        value.stats ||
        value.statsV2,
    );
  }

  function normalizeMediaItem(item, pageUrl = "", options = {}) {
    if (!item || typeof item !== "object") return null;
    item = normalizeTikTokItemFragment(item) || item;
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
        url: firstUrl(
          video.cover,
          video.originCover,
          video.coverAddr,
          video.cover_addr,
          item.video?.cover,
          imagePostCover.url,
        ),
        dynamicUrl: firstUrl(video.dynamicCover, video.dynamic_cover),
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

  function getAuthorFromUrl(url) {
    const match = String(url || "").match(/tiktok\.com\/@([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function toShortId(value) {
    const text = String(value || "");
    if (/^\d+$/.test(text)) {
      try {
        return root.BigInt(text).toString(36);
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
    const videoSourceColumns = normalizeVideoSourceColumns(
      merged.video_source_columns,
    ).map((key) => {
      const definition = getVideoSourceColumnDefinition(key);
      return { key, label: t(definition?.messageKey || key) || key };
    });
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
        sourceTypeKey: source.sourceType || "unknown",
        watermarkStatus: source.watermarkStatus || "unknown",
        sourceIndex: Number.isInteger(source.sourceIndex) ? source.sourceIndex : null,
        quality:
          source.watermarkStatus === "watermarked"
            ? t("watermarked")
            : source.quality || source.gearName || source.qualityType || "-",
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
        sourceTypeKey: media.video.primarySource?.sourceType || "unknown",
        watermarkStatus: media.video.primarySource?.watermarkStatus || "unknown",
        sourceIndex: Number.isInteger(media.video.primarySource?.sourceIndex) ? media.video.primarySource.sourceIndex : null,
        quality:
          media.video.primarySource?.watermarkStatus === "watermarked"
            ? t("watermarked")
            : media.video.quality || "-",
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

    const createdAt = formatTimestamp(media.createTime);
    const post = {
      description: media.desc || "",
      createdAt,
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
      createdAt,
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


  const ITEM_DETAIL_CACHE_LIMIT = 50;
  const ITEM_DETAIL_CACHE_TTL_MS = 5 * 60 * 1000;
  const LOCAL_REACT_SCAN_MAX_OBJECTS = 320;
  const LOCAL_REACT_SCAN_MAX_DEPTH = 5;
  const IDENTITY_VERSION_WAIT_MS = 500;
  const IDENTITY_EVIDENCE_RANK = Object.freeze({
    "page-url": 500,
    "local-permalink": 450,
    "local-wrapper-author": 400,
    "local-react-canonical": 350,
    "local-react-wrapper-author": 340,
    "local-react-page-exact": 330,
  });

  function parseTikTokItemIdentityFromUrl(rawUrl = "") {
    let parsed = null;
    try {
      parsed = new URL(String(rawUrl || ""), "https://www.tiktok.com/");
    } catch (_err) {
      return null;
    }
    const match = parsed.pathname.match(
      /^\/@([^/]+)\/(video|photo)\/(\d+)(?:\/|$)/i,
    );
    if (!match) return null;
    const username = decodeURIComponent(match[1] || "").replace(/^@/, "").trim();
    const type = String(match[2] || "").toLowerCase();
    const id = String(match[3] || "");
    if (!username || !/^[0-9]{10,}$/.test(id)) return null;
    return {
      id,
      type: type === "photo" ? "photo" : "video",
      username,
      permalink: `https://www.tiktok.com/@${encodeURIComponent(username)}/${type}/${id}`,
    };
  }

  function buildTikTokItemPermalink({ id = "", type = "video", username = "" } = {}) {
    const itemId = String(id || "");
    const handle = String(username || "").replace(/^@/, "").trim();
    const itemType = type === "photo" ? "photo" : "video";
    if (!handle || !/^[0-9]{10,}$/.test(itemId)) return "";
    return `https://www.tiktok.com/@${encodeURIComponent(handle)}/${itemType}/${itemId}`;
  }

  function getProfileUsernameFromUrl(rawUrl = "") {
    try {
      const parsed = new URL(String(rawUrl || ""), "https://www.tiktok.com/");
      const match = parsed.pathname.match(/^\/@([^/]+)(?:\/|$)/);
      return match ? decodeURIComponent(match[1] || "").replace(/^@/, "") : "";
    } catch (_err) {
      return "";
    }
  }

  function getItemTypeFromRawItem(item = {}) {
    return getImagePostPayload(item) ? "photo" : "video";
  }

  function getItemUsername(item = {}) {
    const author = item?.author || item?.authorInfo || {};
    return String(
      author.uniqueId ||
        author.unique_id ||
        author.shortId ||
        author.short_id ||
        item.authorUniqueId ||
        item.author_unique_id ||
        "",
    ).replace(/^@/, "");
  }

  function hasUsableRawMediaItem(item, pageUrl = "", config = DEFAULT_CONFIG) {
    return Boolean(
      item &&
        hasUsableMedia(
          normalizeMediaItem(item, pageUrl, config),
        ),
    );
  }

  function collectExactItemsInKnownData(data, targetId = "") {
    const id = String(targetId || "");
    if (!data || typeof data !== "object" || !id) return [];
    const queue = [{ value: data, depth: 0 }];
    const seen = new Set();
    const itemSeen = new Set();
    const items = [];
    let inspected = 0;
    const allowedKey = /^(?:__DEFAULT_SCOPE__|ItemModule|itemModule|itemInfo|itemStruct|itemList|item_list|items|aweme|awemeList|aweme_list|data|body|result|props|pageProps|state|webapp\.[\w.-]+)$/i;
    const add = (value) => {
      if (
        !value ||
        typeof value !== "object" ||
        itemSeen.has(value) ||
        getVideoItemId(value) !== id ||
        !isItemDataFragment(value)
      ) {
        return;
      }
      itemSeen.add(value);
      items.push(value);
    };

    while (queue.length && inspected < 1000 && items.length < 40) {
      const { value, depth } = queue.shift();
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      inspected += 1;
      add(value);

      const itemModule = value.ItemModule || value.itemModule;
      add(itemModule?.[id]);
      add(value?.itemInfo?.itemStruct);
      add(value?.itemStruct);
      add(value?.itemInfo);

      if (depth >= 6) continue;
      let entries = [];
      try {
        entries = Object.entries(value);
      } catch (_err) {
        continue;
      }
      for (const [key, child] of entries) {
        if (!child || typeof child !== "object" || !allowedKey.test(key)) continue;
        if (Array.isArray(child)) {
          for (const entry of child.slice(0, 180)) {
            if (entry && typeof entry === "object") {
              queue.push({ value: entry, depth: depth + 1 });
            }
          }
        } else {
          queue.push({ value: child, depth: depth + 1 });
        }
      }
    }
    return items;
  }

  function collectLocalReactItems(elements = [], options = {}) {
    const maxObjects = Math.max(
      50,
      Number(options.maxObjects || LOCAL_REACT_SCAN_MAX_OBJECTS),
    );
    const maxDepth = Math.max(
      2,
      Number(options.maxDepth || LOCAL_REACT_SCAN_MAX_DEPTH),
    );
    const starts = ensureArray(elements)
      .map((entry, index) => {
        if (entry?.element) return entry;
        return { element: entry, source: `element-${index}` };
      })
      .filter((entry) => entry.element);
    const queue = [];
    for (const start of starts) {
      let element = start.element;
      for (let distance = 0; element && distance <= 2; distance += 1) {
        for (const rootValue of getReactInternalRoots(element)) {
          queue.push({
            value: rootValue,
            depth: 0,
            source: start.source || "element",
            distance,
          });
        }
        element = element.parentElement || null;
      }
    }

    const seen = new Set();
    const entries = [];
    let inspected = 0;
    const allowedKey = /^(?:memoizedProps|pendingProps|memoizedState|props|item|itemInfo|itemStruct|itemData|aweme|awemeInfo|data|children|child|content|videoData|videoInfo|photoData|photoInfo)$/i;

    while (queue.length && inspected < maxObjects) {
      const current = queue.shift();
      const { value, depth, source, distance } = current;
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      inspected += 1;

      if (isItemDataFragment(value)) {
        entries.push({
          id: getVideoItemId(value),
          item: value,
          source,
          distance,
        });
      }
      if (depth >= maxDepth) continue;
      let objectEntries = [];
      try {
        objectEntries = Object.entries(value);
      } catch (_err) {
        continue;
      }
      for (const [key, child] of objectEntries) {
        if (!child || typeof child !== "object") continue;
        if (
          [
            "return",
            "sibling",
            "alternate",
            "stateNode",
            "ownerDocument",
            "parentNode",
            "parentElement",
            "previousSibling",
            "nextSibling",
            "_debugOwner",
          ].includes(key)
        ) {
          continue;
        }
        if (Array.isArray(child)) {
          if (!allowedKey.test(key)) continue;
          for (const entry of child.slice(0, 60)) {
            if (entry && typeof entry === "object") {
              queue.push({ value: entry, depth: depth + 1, source, distance });
            }
          }
        } else if (allowedKey.test(key)) {
          queue.push({ value: child, depth: depth + 1, source, distance });
        }
      }
    }

    entries.sort((left, right) => left.distance - right.distance);
    return {
      entries,
      inspected,
      truncated: queue.length > 0,
    };
  }

  function collectCanonicalLinksInElement(element = null) {
    const identities = [];
    const add = (value) => {
      const identity = parseTikTokItemIdentityFromUrl(value);
      if (identity) identities.push(identity);
    };
    add(element?.href || element?.getAttribute?.("href") || "");
    for (const anchor of Array.from(
      element?.querySelectorAll?.('a[href*="/@"][href*="/video/"],a[href*="/@"][href*="/photo/"]') || [],
    )) {
      add(anchor.href || anchor.getAttribute?.("href") || "");
    }
    const byId = new Map();
    for (const identity of identities) {
      if (!byId.has(identity.id)) byId.set(identity.id, identity);
    }
    return [...byId.values()];
  }

  function collectAuthorUsernamesInElement(element = null) {
    const usernames = [];
    for (const anchor of Array.from(
      element?.querySelectorAll?.('a[href*="/@"]') || [],
    )) {
      const username = getAuthorFromUrl(anchor.href || anchor.getAttribute?.("href") || "");
      if (username) usernames.push(username.replace(/^@/, ""));
    }
    return unique(usernames);
  }

  function collectStructuredAuthorUsernamesInElement(element = null) {
    if (!element?.querySelectorAll) return [];
    const anchors = new Set();
    const selectors = [
      'a[data-e2e="video-author-uniqueid"][href*="/@"]',
      '[data-e2e="video-author-uniqueid"] a[href*="/@"]',
      'a[data-e2e="video-author-avatar"][href*="/@"]',
      '[data-e2e="video-author-avatar"] a[href*="/@"]',
      'a[data-e2e="browse-username"][href*="/@"]',
      '[data-e2e="browse-username"] a[href*="/@"]',
      'a[data-e2e="browse-user-avatar"][href*="/@"]',
      '[data-e2e="browse-user-avatar"] a[href*="/@"]',
    ];
    for (const selector of selectors) {
      for (const anchor of Array.from(element.querySelectorAll(selector))) anchors.add(anchor);
    }
    for (const anchor of Array.from(element.querySelectorAll('a[href*="/@"]'))) {
      if (anchor.querySelector?.('img[src*="-avt-"],img[src*="avatar"],picture img')) {
        anchors.add(anchor);
      }
    }
    return unique(
      [...anchors]
        .map((anchor) => getAuthorFromUrl(anchor.href || anchor.getAttribute?.("href") || ""))
        .filter(Boolean)
        .map((username) => username.replace(/^@/, "")),
    );
  }

  function compareIdentityCandidates(candidates = []) {
    const valid = ensureArray(candidates)
      .filter((candidate) => candidate?.identity?.id)
      .map((candidate) => ({
        ...candidate,
        rank: Number(
          candidate.rank ||
            IDENTITY_EVIDENCE_RANK[candidate.identity.evidence] ||
            0,
        ),
      }))
      .sort((left, right) => right.rank - left.rank);
    if (!valid.length) return { candidate: null, ambiguousIds: [] };
    const topRank = valid[0].rank;
    const top = valid.filter((candidate) => candidate.rank === topRank);
    const topIds = unique(top.map((candidate) => candidate.identity.id));
    if (topIds.length !== 1) {
      return { candidate: null, ambiguousIds: topIds, topRank };
    }
    const id = topIds[0];
    const sameId = valid.filter((candidate) => candidate.identity.id === id);
    const primary = sameId[0];
    return {
      candidate: {
        ...primary,
        identity: {
          ...primary.identity,
          username:
            primary.identity.username ||
            sameId.map((candidate) => candidate.identity.username).find(Boolean) ||
            "",
          permalink:
            primary.identity.permalink ||
            sameId.map((candidate) => candidate.identity.permalink).find(Boolean) ||
            "",
        },
      },
      ambiguousIds: [],
      topRank,
    };
  }

  class CurrentItemResolver {
    constructor(doc, win, extractor) {
      this.document = doc;
      this.window = win;
      this.extractor = extractor;
      this.lastTrace = null;
      this.nodeIds = new WeakMap();
      this.nextNodeId = 1;
    }

    getNodeId(node) {
      if (!node || (typeof node !== "object" && typeof node !== "function")) return 0;
      if (!this.nodeIds.has(node)) this.nodeIds.set(node, this.nextNodeId++);
      return this.nodeIds.get(node);
    }

    collectWrapperIds(context, mediaElement, anchorElement) {
      const ids = new Set();
      const starts = [mediaElement, context, anchorElement].filter(Boolean);
      for (const start of starts) {
        let element = start;
        for (let depth = 0; element && element !== this.document?.body && depth < 16; depth += 1) {
          const rawId = String(element.id || "");
          if (/xgwrapper/i.test(rawId)) {
            for (const id of rawId.match(/\d{15,}/g) || []) ids.add(id);
          }
          element = element.parentElement || null;
        }
      }
      return [...ids];
    }

    collectAncestorEvidence(starts = [], pageUsername = "") {
      const candidates = [];
      const ambiguousIds = new Set();
      for (const start of ensureArray(starts).filter(Boolean)) {
        let element = start;
        let wrapperId = "";
        let username = pageUsername;
        for (let depth = 0; element && element !== this.document?.body && depth < 25; depth += 1) {
          const links = collectCanonicalLinksInElement(element);
          if (links.length === 1) {
            candidates.push({
              identity: { ...links[0], evidence: "local-permalink" },
              rank: IDENTITY_EVIDENCE_RANK["local-permalink"] - depth / 100,
              details: { depth },
            });
            break;
          }
          if (links.length > 1) {
            for (const identity of links) ambiguousIds.add(identity.id);
          }

          const rawId = String(element.id || "");
          if (/xgwrapper/i.test(rawId)) {
            const ids = unique(rawId.match(/\d{15,}/g) || []);
            if (ids.length === 1) wrapperId = ids[0];
            else for (const id of ids) ambiguousIds.add(id);
          }
          const structuredUsernames = collectStructuredAuthorUsernamesInElement(element);
          const allUsernames = collectAuthorUsernamesInElement(element);
          if (structuredUsernames.length === 1) username = structuredUsernames[0];
          else if (!username && allUsernames.length === 1) username = allUsernames[0];
          if (wrapperId && username) {
            const type = String(start?.tagName || "").toLowerCase() === "img" ? "photo" : "video";
            candidates.push({
              identity: {
                id: wrapperId,
                type,
                username,
                permalink: buildTikTokItemPermalink({ id: wrapperId, type, username }),
                evidence: "local-wrapper-author",
              },
              rank: IDENTITY_EVIDENCE_RANK["local-wrapper-author"] - depth / 100,
              details: { depth },
            });
            break;
          }
          element = element.parentElement || null;
        }
      }
      return { candidates, ambiguousIds: [...ambiguousIds] };
    }

    getDomVersion(options = {}) {
      const anchorElement = options.anchorElement || null;
      const context =
        this.extractor?.getMediaContextElement?.(anchorElement) ||
        getVisibleProfileBrowseDialog(this.document) ||
        null;
      const mediaElement = context
        ? this.extractor?.getContextMediaElement?.(context)
        : this.extractor?.getVisibleMediaElement?.();
      const links = collectCanonicalLinksInElement(context || anchorElement)
        .map((identity) => `${identity.id}:${identity.username}`)
        .sort();
      const wrapperIds = this.collectWrapperIds(context, mediaElement, anchorElement).sort();
      const mediaSource = String(
        mediaElement?.currentSrc ||
          mediaElement?.src ||
          mediaElement?.getAttribute?.("src") ||
          "",
      );
      return [
        this.window?.location?.href || "",
        this.getNodeId(anchorElement),
        anchorElement?.isConnected === false ? 0 : 1,
        this.getNodeId(context),
        this.getNodeId(mediaElement),
        mediaSource,
        links.join(","),
        wrapperIds.join(","),
        context?.childElementCount || 0,
      ].join("|");
    }

    resolve(options = {}) {
      const pageUrl = String(this.window?.location?.href || "");
      const anchorElement = options.anchorElement || null;
      const trace = {
        capturedAt: new Date().toISOString(),
        pageUrl,
        pageType: options.pageType || "",
        live: Boolean(options.isLive),
        stages: [],
        candidates: [],
      };
      const fail = (code, details = {}) => {
        const result = { ok: false, code, details, version: trace.domVersion };
        trace.result = "failure";
        trace.errorCode = code;
        trace.details = details;
        this.lastTrace = trace;
        return result;
      };
      const candidates = [];
      const pageFragmentsById = new Map();
      const addCandidate = (identity, details = {}) => {
        const normalized = {
          id: String(identity.id || ""),
          type: identity.type === "photo" ? "photo" : "video",
          username: String(identity.username || "").replace(/^@/, ""),
          permalink:
            parseTikTokItemIdentityFromUrl(identity.permalink || "")?.permalink ||
            buildTikTokItemPermalink(identity),
          evidence: identity.evidence || "unknown",
        };
        if (!normalized.id || !normalized.username || !normalized.permalink) return;
        const candidate = {
          identity: normalized,
          rank: Number(details.rank ?? IDENTITY_EVIDENCE_RANK[normalized.evidence] ?? 0),
          details,
        };
        trace.candidates.push({
          id: normalized.id,
          evidence: normalized.evidence,
          rank: candidate.rank,
          username: normalized.username,
          hasPermalink: true,
          ...details,
        });
        candidates.push(candidate);
      };

      if (options.isLive) return fail("live-not-supported", { pageType: options.pageType || "live" });

      const context =
        this.extractor?.getMediaContextElement?.(anchorElement) ||
        getVisibleProfileBrowseDialog(this.document) ||
        null;
      const mediaElement = context
        ? this.extractor?.getContextMediaElement?.(context)
        : this.extractor?.getVisibleMediaElement?.();
      const videoElement = context
        ? this.extractor?.getContextVideoElement?.(context)
        : this.extractor?.getVisibleVideoElement?.();
      trace.anchorFound = Boolean(anchorElement);
      trace.contextFound = Boolean(context);
      trace.mediaTag = String(mediaElement?.tagName || "").toLowerCase();
      trace.domVersion = this.getDomVersion({ anchorElement });

      const pageIdentity = parseTikTokItemIdentityFromUrl(pageUrl);
      trace.stages.push({ stage: "page-url", matched: Boolean(pageIdentity) });
      if (pageIdentity) addCandidate({ ...pageIdentity, evidence: "page-url" });

      const pageUsername = ["profile", "profile-dialog"].includes(options.pageType)
        ? getProfileUsernameFromUrl(pageUrl)
        : "";
      const ancestorEvidence = this.collectAncestorEvidence(
        [videoElement, mediaElement, anchorElement, context],
        pageUsername,
      );
      trace.stages.push({
        stage: "ancestor-evidence",
        candidates: ancestorEvidence.candidates.map((candidate) => ({
          id: candidate.identity.id,
          evidence: candidate.identity.evidence,
          depth: candidate.details?.depth ?? null,
        })),
        ambiguousIds: ancestorEvidence.ambiguousIds,
      });
      for (const candidate of ancestorEvidence.candidates) {
        addCandidate(candidate.identity, {
          ...candidate.details,
          rank: candidate.rank,
        });
      }

      const reactResult = collectLocalReactItems([
        { element: mediaElement, source: "media" },
        { element: anchorElement, source: "anchor" },
        { element: context, source: "context" },
      ]);
      const nearbyEntries = reactResult.truncated
        ? []
        : reactResult.entries.filter((entry) => entry.distance <= 1);
      trace.stages.push({
        stage: "local-react-evidence",
        inspectedObjects: reactResult.inspected,
        truncated: reactResult.truncated,
        entries: reactResult.entries.map((entry) => ({
          id: entry.id,
          source: entry.source,
          distance: entry.distance,
          hasUsername: Boolean(getItemUsername(entry.item)),
        })),
      });
      for (const entry of nearbyEntries) {
        const username = getItemUsername(entry.item);
        if (!username) continue;
        addCandidate(
          {
            id: entry.id,
            type: getItemTypeFromRawItem(entry.item),
            username,
            evidence: "local-react-canonical",
          },
          { source: entry.source, distance: entry.distance },
        );
      }

      let compared = compareIdentityCandidates(candidates);
      if (!compared.candidate && !compared.ambiguousIds.length) {
        const reactIds = unique(nearbyEntries.map((entry) => entry.id));
        const wrapperIds = this.collectWrapperIds(context, mediaElement, anchorElement);
        const structuredDomUsernames = unique([
          pageUsername,
          ...collectStructuredAuthorUsernamesInElement(context || anchorElement),
        ]);
        const allDomUsernames = unique([
          pageUsername,
          ...collectAuthorUsernamesInElement(context || anchorElement),
        ]);
        const pageDataCandidates = collectPageDataCandidates(this.document, this.window);
        const corroboration = [];
        const authorAmbiguities = [];
        let corroboratedIdFound = false;

        for (const id of reactIds) {
          const pageFragments = pageDataCandidates.flatMap((data) =>
            collectExactItemsInKnownData(data, id),
          );
          if (pageFragments.length) pageFragmentsById.set(id, pageFragments);
          const wrapperExact = wrapperIds.length === 1 && wrapperIds[0] === id;
          const pageExact = pageFragments.length > 0;
          if (wrapperExact || pageExact) corroboratedIdFound = true;

          const pageUsernames = unique(
            pageFragments.map((item) => getItemUsername(normalizeTikTokItemFragment(item) || item)),
          );
          const reactUsernames = unique(
            nearbyEntries
              .filter((entry) => entry.id === id)
              .map((entry) =>
                getItemUsername(normalizeTikTokItemFragment(entry.item) || entry.item),
              ),
          );
          let username = "";
          let authorEvidence = "";
          let conflictingUsernames = [];
          if (pageUsernames.length === 1) {
            username = pageUsernames[0];
            authorEvidence = "page-exact-author";
          } else if (pageUsernames.length > 1) {
            conflictingUsernames = pageUsernames;
            authorEvidence = "page-exact-author";
          } else if (reactUsernames.length === 1) {
            username = reactUsernames[0];
            authorEvidence = "local-react-author";
          } else if (reactUsernames.length > 1) {
            conflictingUsernames = reactUsernames;
            authorEvidence = "local-react-author";
          } else if (structuredDomUsernames.length === 1) {
            username = structuredDomUsernames[0];
            authorEvidence = "structured-dom-author";
          } else if (structuredDomUsernames.length > 1) {
            conflictingUsernames = structuredDomUsernames;
            authorEvidence = "structured-dom-author";
          } else if (allDomUsernames.length === 1) {
            username = allDomUsernames[0];
            authorEvidence = "single-dom-author-link";
          } else if (allDomUsernames.length > 1) {
            conflictingUsernames = allDomUsernames;
            authorEvidence = "unstructured-dom-links";
          }

          const item =
            pageFragments.find((fragment) => getImagePostPayload(fragment)) ||
            nearbyEntries.find((entry) => entry.id === id)?.item ||
            pageFragments[0] ||
            null;
          corroboration.push({
            id,
            wrapperExact,
            pageExact,
            pageUsernames,
            reactUsernames,
            structuredDomUsernames,
            allDomUsernames,
            selectedUsername: username,
            authorEvidence,
            conflictingUsernames,
            fragmentCount: pageFragments.length,
          });
          if (conflictingUsernames.length) {
            authorAmbiguities.push({ id, authorEvidence, usernames: conflictingUsernames });
            continue;
          }
          if ((!wrapperExact && !pageExact) || !username) continue;
          const evidence = wrapperExact
            ? "local-react-wrapper-author"
            : "local-react-page-exact";
          addCandidate(
            {
              id,
              type: getItemTypeFromRawItem(item || {}),
              username,
              evidence,
            },
            {
              reactBound: true,
              wrapperExact,
              pageExact,
              authorEvidence,
              pageFragmentCount: pageFragments.length,
            },
          );
        }
        trace.stages.push({ stage: "identity-corroboration", entries: corroboration });
        trace.authorAmbiguities = authorAmbiguities;
        trace.corroboratedIdFound = corroboratedIdFound;
        compared = compareIdentityCandidates(candidates);
      }

      if (!compared.candidate && ancestorEvidence.ambiguousIds.length > 1) {
        return fail("current-item-ambiguous", {
          candidateIds: ancestorEvidence.ambiguousIds,
          evidence: "ancestor-evidence",
        });
      }
      if (compared.ambiguousIds.length) {
        return fail("current-item-ambiguous", {
          candidateIds: compared.ambiguousIds,
          evidenceRank: compared.topRank || 0,
        });
      }
      if (compared.candidate) {
        const selected = compared.candidate;
        let pageFragments = pageFragmentsById.get(selected.identity.id) || [];
        const shouldVerifyPageAuthor = ![
          "page-url",
          "local-permalink",
        ].includes(selected.identity.evidence);
        if (shouldVerifyPageAuthor && !pageFragments.length) {
          pageFragments = collectPageDataCandidates(this.document, this.window).flatMap((data) =>
            collectExactItemsInKnownData(data, selected.identity.id),
          );
          if (pageFragments.length) pageFragmentsById.set(selected.identity.id, pageFragments);
        }
        if (shouldVerifyPageAuthor) {
          const exactPageUsernames = unique(
            pageFragments.map((item) =>
              getItemUsername(normalizeTikTokItemFragment(item) || item),
            ),
          );
          if (exactPageUsernames.length > 1) {
            return fail("current-item-author-ambiguous", {
              conflicts: [
                {
                  id: selected.identity.id,
                  authorEvidence: "page-exact-author",
                  usernames: exactPageUsernames,
                },
              ],
            });
          }
          if (exactPageUsernames.length === 1) {
            selected.identity.username = exactPageUsernames[0];
            selected.identity.permalink = buildTikTokItemPermalink(selected.identity);
            selected.details = {
              ...(selected.details || {}),
              authorEvidence: "page-exact-author",
            };
          }
        }
        const fragments = reactResult.entries
          .filter((entry) => entry.id === selected.identity.id)
          .map((entry) => entry.item);
        const result = {
          ok: true,
          identity: selected.identity,
          fragments,
          pageFragments,
          version: trace.domVersion,
        };
        trace.result = "success";
        trace.selected = {
          ...selected.identity,
          rank: selected.rank,
          fragmentCount: fragments.length,
          pageFragmentCount: pageFragments.length,
          authorEvidence: selected.details?.authorEvidence || "",
        };
        this.lastTrace = trace;
        return result;
      }

      if (ensureArray(trace.authorAmbiguities).length) {
        return fail("current-item-author-ambiguous", {
          conflicts: trace.authorAmbiguities,
        });
      }
      if (trace.corroboratedIdFound) {
        return fail("current-item-author-not-found", {
          anchorFound: Boolean(anchorElement),
          contextFound: Boolean(context),
          mediaTag: trace.mediaTag,
        });
      }

      const contextNotReady = Boolean(
        !context ||
          anchorElement?.isConnected === false ||
          (mediaElement?.getBoundingClientRect?.().width || 0) <= 0,
      );
      return fail(
        contextNotReady ? "current-item-context-not-ready" : "current-item-id-not-found",
        {
          anchorFound: Boolean(anchorElement),
          contextFound: Boolean(context),
          mediaTag: trace.mediaTag,
        },
      );
    }

    getDebugSnapshot() {
      return this.lastTrace ? JSON.parse(JSON.stringify(this.lastTrace)) : null;
    }
  }

  function isMeaningfulItemValue(value) {
    if (value === undefined || value === null || value === "") return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") {
      try {
        return Object.keys(value).length > 0;
      } catch (_err) {
        return false;
      }
    }
    return true;
  }

  function isPlainItemRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    try {
      const prototype = Object.getPrototypeOf(value);
      return prototype === Object.prototype || prototype === null;
    } catch (_err) {
      return false;
    }
  }

  function mergeFilledItemRecords(records = [], depth = 0) {
    const result = {};
    for (const record of ensureArray(records)) {
      if (!record || typeof record !== "object" || Array.isArray(record)) continue;
      for (const [key, value] of Object.entries(record)) {
        if (!isMeaningfulItemValue(value)) continue;
        const current = result[key];
        if (Array.isArray(value)) {
          if (!Array.isArray(current) || value.length >= current.length) result[key] = value;
        } else if (
          depth < 3 &&
          isPlainItemRecord(value) &&
          isPlainItemRecord(current)
        ) {
          result[key] = mergeFilledItemRecords([current, value], depth + 1);
        } else {
          result[key] = value;
        }
      }
    }
    return result;
  }

  function mergeExactItemFragments(fragments = [], targetId = "") {
    const id = String(targetId || "");
    const seen = new Set();
    const exact = [];
    for (const rawItem of ensureArray(fragments)) {
      if (!rawItem || typeof rawItem !== "object" || seen.has(rawItem)) continue;
      seen.add(rawItem);
      const item = normalizeTikTokItemFragment(rawItem);
      if (
        !item ||
        getVideoItemId(item) !== id ||
        !isItemDataFragment(item)
      ) {
        continue;
      }
      exact.push(item);
    }
    if (!exact.length) return null;

    const lastValue = (...keys) => {
      let result;
      for (const item of exact) {
        for (const key of keys) {
          if (isMeaningfulItemValue(item?.[key])) result = item[key];
        }
      }
      return result;
    };
    const mergeAliases = (aliases) =>
      mergeFilledItemRecords(
        exact.flatMap((item) => aliases.map((key) => item?.[key])).filter(Boolean),
      );

    const merged = { id };
    const scalarGroups = {
      desc: ["description", "desc"],
      createTime: ["create_time", "createTime"],
      shareUrl: ["share_url", "shareUrl"],
      groupId: ["group_id", "groupID", "groupId"],
      duetEnabled: ["duet_enabled", "allowDuet", "duetEnabled"],
      stitchEnabled: ["stitch_enabled", "allowStitch", "stitchEnabled"],
      isPrivate: ["privateItem", "isPrivate"],
      canComment: ["allowComment", "canComment"],
      canShare: ["allowShare", "canShare"],
      allowDownload: ["canDownload", "allowDownload"],
    };
    for (const [target, aliases] of Object.entries(scalarGroups)) {
      const value = lastValue(...aliases);
      if (isMeaningfulItemValue(value)) merged[target] = value;
    }

    const author = mergeAliases(["authorInfo", "author"]);
    const authorStats = mergeAliases(["authorStats"]);
    const video = mergeAliases(["video"]);
    const imagePost = mergeFilledItemRecords(
      exact.map((item) => getImagePostPayload(item)).filter(Boolean),
    );
    const music = mergeAliases(["music"]);
    const stats = mergeAliases(["statsV2", "stats"]);
    const shareInfo = mergeAliases(["share_info", "shareInfo"]);
    const awemeControl = mergeAliases(["aweme_control", "awemeControl"]);
    const download = mergeAliases(["downloadInfo", "download_info", "download"]);

    if (Object.keys(author).length) merged.author = author;
    if (Object.keys(authorStats).length) merged.authorStats = authorStats;
    if (Object.keys(video).length) merged.video = video;
    if (Object.keys(imagePost).length) merged.imagePost = imagePost;
    if (Object.keys(music).length) merged.music = music;
    if (Object.keys(stats).length) merged.stats = stats;
    if (Object.keys(shareInfo).length) merged.shareInfo = shareInfo;
    if (Object.keys(awemeControl).length) merged.awemeControl = awemeControl;
    if (Object.keys(download).length) merged.download = download;

    for (const key of ["challenges", "textExtra", "contents"]) {
      const arrays = exact.map((item) => item?.[key]).filter((value) => Array.isArray(value));
      if (arrays.length) {
        merged[key] = arrays.reduce(
          (best, value) => (value.length >= best.length ? value : best),
          [],
        );
      }
    }
    return merged;
  }

  function summarizeExactItem(item, pageUrl = "", config = DEFAULT_CONFIG) {
    const media = normalizeMediaItem(item, pageUrl, config);
    return {
      usable: hasUsableMedia(media),
      videoSourceCount: ensureArray(media?.video?.sources).length,
      imageCount: ensureArray(media?.images).length,
      hasAuthorName: Boolean(media?.author?.nickname || media?.author?.uniqueId),
      hasAvatar: Boolean(media?.author?.avatarUrl),
      selectedSourceType: media?.video?.primarySource?.sourceType || "",
      selectedSourceIndex: media?.video?.primarySource?.sourceIndex ?? null,
      selectedSourceWatermark: media?.video?.primarySource?.watermarkStatus || "unknown",
    };
  }

  class ItemDataProvider {
    constructor(doc, win) {
      this.document = doc;
      this.window = win;
      this.cache = new Map();
      this.lastTrace = null;
    }

    getCached(id) {
      const key = String(id || "");
      const entry = this.cache.get(key);
      if (!entry) return null;
      if (Date.now() - Number(entry.fetchedAt || 0) > ITEM_DETAIL_CACHE_TTL_MS) {
        this.cache.delete(key);
        return null;
      }
      this.cache.delete(key);
      this.cache.set(key, entry);
      return entry.item;
    }

    putCached(id, item) {
      const key = String(id || "");
      if (!key || !item) return;
      this.cache.delete(key);
      this.cache.set(key, { item, fetchedAt: Date.now() });
      while (this.cache.size > ITEM_DETAIL_CACHE_LIMIT) {
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
      }
    }

    collectPageFragments(id) {
      const fragments = [];
      for (const data of collectPageDataCandidates(this.document, this.window)) {
        fragments.push(...collectExactItemsInKnownData(data, id));
      }
      return fragments;
    }

    enrichAuthorIdentity(item, identity = {}) {
      if (!item) return item;
      const canonical = parseTikTokItemIdentityFromUrl(identity?.permalink || "");
      const username = String(identity?.username || canonical?.username || "").replace(/^@/, "");
      if (!username) return item;
      const sourceAuthor = item.author || item.authorInfo || {};
      return {
        ...item,
        author: {
          ...sourceAuthor,
          uniqueId:
            sourceAuthor.uniqueId ||
            sourceAuthor.unique_id ||
            username,
          nickname:
            sourceAuthor.nickname ||
            sourceAuthor.nickName ||
            sourceAuthor.uniqueId ||
            sourceAuthor.unique_id ||
            username,
        },
      };
    }

    resolve(resolution = {}, config = DEFAULT_CONFIG) {
      const identity = resolution.identity || resolution;
      const id = String(identity?.id || "");
      const localFragments = ensureArray(resolution.fragments);
      const suppliedPageFragments = ensureArray(resolution.pageFragments);
      const pageFragments = suppliedPageFragments.length
        ? suppliedPageFragments
        : id
          ? this.collectPageFragments(id)
          : [];
      const cached = id ? this.getCached(id) : null;
      const trace = {
        capturedAt: new Date().toISOString(),
        targetId: id,
        permalink: identity?.permalink || "",
        identityEvidence: identity?.evidence || "",
        localFragmentCount: localFragments.length,
        pageFragmentCount: pageFragments.length,
        cacheHit: Boolean(cached),
      };
      const finish = (result) => {
        this.lastTrace = {
          ...trace,
          result: result?.ok ? "success" : "failure",
          source: result?.source || "",
          errorCode: result?.code || "",
          details: result?.details || null,
        };
        return result;
      };

      if (!id) return finish({ ok: false, code: "current-item-id-not-found" });
      const merged = this.enrichAuthorIdentity(
        mergeExactItemFragments(
          [cached, ...localFragments, ...pageFragments].filter(Boolean),
          id,
        ),
        identity,
      );
      trace.merged = summarizeExactItem(
        merged,
        identity?.permalink || this.window?.location?.href || "",
        config,
      );
      if (!hasUsableRawMediaItem(
        merged,
        identity?.permalink || this.window?.location?.href || "",
        config,
      )) {
        return finish({
          ok: false,
          code: merged ? "media-empty" : "detail-data-missing",
          details: {
            localFragmentCount: localFragments.length,
            pageFragmentCount: pageFragments.length,
          },
        });
      }

      this.putCached(id, merged);
      const source = pageFragments.length
        ? "local-page-exact"
        : localFragments.length
          ? "local-exact"
          : "exact-memory-cache";
      return finish({ ok: true, source, item: merged });
    }

    getDebugSnapshot() {
      return {
        cacheSize: this.cache.size,
        last: this.lastTrace ? JSON.parse(JSON.stringify(this.lastTrace)) : null,
      };
    }
  }

  class MenuLifecycle {
    constructor(win, options = {}) {
      this.window = win;
      this.durationMs = Number(options.durationMs || 170);
      this.onStateChange = options.onStateChange || null;
      this.onClosed = options.onClosed || null;
      this.stateElement = null;
      this.menu = null;
      this.timer = null;
      this.animationHandler = null;
    }

    attach(stateElement, menu) {
      this.stateElement = stateElement || null;
      this.menu = menu || null;
      return this;
    }

    get isOpen() {
      return Boolean(this.stateElement?.classList?.contains?.("open"));
    }

    get isClosing() {
      return Boolean(this.stateElement?.classList?.contains?.("closing"));
    }

    clearPending() {
      if (this.timer) {
        this.window?.clearTimeout?.(this.timer);
        this.timer = null;
      }
      if (this.animationHandler && this.menu) {
        this.menu.removeEventListener?.("animationend", this.animationHandler);
      }
      this.animationHandler = null;
    }

    open(onOpen = null) {
      if (!this.stateElement || !this.menu || this.isOpen || this.isClosing) return false;
      this.stateElement.classList.add("open");
      this.onStateChange?.("open");
      onOpen?.();
      return true;
    }

    close(onBeforeClose = null) {
      if (!this.stateElement || !this.menu || !this.isOpen || this.isClosing) return false;
      onBeforeClose?.();
      this.stateElement.classList.add("closing");
      this.onStateChange?.("closing");
      const finish = () => this.finish();
      this.animationHandler = (event) => {
        if (event.target !== this.menu) return;
        if (event.animationName !== `${SCRIPT_PREFIX}-menu-slide-fade-out`) return;
        finish();
      };
      this.menu.addEventListener?.("animationend", this.animationHandler);
      this.timer = this.window?.setTimeout?.(finish, this.durationMs) || null;
      return true;
    }

    finish() {
      if (!this.stateElement) return;
      this.clearPending();
      this.stateElement.classList.remove("open", "closing");
      this.onStateChange?.("closed");
      this.onClosed?.();
    }

    closeImmediate() {
      this.finish();
    }
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
      const data = sanitizeConfig({ ...this.data, ...next });
      this.storage?.setItem(CONFIG_KEY, JSON.stringify(data));
      this.data = data;
      return this.data;
    }

    get() {
      return { ...this.data };
    }
  }

  class TikTokMediaExtractor {
    constructor(doc, win) {
      this.document = doc;
      this.window = win;
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

  function createTuxIconButton(doc, label, onClick, kind = "close", className = "") {
    const isSave = kind === "save";
    const button = createElement(
      doc,
      "button",
      `TUXButton TUXButton--capsule TUXButton--medium TUXButton--${isSave ? "primary" : "secondary"} ${SCRIPT_PREFIX}-icon-button ${SCRIPT_PREFIX}-${isSave ? "save" : "close"}-button${className ? ` ${className}` : ""}`,
    );
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.title = label;

    const content = createElement(doc, "div", "TUXButton-content");
    const iconContainer = createElement(doc, "div", "TUXButton-iconContainer");
    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("viewBox", "0 0 48 48");
    svg.setAttribute("width", "1em");
    svg.setAttribute("height", "1em");
    svg.setAttribute("aria-hidden", "true");
    const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", isSave
      ? "M40.3 14.7a1 1 0 0 1 0 1.42L20.42 36a2 2 0 0 1-2.84 0L7.7 26.12a1 1 0 0 1 0-1.42l1.42-1.4a1 1 0 0 1 1.42 0L19 31.76 37.46 13.3a1 1 0 0 1 1.42 0l1.42 1.4Z"
      : "M38.7 12.12a1 1 0 0 0 0-1.41l-1.4-1.42a1 1 0 0 0-1.42 0L24 21.17 12.12 9.3a1 1 0 0 0-1.41 0l-1.42 1.42a1 1 0 0 0 0 1.41L21.17 24 9.3 35.88a1 1 0 0 0 0 1.41l1.42 1.42a1 1 0 0 0 1.41 0L24 26.83 35.88 38.7a1 1 0 0 0 1.41 0l1.42-1.42a1 1 0 0 0 0-1.41L26.83 24 38.7 12.12Z");
    svg.appendChild(path);
    iconContainer.appendChild(svg);
    content.appendChild(iconContainer);
    button.appendChild(content);
    if (typeof onClick === "function") button.addEventListener("click", onClick);
    return button;
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
  const CINEMA_MODE_ROOT_SELECTOR = '[role="dialog"][aria-label="Cinema mode"]';
  const CINEMA_MORE_BUTTON_SELECTOR =
    'button[data-testid="tux-web-button"][aria-haspopup="dialog"]';

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

  function getCinemaModeRoot(doc = root?.document) {
    return doc?.querySelector?.(CINEMA_MODE_ROOT_SELECTOR) || null;
  }

  function getVisibleCinemaMoreButton(doc = root?.document, cinema = getCinemaModeRoot(doc)) {
    const win = doc?.defaultView || root;
    const viewportWidth = Number(win?.innerWidth || 0);
    const viewportHeight = Number(win?.innerHeight || 0);
    if (!cinema?.querySelectorAll || !viewportWidth || !viewportHeight) return null;
    return Array.from(cinema.querySelectorAll(CINEMA_MORE_BUTTON_SELECTOR))
      .map((button) => button.closest?.('[data-testid="tux-web-button-container"]') || button)
      .find((anchor) => {
        const rect = anchor.getBoundingClientRect?.();
        return Boolean(
          rect?.width > 0 &&
          rect?.height > 0 &&
          getVisibleRectRatio(rect, viewportWidth, viewportHeight) >= 0.5
        );
      }) || null;
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
    if (getVisibleProfileBrowseDialog(doc)) return "profile-dialog";
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

  function getPanelCoreStyleSheet() {
    return `
:where(.${SCRIPT_PREFIX}-panel, .${SCRIPT_PREFIX}-menu, .${SCRIPT_PREFIX}-modal, .${SCRIPT_PREFIX}-notification-card, .${SCRIPT_PREFIX}-image-button, .${SCRIPT_PREFIX}-profile-bulk-menu) {
  font-family: var(--tux-fontFamilyParagraph, "TikTokFont", Arial, Tahoma, PingFangSC, sans-serif);
}
.${SCRIPT_PREFIX}-panel {
  position: fixed;
  right: 18px;
  top: 25vh;
  bottom: auto;
  left: auto;
  width: 48px;
  height: 48px;
  color: var(--tux-colorTextPrimary);
}
.${SCRIPT_PREFIX}-panel.pending { visibility: hidden; pointer-events: none; }
.${SCRIPT_PREFIX}-image-button {
  position: fixed;
  right: 18px;
  bottom: 80px;
  z-index: 2147483200;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  border-radius: 999px;
  padding: 11px 18px;
  color: var(--tux-colorTextPrimary);
  background: var(--ui-shape-neutral-4);
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  box-shadow: none;
  transition: background-color 0.15s ease;
}
.${SCRIPT_PREFIX}-image-button:hover { background: var(--ui-shape-neutral-3); }
.${SCRIPT_PREFIX}-image-button:focus-visible { outline: 2px solid var(--tux-colorTextSecondary); outline-offset: 2px; }
button.TUXButton.TUXButton--medium.${SCRIPT_PREFIX}-icon-button {
  flex: 0 0 1.75rem;
  width: 1.75rem;
  min-width: 1.75rem;
  height: 1.75rem;
  min-height: 1.75rem;
  padding: 0;
  border: 0;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--tux-colorTextPrimary);
  background: var(--ui-shape-neutral-4);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}
.${SCRIPT_PREFIX}-icon-button .TUXButton-content,
.${SCRIPT_PREFIX}-icon-button .TUXButton-iconContainer { display: flex; align-items: center; justify-content: center; }
.${SCRIPT_PREFIX}-icon-button svg { display: block; width: 1em; height: 1em; pointer-events: none; }
.${SCRIPT_PREFIX}-icon-button:hover { color: var(--tux-colorTextPrimary); background: var(--ui-shape-neutral-3); }
button.TUXButton.${SCRIPT_PREFIX}-icon-button.${SCRIPT_PREFIX}-save-button { color: #fff; background: #fe2c55; }
button.TUXButton.${SCRIPT_PREFIX}-icon-button.${SCRIPT_PREFIX}-save-button:hover { color: #fff; background: #ff4b69; }
.${SCRIPT_PREFIX}-icon-button:focus-visible { outline: 2px solid var(--tux-colorTextSecondary); outline-offset: 2px; }
.${SCRIPT_PREFIX}-panel.embedded {
  position: relative;
  left: auto !important;
  right: auto !important;
  top: auto !important;
  bottom: auto !important;
  flex: 0 0 48px;
  width: 48px;
  height: 48px;
  margin: 0 0 15px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  contain: layout style;
  overflow: visible;
  isolation: isolate;
}
.${SCRIPT_PREFIX}-panel.floating {
  position: fixed;
  z-index: 3999;
  width: 40px;
  height: 40px;
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
  color: var(--tux-colorTextPrimary);
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
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
}
.${SCRIPT_PREFIX}-panel.embedded .${SCRIPT_PREFIX}-launcher-icon-wrapper,
.${SCRIPT_PREFIX}-panel.embedded .${SCRIPT_PREFIX}-launcher-container,
.${SCRIPT_PREFIX}-panel.embedded .${SCRIPT_PREFIX}-launcher {
  flex: 0 0 auto;
  width: 100%;
  height: 100%;
}
.${SCRIPT_PREFIX}-panel.embedded .${SCRIPT_PREFIX}-launcher-container {
  border-radius: var(--tux-v2-radius-control-capsule, 9999px);
  border: 0;
  color: var(--tux-colorTextPrimary);
  background: var(--ui-shape-neutral-4);
  box-shadow: none;
}
.${SCRIPT_PREFIX}-launcher-shell:hover .${SCRIPT_PREFIX}-launcher-container,
.${SCRIPT_PREFIX}-panel.open .${SCRIPT_PREFIX}-launcher-container {
  background: var(--ui-shape-neutral-3);
  color: var(--tux-colorTextPrimary);
  transform: none;
}
.${SCRIPT_PREFIX}-panel.embedded .${SCRIPT_PREFIX}-launcher-shell:hover .${SCRIPT_PREFIX}-launcher-container,
.${SCRIPT_PREFIX}-panel.embedded.open .${SCRIPT_PREFIX}-launcher-container {
  color: var(--tux-colorTextPrimary);
  background: var(--ui-shape-neutral-3);
  transform: none;
}
.${SCRIPT_PREFIX}-launcher svg {
  display: block;
  width: 24px;
  height: 24px;
  pointer-events: none;
  transform: translateY(-1px);
  transform-origin: center;
  overflow: visible;
}
.${SCRIPT_PREFIX}-panel.embedded .${SCRIPT_PREFIX}-launcher {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  cursor: pointer;
  touch-action: manipulation;
  padding: 0;
  border-radius: 0;
  background: transparent;
  font: inherit;
  line-height: 0 !important;
  text-align: center;
  color: var(--tux-colorTextPrimary) !important;
}
.${SCRIPT_PREFIX}-panel.embedded .${SCRIPT_PREFIX}-launcher svg [stroke="currentColor"] {
  stroke: currentColor !important;
}
.${SCRIPT_PREFIX}-panel.embedded .${SCRIPT_PREFIX}-launcher svg [fill="currentColor"] {
  fill: currentColor !important;
}
.${SCRIPT_PREFIX}-panel.embedded .${SCRIPT_PREFIX}-launcher svg {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  margin: 0 auto;
  transform: none;
}
.${SCRIPT_PREFIX}-panel.floating .${SCRIPT_PREFIX}-launcher-shell,
.${SCRIPT_PREFIX}-panel.floating .${SCRIPT_PREFIX}-launcher-icon-wrapper,
.${SCRIPT_PREFIX}-panel.floating .${SCRIPT_PREFIX}-launcher-container,
.${SCRIPT_PREFIX}-panel.floating .${SCRIPT_PREFIX}-launcher {
  flex: 0 0 auto;
  width: 100%;
  height: 100%;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}
.${SCRIPT_PREFIX}-panel.floating .${SCRIPT_PREFIX}-launcher-container {
  border-radius: var(--tux-v2-radius-control-capsule, 9999px);
  color: var(--tux-colorTextPrimary);
  background: var(--ui-shape-neutral-4);
}
.${SCRIPT_PREFIX}-panel.floating .${SCRIPT_PREFIX}-launcher-shell:hover .${SCRIPT_PREFIX}-launcher-container,
.${SCRIPT_PREFIX}-panel.floating.open .${SCRIPT_PREFIX}-launcher-container {
  color: var(--tux-colorTextPrimary);
  background: var(--ui-shape-neutral-3);
}
.${SCRIPT_PREFIX}-panel.floating .${SCRIPT_PREFIX}-launcher {
  cursor: pointer;
  touch-action: manipulation;
  padding: 0;
  border-radius: 0;
  background: transparent;
  line-height: 0 !important;
}
.${SCRIPT_PREFIX}-panel.floating .${SCRIPT_PREFIX}-launcher svg {
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
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
.${SCRIPT_PREFIX}-profile-bulk-wrap:hover, .${SCRIPT_PREFIX}-profile-bulk-wrap.${SCRIPT_PREFIX}-profile-bulk-open { border-radius: 999px; background: var(--ui-shape-neutral-3, rgba(127, 127, 127, 0.19)) !important; }
.${SCRIPT_PREFIX}-profile-bulk-button:focus-visible { outline: 2px solid var(--tux-colorTextSecondary, rgba(127, 127, 127, 0.75)); outline-offset: 2px; border-radius: 999px; }
.${SCRIPT_PREFIX}-profile-bulk-button svg {
  width: 1em;
  height: 1em;
  display: block;
  pointer-events: none;
}
.${SCRIPT_PREFIX}-profile-bulk-menu { width: 160px; }
.${SCRIPT_PREFIX}-profile-select-box {
  position: absolute;
  right: 8px;
  bottom: 8px;
  z-index: 5;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
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
  transition: background-color 140ms ease, border-color 140ms ease;
}
.${SCRIPT_PREFIX}-profile-select-box:hover { background: rgba(22, 24, 35, 0.86); }
.${SCRIPT_PREFIX}-profile-select-box:focus-visible { outline: 2px solid rgba(255, 255, 255, 0.9); outline-offset: 2px; }
.${SCRIPT_PREFIX}-profile-select-box.selected { border-color: #fe2c55; background: #fe2c55; box-shadow: none; }
.${SCRIPT_PREFIX}-profile-select-box.downloaded { border-color: #00a67d; background: #00a67d; }
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
.${SCRIPT_PREFIX}-bulk-confirm-modal { width: min(860px, calc(100vw - 42px)); max-height: min(720px, calc(100vh - 42px)); }
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
.${SCRIPT_PREFIX}-bulk-row input { width: 18px; height: 18px; accent-color: #fe2c55; }
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
.${SCRIPT_PREFIX}-bulk-meta { justify-self: end; display: grid; gap: 6px; justify-items: end; }
.${SCRIPT_PREFIX}-bulk-type {
  border-radius: 999px;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 700;
  background: rgba(254, 44, 85, 0.12);
  color: #fe2c55;
  white-space: nowrap;
}
.${SCRIPT_PREFIX}-bulk-type.downloaded { background: rgba(0, 166, 125, 0.12); color: #00a67d; }
.${SCRIPT_PREFIX}-bulk-status { color: #fe2c55; font-size: 12px; font-weight: 700; white-space: nowrap; }
.${SCRIPT_PREFIX}-bulk-footer {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid rgba(127, 127, 127, 0.2);
}
.${SCRIPT_PREFIX}-advanced-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
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
.${SCRIPT_PREFIX}-profile-slider-field { grid-column: 1 / -1; display: grid; gap: 10px; }
.${SCRIPT_PREFIX}-profile-slider-head {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.${SCRIPT_PREFIX}-profile-slider-head label { margin: 0; flex: 0 0 auto; }
.${SCRIPT_PREFIX}-profile-slider-desc {
  min-width: 0;
  color: var(--tux-colorTextSecondary);
  font-size: 12px;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.${SCRIPT_PREFIX}-profile-slider-value {
  margin-left: auto;
  flex: 0 0 auto;
  min-width: 48px;
  text-align: right;
  color: #fe2c55;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.${SCRIPT_PREFIX}-profile-slider-field input[type="range"] { width: 100%; accent-color: #fe2c55; }
.${SCRIPT_PREFIX}-menu {
  position: absolute;
  z-index: 2147483601;
  left: 50%;
  bottom: 52px;
  transform: none;
  transform-origin: var(--${SCRIPT_PREFIX}-menu-origin, 50% 50%);
  display: none;
  visibility: hidden;
  width: 208px;
  overflow: hidden;
  padding: 4px;
  border-radius: 16px;
  background: var(--tux-colorBGPrimary);
  border: 0;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.16);
  opacity: 1;
  color: var(--tux-colorTextPrimary);
  box-sizing: border-box;
  will-change: transform, opacity, filter;
}
.${SCRIPT_PREFIX}-menu.open, .${SCRIPT_PREFIX}-menu.closing { display: block; }
.${SCRIPT_PREFIX}-menu.open[data-placement], .${SCRIPT_PREFIX}-menu.closing[data-placement] { visibility: visible; }
.${SCRIPT_PREFIX}-menu.open:not(.closing)[data-placement] { animation: ${SCRIPT_PREFIX}-menu-slide-fade-in 145ms cubic-bezier(0.16, 1, 0.3, 1) both; }
.${SCRIPT_PREFIX}-menu.closing[data-placement] { pointer-events: none; animation: ${SCRIPT_PREFIX}-menu-slide-fade-out 105ms cubic-bezier(0.4, 0, 1, 1) both; }
.${SCRIPT_PREFIX}-menu[data-placement="right"] {
  --${SCRIPT_PREFIX}-menu-origin: 0% 50%;
  --${SCRIPT_PREFIX}-menu-start-x: -10px;
  --${SCRIPT_PREFIX}-menu-start-y: 0px;
}
.${SCRIPT_PREFIX}-menu[data-placement="left"] {
  --${SCRIPT_PREFIX}-menu-origin: 100% 50%;
  --${SCRIPT_PREFIX}-menu-start-x: 10px;
  --${SCRIPT_PREFIX}-menu-start-y: 0px;
}
.${SCRIPT_PREFIX}-menu[data-placement="top"] {
  --${SCRIPT_PREFIX}-menu-origin: 50% 100%;
  --${SCRIPT_PREFIX}-menu-start-x: 0px;
  --${SCRIPT_PREFIX}-menu-start-y: 10px;
}
.${SCRIPT_PREFIX}-menu[data-placement="bottom"],
.${SCRIPT_PREFIX}-menu[data-placement="bottom-start"],
.${SCRIPT_PREFIX}-menu[data-placement="bottom-end"] {
  --${SCRIPT_PREFIX}-menu-origin: 50% 0%;
  --${SCRIPT_PREFIX}-menu-start-x: 0px;
  --${SCRIPT_PREFIX}-menu-start-y: -10px;
}
.${SCRIPT_PREFIX}-button {
  border: 0;
  border-radius: 8px;
  min-height: 44px;
  padding: 10px 16px;
  color: var(--tux-colorTextPrimary);
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  text-align: left;
  font-family: inherit;
}
.${SCRIPT_PREFIX}-menu .${SCRIPT_PREFIX}-button { width: 100%; min-height: 52px; border-radius: 8px; background: transparent; font-size: 16px; }
.${SCRIPT_PREFIX}-button.secondary { background: transparent; }
.${SCRIPT_PREFIX}-button:hover { background: var(--ui-shape-neutral-3); color: var(--tux-colorTextPrimary); }
.${SCRIPT_PREFIX}-button:focus-visible { outline: 2px solid var(--tux-colorTextSecondary); outline-offset: 2px; }
    `;
  }

  function getNotificationStyleSheet() {
    return `
.${SCRIPT_PREFIX}-notification-stack {
  position: fixed;
  top: 76px;
  right: 18px;
  z-index: 2147483702;
  width: min(372px, calc(100vw - 28px));
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}
.${SCRIPT_PREFIX}-notification-card {
  width: 100%;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) 34px;
  gap: 10px;
  align-items: center;
  padding: 14px 10px 14px 14px;
  border-radius: 16px;
  color: var(--tux-colorTextPrimary);
  background: var(--tux-colorBGPrimary);
  border: 1px solid var(--ui-shape-neutral-4);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.16);
  font: 14px/1.42 var(--tux-fontFamilyParagraph, "TikTokFont", Arial, Tahoma, PingFangSC, sans-serif);
  pointer-events: auto;
  overflow: hidden;
  transition: opacity 150ms ease, transform 150ms ease;
  animation: ${SCRIPT_PREFIX}-notification-card-in 150ms ease-out;
}
.${SCRIPT_PREFIX}-notification-card.${SCRIPT_PREFIX}-download-status.busy,
.${SCRIPT_PREFIX}-notification-card.${SCRIPT_PREFIX}-download-status.album,
.${SCRIPT_PREFIX}-notification-card.${SCRIPT_PREFIX}-download-status.image {
  border-color: var(--ui-shape-neutral-3);
}
.${SCRIPT_PREFIX}-notification-icon {
  width: 34px;
  height: 34px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: var(--ui-shape-neutral-4);
  color: var(--tux-colorTextPrimary);
  font-weight: 700;
  font-size: 17px;
}
.${SCRIPT_PREFIX}-notification-card.error .${SCRIPT_PREFIX}-notification-icon {
  background: rgba(254, 44, 85, 0.18);
  color: #fe2c55;
}
.${SCRIPT_PREFIX}-notification-card.success .${SCRIPT_PREFIX}-notification-icon {
  background: rgba(37, 244, 238, 0.14);
  color: #25f4ee;
}
.${SCRIPT_PREFIX}-notification-card.${SCRIPT_PREFIX}-download-status.busy .${SCRIPT_PREFIX}-notification-icon,
.${SCRIPT_PREFIX}-notification-card.${SCRIPT_PREFIX}-download-status.album .${SCRIPT_PREFIX}-notification-icon,
.${SCRIPT_PREFIX}-notification-card.${SCRIPT_PREFIX}-download-status.image .${SCRIPT_PREFIX}-notification-icon {
  background: var(--ui-shape-neutral-4);
  color: #fe2c55;
}
.${SCRIPT_PREFIX}-notification-main { min-width: 0; }
.${SCRIPT_PREFIX}-notification-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.${SCRIPT_PREFIX}-notification-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 700;
  font-size: 14px;
}
.${SCRIPT_PREFIX}-notification-meta {
  flex: none;
  color: var(--tux-colorTextSecondary);
  font-weight: 700;
  font-size: 13px;
}
.${SCRIPT_PREFIX}-notification-card.error .${SCRIPT_PREFIX}-notification-meta { color: #fe2c55; }
.${SCRIPT_PREFIX}-notification-card.success .${SCRIPT_PREFIX}-notification-meta { color: #25f4ee; }
.${SCRIPT_PREFIX}-notification-detail {
  margin-top: 4px;
  color: var(--tux-colorTextSecondary);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.${SCRIPT_PREFIX}-notification-close { align-self: center; }
.${SCRIPT_PREFIX}-notification-card.fading { opacity: 0; transform: translateX(12px); pointer-events: none; }
.${SCRIPT_PREFIX}-notification-card.attention { background: var(--ui-shape-neutral-4); }
@keyframes ${SCRIPT_PREFIX}-menu-slide-fade-in {
  from { opacity: 0; transform: translate3d(var(--${SCRIPT_PREFIX}-menu-start-x, 0px), var(--${SCRIPT_PREFIX}-menu-start-y, 0px), 0); }
  to { opacity: 1; transform: translate3d(0, 0, 0); }
}
@keyframes ${SCRIPT_PREFIX}-menu-slide-fade-out {
  from { opacity: 1; transform: translate3d(0, 0, 0); }
  to { opacity: 0; transform: translate3d(var(--${SCRIPT_PREFIX}-menu-start-x, 0px), var(--${SCRIPT_PREFIX}-menu-start-y, 0px), 0); }
}
@keyframes ${SCRIPT_PREFIX}-notification-card-in {
  from { opacity: 0; transform: translateX(12px); }
  to { opacity: 1; transform: translateX(0); }
}
    `;
  }

  function getModalStyleSheet() {
    return `
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
  border-radius: 16px;
  background: var(--tux-colorBGPrimary);
  color: var(--tux-colorTextPrimary);
  font: 14px/1.5 var(--tux-fontFamilyParagraph, "TikTokFont", Arial, Tahoma, PingFangSC, sans-serif);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.16);
}
.${SCRIPT_PREFIX}-modal header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 18px 22px;
  border-bottom: 1px solid var(--ui-shape-neutral-4);
}
.${SCRIPT_PREFIX}-modal main { padding: 18px 22px 22px; }
.${SCRIPT_PREFIX}-modal h2 { margin: 0; font-size: 20px; line-height: 1.2; }
.${SCRIPT_PREFIX}-modal .${SCRIPT_PREFIX}-subtitle { margin: 5px 0 0; color: var(--tux-colorTextSecondary); font-size: 13px; }
.${SCRIPT_PREFIX}-settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.${SCRIPT_PREFIX}-section { display: grid; gap: 12px; margin-bottom: 18px; }
.${SCRIPT_PREFIX}-field { position: relative; min-width: 0; }
.${SCRIPT_PREFIX}-field.full, .${SCRIPT_PREFIX}-settings-grid > .full { grid-column: 1 / -1; }
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
  border: 1px solid var(--ui-shape-neutral-3);
  border-radius: 8px;
  padding: 10px 12px;
  font: inherit;
  color: var(--tux-colorTextPrimary);
  background: var(--tux-colorBGSecondary);
}
.${SCRIPT_PREFIX}-modal input[type="checkbox"] {
  width: auto;
  min-width: 18px;
  height: 18px;
  padding: 0;
  accent-color: #fe2c55;
}
.${SCRIPT_PREFIX}-modal textarea { min-height: 78px; resize: vertical; }
.${SCRIPT_PREFIX}-modal table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 10px;
  font-size: 12px;
}
.${SCRIPT_PREFIX}-modal td,
.${SCRIPT_PREFIX}-modal th {
  border-bottom: 1px solid var(--ui-shape-neutral-4);
  padding: 6px;
  text-align: left;
  vertical-align: top;
}
.${SCRIPT_PREFIX}-detail-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--ui-shape-neutral-4);
}
.${SCRIPT_PREFIX}-detail-tab {
  border: 0;
  border-bottom: 2px solid transparent;
  padding: 9px 10px;
  color: inherit;
  background: transparent;
  cursor: pointer;
  font: inherit;
}
.${SCRIPT_PREFIX}-detail-tab.active { color: #fe2c55; border-bottom-color: #fe2c55; }
.${SCRIPT_PREFIX}-detail-panel[hidden] { display: none !important; }
.${SCRIPT_PREFIX}-kv,
.${SCRIPT_PREFIX}-stat {
  min-width: 0;
  border: 1px solid var(--ui-shape-neutral-4);
  border-radius: 6px;
  padding: 8px 10px;
  background: var(--ui-shape-neutral-4);
}
.${SCRIPT_PREFIX}-kv small,
.${SCRIPT_PREFIX}-stat small {
  display: block;
  margin-bottom: 3px;
  color: var(--tux-colorTextSecondary);
  font-size: 11px;
}
.${SCRIPT_PREFIX}-kv span, .${SCRIPT_PREFIX}-stat strong { display: block; min-width: 0; overflow-wrap: anywhere; }
.${SCRIPT_PREFIX}-link { color: #fe2c55; overflow-wrap: anywhere; }
.${SCRIPT_PREFIX}-json-pre {
  max-height: 360px;
  overflow: auto;
  margin: 0;
  border: 1px solid var(--ui-shape-neutral-3);
  border-radius: 6px;
  padding: 10px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: var(--tux-colorBGSecondary);
  font: 12px Consolas, "Courier New", monospace;
}
.${SCRIPT_PREFIX}-details-modal {
  position: relative;
  width: min(1120px, calc(100vw - 28px));
  overflow: hidden;
  border-radius: 16px;
  background: var(--tux-colorBGPrimary);
  color: var(--tux-colorTextPrimary);
}
.${SCRIPT_PREFIX}-details-modal main {
  display: flex;
  flex-direction: column;
  padding: 0;
  max-height: min(780px, calc(100vh - 28px));
}
.${SCRIPT_PREFIX}-details-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--ui-shape-neutral-4);
  background: var(--tux-colorBGSecondary);
}
button.TUXButton.${SCRIPT_PREFIX}-icon-button.${SCRIPT_PREFIX}-details-close {
  margin: 0 10px;
}
.${SCRIPT_PREFIX}-launcher:focus, .${SCRIPT_PREFIX}-details-modal .${SCRIPT_PREFIX}-detail-tab:focus, .${SCRIPT_PREFIX}-detail-pill:focus { outline: none; }
.${SCRIPT_PREFIX}-launcher:focus-visible,
.${SCRIPT_PREFIX}-details-modal .${SCRIPT_PREFIX}-detail-tab:focus-visible,
.${SCRIPT_PREFIX}-detail-pill:focus-visible {
  outline: 2px solid var(--tux-colorTextSecondary);
  outline-offset: 2px;
}
.${SCRIPT_PREFIX}-details-modal .${SCRIPT_PREFIX}-detail-tabs {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  gap: 0;
  margin: 0;
  padding: 0 0 0 12px;
  overflow-x: auto;
}
.${SCRIPT_PREFIX}-details-modal .${SCRIPT_PREFIX}-detail-tab {
  min-width: 112px;
  border: 0;
  border-bottom: 3px solid transparent;
  padding: 18px 20px 15px;
  color: var(--tux-colorTextSecondary);
  background: transparent;
  font-size: 16px;
  font-weight: 700;
}
.${SCRIPT_PREFIX}-details-modal .${SCRIPT_PREFIX}-detail-tab.active { color: #fe2c55; border-bottom-color: #fe2c55; background: rgba(254, 44, 85, 0.06); }
.${SCRIPT_PREFIX}-detail-body { flex: 1 1 auto; overflow: auto; padding: 22px 28px 28px; }
.${SCRIPT_PREFIX}-detail-fieldset {
  min-width: 0;
  margin: 0 0 22px;
  border: 1px solid var(--ui-shape-neutral-3);
  border-radius: 12px;
  padding: 22px 24px;
  background: transparent;
}
.${SCRIPT_PREFIX}-detail-fieldset legend { padding: 0 12px; font-weight: 800; font-size: 14px; }
.${SCRIPT_PREFIX}-detail-cover-row,
.${SCRIPT_PREFIX}-detail-author-head {
  display: flex;
  gap: 22px;
  align-items: center;
  min-width: 0;
}
.${SCRIPT_PREFIX}-detail-cover-row.${SCRIPT_PREFIX}-cover-portrait { flex-direction: row; align-items: center; }
.${SCRIPT_PREFIX}-detail-cover-row.${SCRIPT_PREFIX}-cover-landscape { flex-direction: column; align-items: flex-start; }
.${SCRIPT_PREFIX}-detail-cover-row.${SCRIPT_PREFIX}-cover-square { flex-direction: row; }
.${SCRIPT_PREFIX}-detail-cover {
  width: 180px;
  height: 101px;
  max-width: 34vw;
  aspect-ratio: 16 / 9;
  border-radius: 6px;
  object-fit: cover;
  background: var(--tux-colorBGSecondary);
}
.${SCRIPT_PREFIX}-detail-cover-row.${SCRIPT_PREFIX}-cover-portrait .${SCRIPT_PREFIX}-detail-cover {
  width: min(252px, 40vw);
  height: min(448px, 71.1vw);
  max-width: 100%;
  aspect-ratio: 9 / 16;
}
.${SCRIPT_PREFIX}-detail-cover-row.${SCRIPT_PREFIX}-cover-portrait > div, .${SCRIPT_PREFIX}-detail-cover-row.${SCRIPT_PREFIX}-cover-square > div { flex: 1 1 190px; min-width: 170px; }
.${SCRIPT_PREFIX}-detail-cover-row.${SCRIPT_PREFIX}-cover-square .${SCRIPT_PREFIX}-detail-cover { width: 150px; height: 150px; aspect-ratio: 1; }
.${SCRIPT_PREFIX}-detail-cover-row.${SCRIPT_PREFIX}-cover-landscape .${SCRIPT_PREFIX}-detail-cover { width: min(420px, 100%); height: auto; max-width: 100%; }
.${SCRIPT_PREFIX}-detail-cover-row.${SCRIPT_PREFIX}-cover-landscape > div { width: min(420px, 100%); min-width: 0; }
.${SCRIPT_PREFIX}-detail-avatar {
  width: 76px;
  height: 76px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--tux-colorBGSecondary);
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
  border: 1px solid var(--ui-shape-neutral-3);
  border-radius: 999px;
  padding: 5px 14px;
  color: inherit;
  background: var(--ui-shape-neutral-4);
  cursor: pointer;
  text-decoration: none;
  font: 13px var(--tux-fontFamilyParagraph, "TikTokFont", Arial, Tahoma, PingFangSC, sans-serif);
  white-space: nowrap;
}
.${SCRIPT_PREFIX}-detail-pill:hover { color: var(--tux-colorTextPrimary); border-color: var(--ui-shape-neutral-3); background: var(--ui-shape-neutral-3); }
.${SCRIPT_PREFIX}-detail-table-wrap { overflow: auto; border: 1px solid var(--ui-shape-neutral-3); border-radius: 8px; }
.${SCRIPT_PREFIX}-detail-table {
  margin: 0;
  min-width: 780px;
  border-collapse: collapse;
  font-size: 13px;
}
.${SCRIPT_PREFIX}-detail-table th,
.${SCRIPT_PREFIX}-detail-table td {
  border-right: 1px solid var(--ui-shape-neutral-4);
  border-bottom: 1px solid var(--ui-shape-neutral-4);
  padding: 12px;
  vertical-align: middle;
}
.${SCRIPT_PREFIX}-detail-table th { font-weight: 800; background: rgba(127, 127, 127, 0.08); }
.${SCRIPT_PREFIX}-detail-rows {
  width: 100%;
  border-collapse: collapse;
  margin: 0;
  font-size: 14px;
}
.${SCRIPT_PREFIX}-detail-rows th, .${SCRIPT_PREFIX}-detail-rows td { border-bottom: 1px solid var(--ui-shape-neutral-4); padding: 10px 0; vertical-align: top; }
.${SCRIPT_PREFIX}-detail-rows th {
  width: 150px;
  padding-right: 18px;
  color: var(--tux-colorTextSecondary);
  text-align: left;
  font-weight: 800;
}
.${SCRIPT_PREFIX}-detail-value { overflow-wrap: anywhere; white-space: pre-wrap; }
.${SCRIPT_PREFIX}-detail-json-actions { display: flex; gap: 10px; margin-bottom: 10px; }
.${SCRIPT_PREFIX}-details-modal .${SCRIPT_PREFIX}-json-pre { max-height: 560px; border-color: var(--ui-shape-neutral-3); }
.${SCRIPT_PREFIX}-detail-audio {
  width: 100%;
  min-width: 0;
  height: 54px;
  margin: 0;
}
.${SCRIPT_PREFIX}-detail-music-section { overflow: hidden; }
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
  background: var(--tux-colorBGSecondary);
}
.${SCRIPT_PREFIX}-detail-audio-row .${SCRIPT_PREFIX}-detail-audio { flex: 1 1 auto; width: auto; }
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
.${SCRIPT_PREFIX}-detail-media-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 22px;
  align-items: stretch;
}
.${SCRIPT_PREFIX}-detail-media-grid > .${SCRIPT_PREFIX}-detail-fieldset { margin-bottom: 22px; }
.${SCRIPT_PREFIX}-cover-resolution {
  display: inline-block;
  font-size: 22px;
  line-height: 1.25;
  white-space: nowrap;
  overflow-wrap: normal;
  word-break: keep-all;
  letter-spacing: 0;
}
.${SCRIPT_PREFIX}-settings-modal {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(860px, calc(100vw - 72px));
  max-height: min(700px, calc(100vh - 72px));
  overflow: hidden;
  border-radius: 16px;
  background: var(--tux-colorBGPrimary);
  color: var(--tux-colorTextPrimary);
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
  border-bottom: 1px solid var(--ui-shape-neutral-4);
  background: var(--tux-colorBGSecondary);
}
.${SCRIPT_PREFIX}-settings-header h2 {
  margin: 0;
  color: #fe2c55;
  font-size: 20px;
  font-weight: 800;
}
.${SCRIPT_PREFIX}-settings-header-actions { display: flex; gap: 10px; align-items: center; }
.${SCRIPT_PREFIX}-settings-fieldset .${SCRIPT_PREFIX}-settings-grid { align-items: start; }
.${SCRIPT_PREFIX}-settings-fieldset { margin-bottom: 16px; padding: 17px 20px 19px; }
.${SCRIPT_PREFIX}-settings-note {
  display: flex;
  align-items: center;
  min-height: 42px;
  box-sizing: border-box;
  border: 1px solid var(--ui-shape-neutral-4);
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--ui-shape-neutral-4);
}
.${SCRIPT_PREFIX}-filename-template-editor { display: grid; gap: 12px; }
.${SCRIPT_PREFIX}-filename-preview {
  min-height: 22px;
  border-top: 1px solid var(--ui-shape-neutral-3);
  padding-top: 12px;
  color: inherit;
  font-weight: 700;
  overflow-wrap: anywhere;
}
.${SCRIPT_PREFIX}-frame-modal { width: min(560px, calc(100vw - 28px)); overflow: hidden; }
.${SCRIPT_PREFIX}-frame-preview {
  width: 100%;
  max-height: min(60vh, 520px);
  border-radius: 8px;
  object-fit: contain;
  background: var(--tux-colorBGSecondary);
}
.${SCRIPT_PREFIX}-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.${SCRIPT_PREFIX}-row .${SCRIPT_PREFIX}-button {
  width: auto;
  min-width: auto;
  border-radius: 6px;
  background: var(--ui-shape-neutral-3);
  text-align: center;
}
.${SCRIPT_PREFIX}-row .${SCRIPT_PREFIX}-button.danger { color: #fe2c55; border: 1px solid #fe2c55; background: rgba(254, 44, 85, 0.08); }
.${SCRIPT_PREFIX}-row .${SCRIPT_PREFIX}-button.danger:hover { color: #fe2c55; background: var(--ui-shape-neutral-3); }
.${SCRIPT_PREFIX}-button.TUXButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: auto;
  min-width: 96px;
  min-height: 36px;
  padding: 6px 16px;
  border-radius: 999px;
  line-height: 24px;
  text-align: center;
}
.${SCRIPT_PREFIX}-button.TUXButton .TUXButton-content { display: flex; align-items: center; justify-content: center; }
.${SCRIPT_PREFIX}-button.TUXButton.primary { color: #fff; background: #fe2c55; }
.${SCRIPT_PREFIX}-button.TUXButton.primary:hover:not(:disabled) { color: #fff; background: #ff4b69; }
.${SCRIPT_PREFIX}-button.TUXButton.secondary { color: var(--tux-colorTextPrimary); background: var(--ui-shape-neutral-4); }
.${SCRIPT_PREFIX}-button.TUXButton.secondary:hover:not(:disabled) { color: var(--tux-colorTextPrimary); background: var(--ui-shape-neutral-3); }
.${SCRIPT_PREFIX}-button.TUXButton:disabled { cursor: not-allowed; opacity: 0.4; }
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
  border: 1px solid var(--ui-shape-neutral-3);
  border-radius: 999px;
  padding: 7px 10px;
  color: var(--tux-colorTextPrimary);
  background: var(--ui-shape-neutral-4);
  cursor: pointer;
  font: 12px var(--tux-fontFamilyParagraph, "TikTokFont", Arial, Tahoma, PingFangSC, sans-serif);
}
.${SCRIPT_PREFIX}-chip.available { cursor: pointer; background: transparent; }
.${SCRIPT_PREFIX}-chip.separator { border-style: dashed; }
.${SCRIPT_PREFIX}-chip small { color: var(--tux-colorTextSecondary); font-size: 11px; }
.${SCRIPT_PREFIX}-check-chip {
  display: inline-flex !important;
  align-items: center;
  gap: 7px;
  margin: 0 !important;
  border: 1px solid var(--ui-shape-neutral-3);
  border-radius: 999px;
  padding: 7px 10px;
  color: inherit;
  background: var(--ui-shape-neutral-4);
  cursor: pointer;
  font: 12px var(--tux-fontFamilyParagraph, "TikTokFont", Arial, Tahoma, PingFangSC, sans-serif);
}
.${SCRIPT_PREFIX}-check-chip input {
  width: 14px !important;
  height: 14px;
  margin: 0;
  padding: 0;
  accent-color: #fe2c55;
}
.${SCRIPT_PREFIX}-readonly { color: var(--tux-colorTextSecondary); font-size: 13px; line-height: 1.45; }
.${SCRIPT_PREFIX}-actions { justify-content: flex-end; padding-top: 6px; border-top: 1px solid var(--ui-shape-neutral-4); }
@media (max-width: 720px) {
  .${SCRIPT_PREFIX}-settings-grid, .${SCRIPT_PREFIX}-detail-media-grid { grid-template-columns: 1fr; }
  .${SCRIPT_PREFIX}-modal header { padding: 16px; border-bottom: 1px solid var(--ui-shape-neutral-4); }
  .${SCRIPT_PREFIX}-modal main, .${SCRIPT_PREFIX}-settings-modal main { padding: 16px; }
}
    `;
  }

  function getPanelStyleSheet() {
    return [
      getPanelCoreStyleSheet(),
      getNotificationStyleSheet(),
      getModalStyleSheet(),
    ].join("\n");
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
      return { element, ...getRectEdges(rect) };
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

    getNativeActionChildren(host) {
      return Array.from(host?.children || []).filter((child) => !this.app.isOwnUiElement?.(child));
    }

    getActionBarInsertionReference(host) {
      const nativeChildren = this.getNativeActionChildren(host);
      return nativeChildren[0] || null;
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
      this.mutationObserver = null;
      this.mutationRoot = null;
      this.outsideHandler = null;
      this.lastScanStats = null;
      this.menuLifecycle = new MenuLifecycle(app.window, {
        onClosed: () => {
          this.buttonWrapper?.classList?.remove?.(`${SCRIPT_PREFIX}-profile-bulk-open`);
          this.clearMenuPosition();
          this.unbindOutsideClose();
        },
      });
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

    mount(userMore = this.findUserMoreButton()) {
      if (!this.isProfilePage()) {
        this.unmount();
        return false;
      }
      this.syncProfileContext();
      if (userMore) {
        this.ensureButton(userMore);
      } else {
        this.unmountButtonOnly();
      }
      this.enterSelectionMode();
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
      const menu = createElement(this.document, "div", `${SCRIPT_PREFIX}-menu ${SCRIPT_PREFIX}-profile-bulk-menu`);
      menu.addEventListener("pointerdown", (event) => event.stopPropagation());
      menu.addEventListener("click", (event) => {
        if (menu.classList.contains("closing")) {
          event.preventDefault();
          event.stopImmediatePropagation?.();
          return;
        }
        event.stopPropagation();
      });
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
      this.menuLifecycle.attach(menu, menu);
      return menu;
    }

    toggleMenu(force = null) {
      const menu = this.ensureMenu();
      this.menuLifecycle.attach(menu, menu);
      const shouldOpen = force === null ? !this.menuLifecycle.isOpen : Boolean(force);
      if (shouldOpen) {
        this.menuLifecycle.open(() => {
          this.enterSelectionMode();
          this.updateMenuLabels();
          this.buttonWrapper?.classList?.add?.(`${SCRIPT_PREFIX}-profile-bulk-open`);
          this.positionMenu();
          this.bindOutsideClose();
        });
        return;
      }
      this.menuLifecycle.close(() => {
        this.buttonWrapper?.classList?.remove?.(`${SCRIPT_PREFIX}-profile-bulk-open`);
      });
    }

    closeMenu(immediate = false) {
      if (!this.menu) return;
      this.menuLifecycle.attach(this.menu, this.menu);
      if (immediate) {
        this.menuLifecycle.closeImmediate();
      } else {
        this.menuLifecycle.close(() => {
          this.buttonWrapper?.classList?.remove?.(`${SCRIPT_PREFIX}-profile-bulk-open`);
        });
      }
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
        if (this.menu?.classList?.contains?.("closing")) return;
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
      if (menu.classList.contains("closing")) return;
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
      menu.style.position = "fixed";
      menu.style.left = `${Math.round(placement.left)}px`;
      menu.style.top = `${Math.round(placement.top)}px`;
      menu.style.right = "auto";
      menu.style.bottom = "auto";
      menu.style.transform = "none";
      menu.dataset.placement = placement.placement;
    }

    updateMenuLabels() {
      const count = this.selectedItems.size;
      if (this.button) this.button.setAttribute("aria-label", this.app.t("bulk_download"));
      if (this.downloadSelectedButton) {
        this.downloadSelectedButton.textContent = `${this.app.t("bulk_download_selected")}（${count}）`;
        this.downloadSelectedButton.disabled = false;
      }
      if (this.cancelSelectionButton) {
        this.cancelSelectionButton.textContent = this.app.t("bulk_cancel_selection");
        this.cancelSelectionButton.disabled = count <= 0;
      }
      if (this.settingsButton) this.settingsButton.textContent = this.app.t("settings");
    }

    enterSelectionMode() {
      this.selectionMode = true;
      this.ensureSelectionScanner();
      this.scheduleScan();
    }

    findMutationRoot() {
      return (
        this.document.querySelector?.('[data-e2e="user-post-item-list"]') ||
        this.document.querySelector?.('[class*="DivVideoFeed"]') ||
        this.document.querySelector?.('[class*="DivPostListContainer"]') ||
        this.document.querySelector?.('a[href*="/video/"],a[href*="/photo/"]')?.parentElement?.parentElement ||
        this.document.body ||
        null
      );
    }

    ensureSelectionScanner() {
      const mutationRoot = this.findMutationRoot();
      if (this.mutationRoot !== mutationRoot) {
        this.mutationObserver?.disconnect?.();
        this.mutationObserver = null;
        this.mutationRoot = null;
      }
      if (!this.scanInterval && typeof this.window.setInterval === "function") {
        this.scanInterval = this.window.setInterval(() => {
          this.ensureSelectionScanner();
          this.scheduleScan();
        }, 5000);
      }
      if (
        !this.mutationObserver &&
        typeof this.window.MutationObserver === "function" &&
        mutationRoot
      ) {
        const observerRoot = mutationRoot.parentElement || mutationRoot;
        this.mutationRoot = mutationRoot;
        this.mutationObserver = new this.window.MutationObserver((records) => {
          if (
            records.some((record) =>
              Array.from(record.addedNodes || []).some(
                (node) => !node?.closest?.(`.${SCRIPT_PREFIX}-panel`),
              ) || Array.from(record.removedNodes || []).some(
                (node) => node?.matches?.(`.${SCRIPT_PREFIX}-profile-select-box`),
              ),
            )
          ) {
            this.ensureSelectionScanner();
            this.scheduleScan();
          }
        });
        this.mutationObserver.observe(observerRoot, {
          childList: true,
          subtree: true,
        });
      }
    }

    clearSelection() {
      this.selectedItems.clear();
      this.document.querySelectorAll(`.${SCRIPT_PREFIX}-profile-select-box`).forEach((box) => {
        box.classList.remove("selected");
        box.setAttribute("aria-checked", "false");
      });
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
      this.mutationObserver?.disconnect?.();
      this.mutationObserver = null;
      this.mutationRoot = null;
      this.document.querySelectorAll(`.${SCRIPT_PREFIX}-profile-select-box`).forEach((node) => node.remove());
      this.document.querySelectorAll(`[data-tthelper-select-ready]`).forEach((node) => {
        node.removeAttribute("data-tthelper-select-ready");
      });
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
      const startedAt = Date.now();
      const config = this.app.configStore.get();
      const size = `${Math.round(
        clampNumber(
          Number(config.profile_bulk_checkbox_size),
          18,
          40,
          26,
        ),
      )}px`;
      const scanRoot = this.findMutationRoot() || this.document;
      const anchors = Array.from(
        scanRoot.querySelectorAll?.(
          'a[href*="/video/"], a[href*="/photo/"]',
        ) || [],
      );
      let skippedReady = 0;
      let attached = 0;
      let invalid = 0;
      for (const anchor of anchors) {
        const href = anchor?.href || anchor?.getAttribute?.("href") || "";
        const id = getVideoIdFromUrl(href);
        if (!id) {
          invalid += 1;
          continue;
        }
        const card =
          anchor.closest?.('[data-e2e="user-post-item"]') ||
          anchor.closest?.("div") ||
          anchor;
        if (!card) {
          invalid += 1;
          continue;
        }
        const signature = `${id}|${size}`;
        const existingBox = card.querySelector?.(
          `.${SCRIPT_PREFIX}-profile-select-box[data-tthelper-item-id="${id}"]`,
        );
        if (card.dataset.tthelperSelectReady === signature && existingBox) {
          skippedReady += 1;
          continue;
        }
        const item = this.extractItemFromAnchor(anchor, { href, id, card });
        if (!item?.id || !item.card) {
          invalid += 1;
          continue;
        }
        this.attachCheckbox(item, size);
        attached += 1;
      }
      this.lastScanStats = {
        capturedAt: new Date().toISOString(),
        anchorCount: anchors.length,
        attached,
        skippedReady,
        invalid,
        durationMs: Date.now() - startedAt,
      };
      this.updateMenuLabels();
    }

    extractItemFromAnchor(anchor, resolved = {}) {
      const href =
        resolved.href ||
        anchor?.href ||
        anchor?.getAttribute?.("href") ||
        "";
      const id = resolved.id || getVideoIdFromUrl(href);
      if (!id) return null;
      const card =
        resolved.card ||
        anchor?.closest?.('[data-e2e="user-post-item"]') ||
        anchor?.closest?.("div") ||
        anchor;
      if (!card) return null;
      let absoluteUrl = "";
      try {
        absoluteUrl = new URL(href, this.window.location.href).href;
      } catch (_err) {
        return null;
      }
      const img = card.querySelector?.("img") || anchor?.querySelector?.("img") || null;
      const coverUrl =
        img?.currentSrc || img?.src || img?.getAttribute?.("src") || "";
      const desc = String(
        img?.alt || card?.textContent || anchor?.textContent || "",
      )
        .replace(/\s+/g, " ")
        .trim();
      return {
        id,
        href: absoluteUrl,
        pageUrl: absoluteUrl,
        coverUrl,
        desc,
        type: "unknown",
        card,
      };
    }

    updateCheckboxState(box, itemId, size = "") {
      const checked = this.selectedItems.has(itemId);
      const downloaded = this.selectedItems.get(itemId)?.bulkDownloadResult?.status === "success";
      box.dataset.tthelperItemId = itemId;
      if (size) {
        box.style.width = size;
        box.style.height = size;
      }
      box.classList.toggle("selected", checked);
      box.classList.toggle("downloaded", downloaded);
      box.setAttribute("aria-checked", checked ? "true" : "false");
      box.setAttribute("aria-label", downloaded ? this.app.t("download_completed") : this.app.t("bulk_download_selected"));
    }

    refreshCheckboxStates() {
      this.document.querySelectorAll(`.${SCRIPT_PREFIX}-profile-select-box`).forEach((box) => {
        this.updateCheckboxState(box, box.dataset.tthelperItemId);
      });
    }

    attachCheckbox(item, size) {
      const card = item.card;
      if (!card) return;

      const existingBoxes = Array.from(card.querySelectorAll?.(`.${SCRIPT_PREFIX}-profile-select-box`) || []);
      for (const box of existingBoxes) {
        if (box.dataset.tthelperItemId && box.dataset.tthelperItemId !== item.id) box.remove();
      }

      const setBoxState = (box) => {
        this.updateCheckboxState(box, item.id, size);
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
            const cardAnchor = card.querySelector?.('a[href*="/video/"], a[href*="/photo/"]') || null;
            const fresh = this.extractItemFromAnchor(cardAnchor) || item;
            const reactFragments = collectLocalReactItems([
              { element: card, source: "profile-card" },
              { element: cardAnchor, source: "profile-card-link" },
            ]).entries
              .filter((entry) => entry.id === item.id)
              .map((entry) => entry.item);
            const exactItem = mergeExactItemFragments(reactFragments, item.id);
            this.selectedItems.set(item.id, {
              ...item,
              ...fresh,
              exactItem,
              card: null,
            });
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
        const mark = createElement(this.document, "span", `${SCRIPT_PREFIX}-profile-select-mark`);
        box.appendChild(mark);
        card.appendChild(box);
      }

      card.dataset.tthelperSelectReady = `${item.id}|${size}`;
      setBoxState(box);
    }

    getItemTypeLabel(item) {
      const identity = parseTikTokItemIdentityFromUrl(
        item?.pageUrl || item?.href || "",
      );
      if (identity?.type === "photo") return this.app.t("bulk_type_album");
      if (identity?.type === "video") return this.app.t("bulk_type_video");
      return this.app.t("bulk_type_unknown");
    }

    getDebugSnapshot() {
      return {
        profileKey: this.getProfileKey(),
        selectionMode: this.selectionMode,
        selectedCount: this.selectedItems.size,
        selectedIds: Array.from(this.selectedItems.keys()).slice(0, 50),
        checkboxCount: this.document.querySelectorAll(
          `.${SCRIPT_PREFIX}-profile-select-box`,
        ).length,
        readyCardCount: this.document.querySelectorAll(
          "[data-tthelper-select-ready]",
        ).length,
        hasButton: Boolean(this.button?.isConnected),
        menuOpen: Boolean(this.menu?.classList?.contains("open")),
        mutationObserverActive: Boolean(this.mutationObserver),
        mutationRootTag: this.mutationRoot?.tagName || "",
        scanIntervalActive: Boolean(this.scanInterval),
        lastScan: this.lastScanStats,
      };
    }

    openConfirmModal() {
      const items = Array.from(this.selectedItems.values());
      if (!items.length) {
        this.app.notifications.toast(this.app.t("bulk_no_selection"));
        return;
      }
      const modal = this.app.createModal(this.app.t("bulk_confirm_title"), "", { closeOnBackdrop: false });
      modal.classList.add(`${SCRIPT_PREFIX}-bulk-confirm-modal`);
      const main = modal.querySelector("main");
      const selected = new Set(
        items
          .filter((item) => item.bulkDownloadResult?.status !== "success")
          .map((item) => item.id),
      );
      const list = createElement(this.document, "div", `${SCRIPT_PREFIX}-bulk-list`);
      const footer = createElement(this.document, "div", `${SCRIPT_PREFIX}-bulk-footer`);
      const countLabel = createElement(this.document, "div", `${SCRIPT_PREFIX}-readonly`);
      const actions = createElement(this.document, "div", `${SCRIPT_PREFIX}-row`);
      const close = this.app.actionButton(this.app.t("cancel"), () => modal.close?.(), "secondary");
      const start = this.app.actionButton(this.app.t("bulk_start_download"), () => {
        const finalItems = items.filter((item) => selected.has(item.id));
        modal.close?.();
        this.app.downloadProfileBulkItems(finalItems);
      }, "primary");
      const updateCount = () => {
        countLabel.textContent = `${this.app.t("bulk_selected_count")} ${selected.size}`;
        start.disabled = selected.size <= 0;
      };

      for (const item of items) {
        const row = createElement(this.document, "div", `${SCRIPT_PREFIX}-bulk-row`);
        const checkbox = createElement(this.document, "input");
        checkbox.type = "checkbox";
        checkbox.checked = selected.has(item.id);
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
        const meta = createElement(this.document, "div", `${SCRIPT_PREFIX}-bulk-meta`);
        meta.append(type);
        const result = item.bulkDownloadResult;
        if (result?.status === "success") {
          meta.append(createElement(
            this.document,
            "div",
            `${SCRIPT_PREFIX}-bulk-type downloaded`,
            this.app.t("download_completed"),
          ));
        }
        if (result?.status === "failed" || result?.status === "partial") {
          const progress = result.status === "partial"
            ? ` ${result.successfulAssetCount}/${result.totalAssetCount}`
            : "";
          meta.append(createElement(
            this.document,
            "div",
            `${SCRIPT_PREFIX}-bulk-status`,
            `${this.app.t("download_failed")}${progress}`,
          ));
        }
        row.append(checkbox, cover, desc, meta);
        list.appendChild(row);
      }
      actions.append(close, start);
      footer.append(countLabel, actions);
      main.append(list, footer);
      updateCount();
    }
  }

  class NotificationCenter {
    constructor(app) {
      this.app = app;
      this.notificationStackEl = null;
      this.notificationId = 0;
      this.downloadStatusEl = null;
      this.downloadStatusHideTimer = null;
    }

    get document() {
      return this.app.document;
    }

    get window() {
      return this.app.window;
    }

    t(key) {
      return this.app.t(key);
    }

    getNotificationStackElement() {
      if (this.notificationStackEl?.isConnected) return this.notificationStackEl;
      const stack = createElement(this.document, "div", `${SCRIPT_PREFIX}-notification-stack`);
      this.document.body.appendChild(stack);
      this.notificationStackEl = stack;
      return stack;
    }

    removeNotificationCard(card, { immediate = false } = {}) {
      if (!card || card.dataset.notificationRemoving === "1") return;
      card.dataset.notificationRemoving = "1";
      const remove = () => {
        card.remove();
      };
      if (immediate) {
        remove();
        return;
      }
      card.classList.add("fading");
      this.window.setTimeout?.(remove, 75);
    }

    createNotificationCard({ type = "info", title = "", detail = "", meta = "", iconText = "i", download = false, onClose = null } = {}) {
      const stack = this.getNotificationStackElement();
      const card = createElement(
        this.document,
        "div",
        `${SCRIPT_PREFIX}-notification-card${download ? ` ${SCRIPT_PREFIX}-download-status` : ""}`,
      );
      card.classList.add(type);
      card.dataset.notificationId = String(++this.notificationId);

      const icon = createElement(
        this.document,
        "div",
        `${SCRIPT_PREFIX}-notification-icon`,
      );
      const main = createElement(
        this.document,
        "div",
        `${SCRIPT_PREFIX}-notification-main`,
      );
      const head = createElement(
        this.document,
        "div",
        `${SCRIPT_PREFIX}-notification-head`,
      );
      const titleEl = createElement(
        this.document,
        "div",
        `${SCRIPT_PREFIX}-notification-title`,
        title,
      );
      const metaEl = createElement(
        this.document,
        "div",
        `${SCRIPT_PREFIX}-notification-meta`,
        meta,
      );
      const detailEl = createElement(
        this.document,
        "div",
        `${SCRIPT_PREFIX}-notification-detail`,
        detail,
      );
      const close = createTuxIconButton(
        this.document,
        this.t("close"),
        () => {
          if (typeof onClose === "function") onClose(card);
          else this.removeNotificationCard(card);
        },
        "close",
        `${SCRIPT_PREFIX}-notification-close`,
      );

      icon.textContent = iconText || "i";

      head.append(titleEl, metaEl);
      main.append(head, detailEl);
      card.append(icon, main, close);
      stack.prepend(card);

      return { card, icon, titleEl, metaEl, detailEl };
    }

    getDownloadStatusElement() {
      if (this.downloadStatusEl?.isConnected) {
        const stack = this.getNotificationStackElement();
        if (this.downloadStatusEl.parentElement !== stack) {
          stack.prepend(this.downloadStatusEl);
        }
        return this.downloadStatusEl;
      }

      const refs = this.createNotificationCard({
        type: "busy",
        title: "",
        detail: "",
        iconText: "↓",
        download: true,
        onClose: (card) => {
          this.app.requestDownloadCancel?.();
          this.stopDownloadTitleDots();
          this.removeNotificationCard(card);
          if (this.downloadStatusEl === card) this.downloadStatusEl = null;
        },
      });
      this.downloadStatusEl = refs.card;
      this.downloadStatusIconEl = refs.icon;
      this.downloadStatusTitleEl = refs.titleEl;
      this.downloadStatusMetaEl = refs.metaEl;
      this.downloadStatusDetailEl = refs.detailEl;

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

    setDownloadStatus({ type = "busy", title = "", detail = "", meta = "", autoHideMs = 0 } = {}) {
      if (this.downloadStatusHideTimer) {
        this.window.clearTimeout?.(this.downloadStatusHideTimer);
        this.downloadStatusHideTimer = null;
      }

      const card = this.getDownloadStatusElement();
      card.className = `${SCRIPT_PREFIX}-notification-card ${SCRIPT_PREFIX}-download-status ${type}`;

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
      });
    }

    showVideoPreparing(filename = "") {
      this.setDownloadStatus({
        type: "busy",
        title: this.t("preparing_video_download"),
        detail: filename,
      });
    }

    showVideoDownloading(filename = "") {
      this.setDownloadStatus({
        type: "busy",
        title: this.t("downloading_video"),
        detail: filename,
      });
    }

    showAlbumProgress(index, total, filename = "") {
      this.setDownloadStatus({
        type: "album",
        title: `${index}/${total} ${this.t("downloading_album")}`,
        detail: filename,
        meta: "",
      });
    }

    showImageDownloading(filename = "") {
      this.setDownloadStatus({
        type: "image",
        title: this.t("downloading_image"),
        detail: filename,
      });
    }

    showMusicDownloading(filename = "") {
      this.setDownloadStatus({
        type: "busy",
        title: this.t("downloading_music"),
        detail: filename,
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
        download: false,
      });
      const autoHideMs = Number(options.autoHideMs ?? 3200);
      if (!options.persist && autoHideMs > 0) {
        this.window.setTimeout?.(() => this.removeNotificationCard(refs.card), autoHideMs);
      }
      return refs.card;
    }
  }

  class TikTokDlApp {
    constructor(win) {
      this.window = win;
      this.document = win.document;
      this.configStore = new ConfigStore(win.localStorage);
      this.extractor = new TikTokMediaExtractor(this.document, win);
      this.currentItemResolver = new CurrentItemResolver(
        this.document,
        win,
        this.extractor,
      );
      this.itemDataProvider = new ItemDataProvider(this.document, win);
      this.actionBarLocator = new ActionBarLocator(this);
      this.profileBulkSelectionState = { profileKey: "", selectedItems: new Map() };
      this.profilePageBulkAdapter = new ProfilePageBulkAdapter(this);
      this.downloader = new Downloader(win, gmXmlHttpRequest, gmDownload);
      this.panel = null;
      this.menu = null;
      this.launcher = null;
      this.currentMedia = null;
      this.currentActionBarHost = null;
      this.currentPlacementMode = "inactive";
      this.lastHref = "";
      this.positionObserver = null;
      this.positionFrame = null;
      this.positionPoll = null;
      this.routeChangeCleanup = null;
      this.routeChangeFrame = null;
      this.lastPanelPositionSignature = "";
      this.lastPanelPositionCheckAt = 0;
      this.pendingPanelPositionCheck = null;
      this.outsideMenuBound = false;
      this.openImageOverlay = null;
      this.isDownloading = false;
      this.downloadCancelRequested = false;
      this.lastProfileBulkRun = null;
      this.lastProfileBulkResolve = null;
      this.lastExtractionTrace = null;
      this.isCapturingFrame = false;
      this.notifications = new NotificationCenter(this);
      this.menuLifecycle = new MenuLifecycle(win, {
        onStateChange: () => this.applyPanelState(),
        onClosed: () => {
          this.clearPanelMenuPosition();
          this.mountPanel();
        },
      });
      this.imageDownloadButton = null;
      this.imageOverlayWatcherBound = false;
      this.lastImageOpenGestureAt = 0;
      this.tampermonkeyMenuRegistered = false;
    }

    start() {
      this.injectStyles();
      this.renderPanel();
      this.registerTampermonkeyMenu();
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
      this.menuLifecycle?.clearPending?.();
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
      menu.addEventListener("click", (event) => {
        if (this.panel?.classList.contains("closing")) {
          event.preventDefault();
          event.stopImmediatePropagation?.();
          return;
        }
        event.stopPropagation();
      });
      menu.addEventListener("mouseleave", () => this.toggleMenu(false));

      const makeMenuButton = (label, className, onClick) => {
        const button = createElement(this.document, "button", className, label);
        button.addEventListener("click", (event) => {
          if (this.panel?.classList.contains("closing")) {
            event.preventDefault();
            return;
          }
          onClick(event);
        });
        return button;
      };
      const secondaryButtonClass = `${SCRIPT_PREFIX}-button secondary`;

      const downloadButton = makeMenuButton(this.t("download"), `${SCRIPT_PREFIX}-button`, () => {
        this.runMenuAction(() => this.downloadVideo());
      });

      const frameButton = makeMenuButton(this.t("frame_capture"), secondaryButtonClass, () => {
        this.runMenuAction(() => this.openFrameCapture());
      });

      const detailsButton = makeMenuButton(this.t("details"), secondaryButtonClass, () => {
        this.runMenuAction(() => this.openDetails());
      });

      const settingsButton = makeMenuButton(this.t("settings"), secondaryButtonClass, () => {
        this.runMenuAction(() => this.openSettings());
      });

      const debugInfoButton = makeMenuButton(this.t("debug_info"), secondaryButtonClass, () => {
        this.runMenuAction(() => this.copyDebugInfo());
      });

      const testNoticeButton = makeMenuButton("测试通知", secondaryButtonClass, () => {
        this.runMenuAction(() => this.notifications.toast("测试普通通知", {
          detail: "普通通知会自动关闭，点击 × 可提前关闭。",
          iconText: "i",
        }));
      });

      const testBusyButton = makeMenuButton("测试下载中", secondaryButtonClass, () => {
        this.runMenuAction(() => this.notifications.showVideoPreparing("demo-video.mp4"));
      });

      const testAlbumButton = makeMenuButton("测试图集进度", secondaryButtonClass, () => {
        this.runMenuAction(() => this.notifications.showAlbumProgress(2, 5, "demo-image-02.jpg"));
      });

      const testErrorButton = makeMenuButton("测试失败", secondaryButtonClass, () => {
        this.runMenuAction(() => this.notifications.showDownloadError("这是一个测试错误，点击 × 关闭。"));
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
      this.menuLifecycle.attach(panel, menu);
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

    applyPanelState() {
      if (!this.panel) return;
      const config = this.configStore.get();
      const isOpen = this.panel.classList.contains("open");
      const isPending = this.panel.classList.contains("pending");
      const isClosing = this.panel.classList.contains("closing");
      const isEmbedded = this.panel.classList.contains("embedded");
      const isFloating = this.panel.classList.contains("floating");
      const nextClassName = [
        `${SCRIPT_PREFIX}-panel`,
        isEmbedded ? "embedded" : "",
        isFloating ? "floating" : "",
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
      const hideMediaActionsForLive = Boolean(
        isOpen && this.isCurrentLiveContext(this.getCurrentActionAnchor())
      );
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
      if (!this.panel || !this.menu) return;
      this.menuLifecycle.attach(this.panel, this.menu);
      const shouldOpen = force === null ? !this.menuLifecycle.isOpen : Boolean(force);
      if (shouldOpen) {
        this.currentMedia = null;
        this.menuLifecycle.open(() => {
          this.updatePanelMenuPosition();
        });
        return;
      }
      this.menuLifecycle.close();
    }

    closeMenu(immediate = false) {
      if (!this.panel || !this.menu) return;
      this.menuLifecycle.attach(this.panel, this.menu);
      if (immediate) this.menuLifecycle.closeImmediate();
      else this.menuLifecycle.close();
    }

    runMenuAction(action) {
      this.closeMenu(true);
      const run = () => {
        try {
          const result = action?.();
          result?.catch?.((err) => {
            this.notifications?.toast?.(err?.message || String(err), { type: "error" });
          });
        } catch (err) {
          this.notifications?.toast?.(err?.message || String(err), { type: "error" });
        }
      };
      if (typeof this.window.requestAnimationFrame === "function") {
        this.window.requestAnimationFrame(run);
      } else {
        this.window.setTimeout?.(run, 0);
      }
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
      if (this.panel.classList.contains("closing")) return;
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
        if (event.key !== "Escape") return;
        if (this.panel?.classList.contains("closing")) return;
        this.toggleMenu(false);
      });
      this.document.addEventListener("pointerdown", (event) => {
        if (!this.panel?.classList.contains("open")) return;
        if (this.panel.classList.contains("closing")) return;
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

    getEmbeddedNativeButtonSample(host) {
      const nativeChildren = this.actionBarLocator.getNativeActionChildren(host);
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
          best = { child, action: child, visual: control, control, childRect, actionRect: childRect, controlRect, visualRect: controlRect };
        }
      }
      return best;
    }

    syncEmbeddedButtonMetrics(host) {
      if (!this.panel || !host) return;
      const sample = this.getEmbeddedNativeButtonSample(host);
      const nativeControl = sample?.control || null;
      const controlRect = sample?.controlRect || nativeControl?.getBoundingClientRect?.();
      const rawControlSize = controlRect ? Math.max(controlRect.width, controlRect.height) : 48;
      const controlSize = Math.round(clampNumber(rawControlSize, 28, 64, 48));
      const iconSize = Math.round(clampNumber(controlSize * 0.62, 18, 28, Math.round(controlSize * 0.55)));

      this.panel.style.width = `${controlSize}px`;
      this.panel.style.height = `${controlSize}px`;
      this.panel.style.flexBasis = `${controlSize}px`;
      const icon = this.launcher?.querySelector?.("svg");
      if (icon) {
        icon.style.width = `${iconSize}px`;
        icon.style.height = `${iconSize}px`;
      }
      this.launcher.className = `${SCRIPT_PREFIX}-launcher`;
    }

    clearEmbeddedButtonMetrics() {
      if (!this.panel) return;
      this.panel.style.removeProperty("width");
      this.panel.style.removeProperty("height");
      this.panel.style.removeProperty("flex-basis");
      const icon = this.launcher?.querySelector?.("svg");
      icon?.style?.removeProperty?.("width");
      icon?.style?.removeProperty?.("height");
      if (this.launcher) this.launcher.className = `${SCRIPT_PREFIX}-launcher`;
    }

    syncFloatingButtonMetrics(anchorElement) {
      if (!this.panel || !anchorElement) return;
      const rect = anchorElement.getBoundingClientRect?.();
      const rawSize = rect ? Math.max(rect.width, rect.height) : 40;
      const controlSize = Math.round(clampNumber(rawSize, 32, 56, 40));
      const iconSize = Math.round(clampNumber(controlSize * 0.56, 18, 28, 22));
      this.panel.style.width = `${controlSize}px`;
      this.panel.style.height = `${controlSize}px`;
      const icon = this.launcher?.querySelector?.("svg");
      if (icon) {
        icon.style.width = `${iconSize}px`;
        icon.style.height = `${iconSize}px`;
      }
      if (this.launcher) this.launcher.className = `${SCRIPT_PREFIX}-launcher`;
    }

    getCurrentPageType() {
      return getTikTokPageType(this.window.location, this.document);
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
      const reference = this.actionBarLocator.getActionBarInsertionReference(host);
      if (this.panel.parentElement !== host || this.panel.nextSibling !== reference) {
        host.insertBefore(this.panel, reference || host.firstChild);
      }
      this.currentPlacementMode = "recommend";
      this.currentActionBarHost = host;
      this.panel.classList.remove("pending", "floating");
      this.panel.classList.add("embedded");
      this.clearPanelFixedPosition();
      this.syncEmbeddedButtonMetrics(host);
      this.updatePanelMenuPosition();
      return true;
    }

    mountPanelLeftOfButton(anchor, placementMode) {
      if (!this.panel || !anchor) return false;
      if (this.panel.parentElement !== this.document.body) {
        this.document.body.appendChild(this.panel);
      }
      if (this.menu && this.menu.parentElement !== this.document.body) {
        this.document.body.appendChild(this.menu);
      }
      const rect = anchor.getBoundingClientRect?.();
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

      this.currentPlacementMode = placementMode;
      this.currentActionBarHost = null;
      this.panel.classList.remove("pending", "embedded");
      this.panel.classList.add("floating");
      this.panel.style.left = `${Math.round(left)}px`;
      this.panel.style.top = `${Math.round(top)}px`;
      this.panel.style.right = "auto";
      this.panel.style.bottom = "auto";
      this.syncFloatingButtonMetrics(anchor);
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
      this.clearEmbeddedButtonMetrics();
      this.panel.classList.add("pending");
      this.panel.classList.remove("embedded", "floating", "open", "closing");
      this.clearPanelMenuPosition();
    }

    resolvePanelPlacement() {
      const cinemaRoot = getCinemaModeRoot(this.document);
      if (cinemaRoot) {
        const anchor = getVisibleCinemaMoreButton(this.document, cinemaRoot);
        const rect = this.actionBarLocator.getElementRect(anchor);
        const isLive = this.isCurrentLiveContext(anchor);
        return {
          surface: "cinema",
          mode: !this.openImageOverlay && !isLive && anchor ? "cinema" : "inactive",
          anchor: isLive ? null : anchor,
          signature: isLive
            ? "cinema:live-not-supported"
            : rect
              ? [
                "cinema",
                Math.round(rect.left),
                Math.round(rect.top),
                Math.round(rect.width),
                Math.round(rect.height),
              ].join(":")
              : "cinema:no-anchor",
        };
      }

      const pageType = this.getCurrentPageType();
      if (pageType === "profile-dialog") {
        const dialog = getVisibleProfileBrowseDialog(this.document);
        const anchor = dialog?.querySelector?.(PROFILE_BROWSE_ELLIPSIS_SELECTOR) || null;
        const rect = this.actionBarLocator.getElementRect(anchor);
        return {
          surface: pageType,
          mode: anchor ? pageType : "inactive",
          anchor,
          signature: rect
            ? [
              Math.round(rect.left),
              Math.round(rect.top),
              Math.round(rect.width),
              Math.round(rect.height),
            ].join(",")
            : "no-profile-dialog",
        };
      }
      if (pageType === "profile") {
        const userMore = this.profilePageBulkAdapter?.findUserMoreButton?.()
          || this.document.querySelector?.('[data-e2e="user-more"]');
        const rect = this.actionBarLocator.getElementRect(userMore);
        const parent = userMore?.parentElement?.parentElement || userMore?.parentElement || null;
        return {
          surface: pageType,
          mode: pageType,
          anchor: userMore,
          signature: rect
            ? `profile-more:${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)},${parent?.children?.length || 0}`
            : "profile-no-user-more",
        };
      }
      if (pageType !== "recommend" || this.openImageOverlay) {
        return { surface: pageType, mode: "inactive", signature: "" };
      }

      const host = this.actionBarLocator.findActionBarHost();
      const rect = this.actionBarLocator.getElementRect(host);
      const childCount = this.actionBarLocator.getNativeActionChildren(host).length;
      return {
        surface: pageType,
        mode: host ? "recommend" : "inactive",
        host,
        signature: rect
          ? `${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)},${childCount}`
          : "no-action-bar",
      };
    }

    mountPanel() {
      if (!this.panel) return;

      const placement = this.resolvePanelPlacement();
      if (placement.surface === "cinema") {
        this.profilePageBulkAdapter?.suspend?.();
        if (
          placement.mode === "cinema" &&
          this.mountPanelLeftOfButton(placement.anchor, "cinema")
        ) return;
        this.hidePanelForInactivePlacement();
        return;
      }

      if (placement.surface === "profile-dialog") {
        this.profilePageBulkAdapter?.suspend?.();
        if (
          placement.mode === "profile-dialog" &&
          this.mountPanelLeftOfButton(placement.anchor, "profile-dialog")
        ) return;
        this.hidePanelForInactivePlacement();
        return;
      }

      if (placement.surface === "profile") {
        this.hidePanelForInactivePlacement();
        this.profilePageBulkAdapter?.mount?.(placement.anchor);
        return;
      }

      this.profilePageBulkAdapter?.unmount?.();

      if (placement.mode !== "recommend") {
        this.hidePanelForInactivePlacement();
        return;
      }

      if (!this.mountPanelInActionBar(placement.host)) this.hidePanelForInactivePlacement();
    }

    getCurrentActionAnchor() {
      const placement = this.resolvePanelPlacement();
      if (!["recommend", "cinema", "profile-dialog"].includes(placement.mode)) {
        return null;
      }
      return placement.anchor || placement.host || null;
    }

    getCurrentLiveContextText(anchorElement = null) {
      const visibleMedia = this.extractor?.getVisibleMediaElement?.() || null;
      const visibleVideo = this.extractor?.getVisibleVideoElement?.() || null;
      const context =
        this.extractor?.getMediaContextElement?.(anchorElement) ||
        this.extractor?.getMediaContextElement?.(visibleMedia) ||
        this.extractor?.getMediaContextElement?.(visibleVideo) ||
        null;
      const actionText = unique([
        anchorElement?.textContent || "",
        this.currentActionBarHost?.textContent || "",
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

    captureMediaContext(anchorElement = null) {
      const anchor =
        anchorElement?.isConnected === false
          ? this.getCurrentActionAnchor()
          : anchorElement || this.getCurrentActionAnchor();
      const anchorContext = this.extractor.getMediaContextElement(anchor);
      const contextMediaElement = anchorContext
        ? this.extractor.getContextMediaElement(anchorContext)
        : this.extractor.getVisibleMediaElement();
      const contextVideo = anchorContext
        ? this.extractor.getContextVideoElement(anchorContext)
        : this.extractor.getVisibleVideoElement();
      const mediaElement = contextMediaElement || contextVideo;
      const contextUrls = anchorContext
        ? this.extractor.getMediaUrlsFromScopes([anchorContext])
        : this.extractor.getVisibleMediaContextUrls(mediaElement);
      const tag = String(mediaElement?.tagName || "").toLowerCase();
      const resourceUrls =
        tag === "video"
          ? getVideoElementResourceUrls(mediaElement)
          : tag === "img"
            ? unique([
                this.extractor.getImageElementUrl(mediaElement),
                ...this.extractor
                  .getVisiblePhotoModeImages(mediaElement)
                  .map((image) => this.extractor.getImageElementUrl(image)),
              ])
            : [];
      const pageUrl = this.window.location?.href || "";
      const itemIds = unique(
        [...contextUrls, pageUrl]
          .map((url) => getVideoIdFromUrl(url))
          .filter(Boolean),
      );
      const contextText = compactMatchText(
        unique([
          anchorContext?.textContent || "",
          mediaElement?.parentElement?.textContent || "",
          contextVideo?.parentElement?.textContent || "",
        ]).join(" "),
      ).slice(0, 180);
      return {
        capturedAt: new Date().toISOString(),
        pageType: this.getCurrentPageType(),
        pageUrl,
        primaryItemId: itemIds[0] || "",
        itemIds,
        contextUrls: contextUrls.slice(0, 12),
        resourceUrls: resourceUrls.slice(0, 12),
        contextText,
        mediaTag: tag,
        anchorFound: Boolean(anchor),
      };
    }

    wait(ms) {
      return new Promise((resolve) => {
        const timer = this.window?.setTimeout || root?.setTimeout || setTimeout;
        timer.call(this.window || root, resolve, ms);
      });
    }

    waitForIdentityVersionChange(initialVersion, anchorElement, timeoutMs = IDENTITY_VERSION_WAIT_MS) {
      const currentVersion = () =>
        this.currentItemResolver.getDomVersion({ anchorElement });
      if (currentVersion() !== initialVersion) return Promise.resolve(true);
      const MutationObserverCtor = this.window?.MutationObserver;
      if (typeof MutationObserverCtor !== "function") return Promise.resolve(false);

      const context =
        this.extractor.getMediaContextElement(anchorElement) ||
        anchorElement?.parentElement ||
        this.document.body;
      const rootElement = context?.parentElement || context || this.document.body;
      if (!rootElement) return Promise.resolve(false);

      return new Promise((resolve) => {
        let settled = false;
        let timer = null;
        const finish = (changed) => {
          if (settled) return;
          settled = true;
          observer.disconnect();
          if (timer) this.window.clearTimeout?.(timer);
          resolve(Boolean(changed));
        };
        const observer = new MutationObserverCtor(() => {
          if (currentVersion() !== initialVersion) finish(true);
        });
        observer.observe(rootElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["href", "id", "src", "class"],
        });
        timer = this.window.setTimeout?.(() => finish(false), timeoutMs) || null;
      });
    }

    async waitForCurrentMedia(options = {}) {
      const initialAnchor =
        options.anchorElement !== undefined
          ? options.anchorElement
          : this.getCurrentActionAnchor();
      const trace = {
        startedAt: new Date().toISOString(),
        identityAttempts: [],
        finalResult: "failure",
      };

      const resolveIdentity = (anchor) => {
        const result = this.currentItemResolver.resolve({
          anchorElement: anchor,
          pageType: this.getCurrentPageType(),
          isLive: this.isCurrentLiveContext(anchor),
        });
        trace.identityAttempts.push({
          ok: Boolean(result?.ok),
          code: result?.code || "",
          identity: result?.identity || null,
          fragmentCount: ensureArray(result?.fragments).length,
          version: result?.version || "",
          resolver: this.currentItemResolver.getDebugSnapshot(),
        });
        return result;
      };

      let identityResult = resolveIdentity(initialAnchor);
      if (
        !identityResult?.ok &&
        [
          "current-item-context-not-ready",
          "current-item-id-not-found",
          "current-item-author-not-found",
        ].includes(identityResult?.code)
      ) {
        const changed = await this.waitForIdentityVersionChange(
          identityResult.version || "",
          initialAnchor,
        );
        trace.versionChanged = changed;
        if (changed) {
          const retryAnchor = initialAnchor?.isConnected
            ? initialAnchor
            : this.getCurrentActionAnchor();
          identityResult = resolveIdentity(retryAnchor);
        }
      }

      if (!identityResult?.ok) {
        this.currentMedia = null;
        trace.completedAt = new Date().toISOString();
        trace.finalResult = identityResult?.code || "current-item-id-not-found";
        this.lastExtractionTrace = trace;
        return null;
      }

      const dataResult = this.itemDataProvider.resolve(
        identityResult,
        this.configStore.get(),
      );
      trace.identity = { ...identityResult.identity };
      trace.data = {
        ok: Boolean(dataResult?.ok),
        source: dataResult?.source || "",
        code: dataResult?.code || "",
        details: dataResult?.details || null,
      };
      if (!dataResult?.ok) {
        this.currentMedia = null;
        trace.completedAt = new Date().toISOString();
        trace.finalResult = dataResult?.code || "detail-data-missing";
        this.lastExtractionTrace = trace;
        return null;
      }

      const media = normalizeMediaItem(
        dataResult.item,
        identityResult.identity.permalink || this.window.location?.href || "",
        this.configStore.get(),
      );
      if (
        !hasUsableMedia(media) ||
        String(media.id || "") !== String(identityResult.identity.id)
      ) {
        this.currentMedia = null;
        trace.completedAt = new Date().toISOString();
        trace.finalResult = hasUsableMedia(media)
          ? "detail-id-mismatch"
          : "media-empty";
        trace.returnedMediaId = media?.id || "";
        this.lastExtractionTrace = trace;
        return null;
      }

      media.extraction = {
        source: dataResult.source,
        exactId: true,
        identityEvidence: identityResult.identity.evidence,
        selectedSourceType: media.video?.primarySource?.sourceType || "",
        selectedSourceIndex: media.video?.primarySource?.sourceIndex ?? null,
        selectedSourceWatermark: media.video?.primarySource?.watermarkStatus || "unknown",
        selectedSourceGearName: media.video?.primarySource?.gearName || "",
        selectedSourceQualityType: media.video?.primarySource?.qualityType || "",
      };
      this.currentMedia = media;
      trace.completedAt = new Date().toISOString();
      trace.finalResult = "success";
      trace.mediaId = media.id;
      trace.mediaSource = dataResult.source;
      this.lastExtractionTrace = trace;
      return media;
    }

    getLastMediaErrorMessage() {
      const code = String(this.lastExtractionTrace?.finalResult || "");
      const messageKey = {
        "current-item-id-not-found": "current_item_not_found",
        "current-item-context-not-ready": "current_item_not_found",
        "current-item-author-not-found": "current_item_author_not_found",
        "current-item-author-ambiguous": "current_item_author_ambiguous",
        "current-item-ambiguous": "current_item_ambiguous",
        "canonical-permalink-missing": "current_item_not_found",
        "detail-data-missing": "detail_data_missing",
        "detail-id-mismatch": "detail_id_mismatch",
        "media-empty": "detail_data_missing",
      }[code];
      return messageKey ? this.t(messageKey) : this.t("no_media");
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
      const media = this.currentMedia || {};
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
        selectedVideoSource: media.video?.primarySource
          ? {
              sourceType: media.video.primarySource.sourceType || "",
              sourceIndex: media.video.primarySource.sourceIndex ?? null,
              gearName: media.video.primarySource.gearName || "",
              qualityType: media.video.primarySource.qualityType || "",
              url: media.video.primarySource.url || "",
            }
          : null,
        extraction: media.extraction ? { ...media.extraction } : null,
      };
    }

    summarizeVideoPlaybackForDebug(video = null) {
      if (!video) return null;
      const mediaError = video.error || null;
      const errorNames = {
        1: "MEDIA_ERR_ABORTED",
        2: "MEDIA_ERR_NETWORK",
        3: "MEDIA_ERR_DECODE",
        4: "MEDIA_ERR_SRC_NOT_SUPPORTED",
      };
      const canPlayType = typeof video.canPlayType === "function"
        ? (value) => video.canPlayType(value) || ""
        : () => "";
      return {
        currentSrc: video.currentSrc || "",
        src: video.src || video.getAttribute?.("src") || "",
        poster: video.poster || video.getAttribute?.("poster") || "",
        readyState: Number(video.readyState || 0),
        networkState: Number(video.networkState || 0),
        paused: Boolean(video.paused),
        ended: Boolean(video.ended),
        currentTime: Number.isFinite(Number(video.currentTime)) ? Number(video.currentTime) : null,
        duration: Number.isFinite(Number(video.duration)) ? Number(video.duration) : null,
        videoWidth: Number(video.videoWidth || 0),
        videoHeight: Number(video.videoHeight || 0),
        error: mediaError
          ? {
              code: Number(mediaError.code || 0),
              name: errorNames[Number(mediaError.code || 0)] || "MEDIA_ERR_UNKNOWN",
              message: mediaError.message || "",
            }
          : null,
        codecSupport: {
          hvc1: canPlayType('video/mp4; codecs="hvc1"'),
          hev1: canPlayType('video/mp4; codecs="hev1"'),
          avc1: canPlayType('video/mp4; codecs="avc1.42E01E"'),
        },
      };
    }

    collectDebugInfo() {
      const visibleVideo = this.extractor?.getVisibleVideoElement?.() || null;
      return {
        version: "debug-full-v19",
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
          floating: Boolean(this.panel?.classList.contains("floating")),
          rect: this.summarizeElementForDebug(this.panel)?.rect || null,
        },
        selectedMedia: this.summarizeMediaForDebug(this.currentMedia),
        actionAnchor: this.summarizeElementForDebug(this.getCurrentActionAnchor()),
        mediaContext: this.captureMediaContext(this.getCurrentActionAnchor()),
        videoPlayback: this.summarizeVideoPlaybackForDebug(visibleVideo),
        extraction: this.lastExtractionTrace,
        identityResolver: this.currentItemResolver?.getDebugSnapshot?.() || null,
        itemDataProvider: this.itemDataProvider?.getDebugSnapshot?.() || null,
        profileBulk: this.profilePageBulkAdapter?.getDebugSnapshot?.() || null,
        profileBulkRun: this.lastProfileBulkRun,
        profileBulkResolve: this.lastProfileBulkResolve,
      };
    }

    copyDebugInfo() {
      let json = "";
      try {
        json = this.stringifyDebugInfo(this.collectDebugInfo());
        const writeText = this.window.navigator.clipboard?.writeText;
        if (typeof writeText !== "function") {
          this.notifications.toast(json);
          return;
        }
        const result = writeText.call(this.window.navigator.clipboard, json);
        if (result?.catch) {
          result
            .then(() => this.notifications.toast(this.t("debug_info_copied"), { detail: this.t("debug_info_copied_detail") }))
            .catch(() => this.notifications.toast(json));
          return;
        }
        this.notifications.toast(this.t("debug_info_copied"), { detail: this.t("debug_info_copied_detail") });
      } catch (err) {
        const message = err?.message ? String(err.message) : String(err || "");
        this.notifications.toast(`${this.t("debug_info_copied")}: ${message}`);
      }
    }

    async downloadVideo() {
      if (this.isDownloading) {
        this.notifications.nudgeDownloadStatus();
        return;
      }
      this.isDownloading = true;
      this.downloadCancelRequested = false;
      this.notifications.showDownloadPreparing();

      try {
        const media = await this.waitForCurrentMedia({
          anchorElement: this.getCurrentActionAnchor(),
        });
        const images = ensureArray(media?.images).filter((image) => image?.url);
        if (!media?.video?.primaryUrl && !images.length) {
          this.notifications.showDownloadError(this.getLastMediaErrorMessage());
          return;
        }
        const result = await this.downloadResolvedMedia(media);
        const successCount = ensureArray(result?.successfulAssets).length;
        const failureCount = ensureArray(result?.failedAssets).length;
        if (result?.status === "cancelled") {
          this.notifications.setDownloadStatus({
            type: "error",
            title: this.t("download_cancelled"),
            detail: images.length
              ? `${this.t("download_album")}: ${successCount}/${images.length}`
              : "",
          });
        } else if (result?.status === "success") {
          this.notifications.showDownloadSuccess(result.filename || "");
        } else if (result?.status === "partial") {
          this.notifications.showDownloadError(
            `${this.t("download_album")}: ${successCount}/${images.length}, ${this.t("download_failed")}: ${failureCount}`,
          );
        } else {
          this.notifications.showDownloadError(result?.message || this.t("download_failed"));
        }
      } finally {
        this.isDownloading = false;
        this.downloadCancelRequested = false;
      }
    }

    async downloadAsset(url, filename, kind = "image") {
      if (this.isDownloading) {
        this.notifications.nudgeDownloadStatus();
        return;
      }
      this.isDownloading = true;
      this.downloadCancelRequested = false;

      try {
        const urls = unique(ensureArray(url));
        if (!urls.length) {
          this.notifications.showDownloadError(this.t("asset_empty"));
          return;
        }
        if (kind === "video") this.notifications.showVideoDownloading(filename);
        else if (kind === "music") this.notifications.showMusicDownloading(filename);
        else this.notifications.showImageDownloading(filename);
        try {
          await this.downloader.downloadUrl(urls, filename);
          this.notifications.showDownloadSuccess(filename);
        } catch (err) {
          this.notifications.showDownloadError(err?.message || String(err));
        }
      } finally {
        this.isDownloading = false;
        this.downloadCancelRequested = false;
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
      const imageUrl = this.openImageOverlay?.imageUrl || "";
      const filename = imageUrl
        ? this.getOverlayImageFilename(this.currentMedia || {}, imageUrl)
        : "";
      return this.downloadAsset(imageUrl, filename, "image");
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
      const media = this.currentMedia || {};
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
          onClose: () => this.window.URL.revokeObjectURL?.(frame.url),
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
              this.notifications.toast(this.t("frame_copied"));
            } catch (err) {
              this.notifications.toast(`${this.t("frame_copy_failed")}: ${err?.message || err}`);
            }
          }, "primary"),
          this.actionButton(this.t("save_frame"), () => {
            this.downloader.downloadBlob(frame.blob, frame.filename);
          }, "secondary"),
        );
        main.append(preview, meta, actions);
      } catch (err) {
        this.notifications.toast(`${this.t("frame_failed")}: ${err?.message || err}`);
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

    buildDetailModalHelpers() {
      const copyText = (value) => {
        const text = String(value || "");
        if (!text) return;
        try {
          const result = this.window.navigator.clipboard?.writeText(text);
          if (result?.catch) result.catch(() => {});
          this.notifications.toast(this.t("copied"));
        } catch (_err) {
          this.notifications.toast(text);
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

      const makeDownloadPill = (urls, filename, label = this.t("download"), kind = "image") => {
        const button = makePillButton(label, () => this.downloadAsset(urls, filename, kind));
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

      return {
        copyText,
        makeFieldset,
        makePillButton,
        makePillLink,
        makeActions,
        makeDownloadPill,
        makeCopyPill,
        appendValue,
        makeRows,
        makeTable,
        formatBool,
      };
    }

    renderDetailsMediaPanel(details, helpers) {
      const { makeFieldset, makeRows, makeActions, makePillLink, makeDownloadPill, makeCopyPill, makeTable } = helpers;
      const mediaPanel = createElement(this.document, "div", `${SCRIPT_PREFIX}-detail-panel`);
      const coverSection = makeFieldset(this.t("video_cover"));
      if (details.cover.url) {
        const coverRow = createElement(this.document, "div", `${SCRIPT_PREFIX}-detail-cover-row`);
        coverRow.classList.add(`${SCRIPT_PREFIX}-cover-${details.cover.orientation}`);
        const image = createElement(this.document, "img", `${SCRIPT_PREFIX}-detail-cover`);
        image.src = details.cover.url;
        image.alt = this.t("cover");
        const info = createElement(this.document, "div");
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
            makeDownloadPill(details.cover.url, details.cover.filename, this.t("download_cover"), "image"),
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
            makeDownloadPill(source.urls, source.filename, this.t("download"), "video"),
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
              makeDownloadPill(image.urls, image.filename, this.t("download"), "image"),
            );
            return [String(image.index), image.resolution, actions];
          }),
        ),
      );

      const musicSection = this.renderMusicSection(details, helpers);
      const mediaGrid = createElement(this.document, "div", `${SCRIPT_PREFIX}-detail-media-grid`);
      mediaGrid.append(coverSection, musicSection);
      mediaPanel.appendChild(mediaGrid);
      if (details.showVideoSources) mediaPanel.appendChild(videoSection);
      if (details.isImagePost) mediaPanel.appendChild(imageSection);
      return mediaPanel;
    }

    renderDetailsAuthorPanel(details, helpers) {
      const { makeFieldset, makeRows, makeActions, makePillLink } = helpers;
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
      return authorPanel;
    }

    renderDetailsPostPanel(details, helpers) {
      const { makeFieldset, makeRows, formatBool } = helpers;
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
      return postPanel;
    }

    renderDetailsJsonPanel(details, media, helpers) {
      const { makeFieldset, makePillButton, copyText } = helpers;
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
          this.notifications.toast(this.t("json_logged"));
        }),
        makePillButton(this.t("copy_json"), () => copyText(details.rawJson)),
      );
      jsonSection.append(jsonActions, pre);
      jsonPanel.appendChild(jsonSection);
      return jsonPanel;
    }

    async openDetails() {
      const media = await this.waitForCurrentMedia({
        anchorElement: this.getCurrentActionAnchor(),
      });
      if (!hasUsableMedia(media)) {
        this.notifications.toast(this.getLastMediaErrorMessage());
        return;
      }
      const language = resolveLanguage(this.configStore.get(), this.window.navigator);
      const details = buildDetailsModel(media, this.configStore.get(), language);
      const modal = this.createModal(this.t("details_title"), "", { showHeader: false });
      modal.classList.add(`${SCRIPT_PREFIX}-details-modal`);
      const close = createTuxIconButton(
        this.document,
        this.t("close"),
        () => modal.close?.(),
        "close",
        `${SCRIPT_PREFIX}-details-close`,
      );
      const main = modal.querySelector("main");

      const helpers = this.buildDetailModalHelpers();

      const tabs = createElement(this.document, "div", `${SCRIPT_PREFIX}-detail-tabs`);
      const header = createElement(this.document, "div", `${SCRIPT_PREFIX}-details-header`);
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

      const mediaPanel = this.renderDetailsMediaPanel(details, helpers);
      const authorPanel = this.renderDetailsAuthorPanel(details, helpers);
      const postPanel = this.renderDetailsPostPanel(details, helpers);
      const jsonPanel = this.renderDetailsJsonPanel(details, media, helpers);

      panels.set("media", mediaPanel);
      panels.set("author", authorPanel);
      panels.set("post", postPanel);
      panels.set("json", jsonPanel);
      body.append(mediaPanel, authorPanel, postPanel, jsonPanel);
      header.append(tabs, close);
      main.append(header, body);
    }

    getProfileBulkTaskDelayMs() {
      return 1500 + Math.floor(Math.random() * 501);
    }

    showBulkDownloadProgress(index, total, detail = "") {
      this.notifications.setDownloadStatus({
        type: "busy",
        title: `${this.t("bulk_downloading")} ${index}/${total}`,
        detail,
      });
    }

    async resolveProfileBulkMedia(item = {}) {
      const rawUrl = item?.pageUrl || item?.href || "";
      const identity = parseTikTokItemIdentityFromUrl(rawUrl);
      const trace = {
        capturedAt: new Date().toISOString(),
        itemId: item?.id || "",
        rawUrl,
        identity: identity ? { ...identity, evidence: "profile-card-link" } : null,
      };
      if (!identity) {
        this.lastProfileBulkResolve = {
          ...trace,
          result: "failure",
          errorCode: "canonical-permalink-missing",
        };
        return null;
      }
      const dataResult = this.itemDataProvider.resolve(
        {
          identity: { ...identity, evidence: "profile-card-link" },
          fragments: item?.exactItem ? [item.exactItem] : [],
        },
        this.configStore.get(),
      );
      if (!dataResult?.ok) {
        this.lastProfileBulkResolve = {
          ...trace,
          result: "failure",
          errorCode: dataResult?.code || "detail-data-missing",
          details: dataResult?.details || null,
          provider: this.itemDataProvider.getDebugSnapshot(),
        };
        return null;
      }
      const media = normalizeMediaItem(
        dataResult.item,
        identity.permalink,
        this.configStore.get(),
      );
      if (!hasUsableMedia(media) || String(media.id || "") !== identity.id) {
        this.lastProfileBulkResolve = {
          ...trace,
          result: "failure",
          errorCode: hasUsableMedia(media) ? "detail-id-mismatch" : "media-empty",
          returnedMediaId: media?.id || "",
        };
        return null;
      }
      media.extraction = {
        source: dataResult.source,
        exactId: true,
        identityEvidence: "profile-card-link",
      };
      this.lastProfileBulkResolve = {
        ...trace,
        result: "success",
        source: dataResult.source,
        mediaId: media.id,
      };
      return media;
    }

    async downloadResolvedMedia(media, context = {}) {
      const bulk = context.bulk === true;
      const imageEntries = ensureArray(media?.images)
        .filter((image) => image?.url)
        .map((image, index) => ({
          image,
          originalIndex: Math.max(0, Number(image.index || index + 1) - 1),
        }));
      if (!media?.video?.primaryUrl && imageEntries.length) {
        const successfulAssets = [];
        const failedAssets = [];
        for (let index = 0; index < imageEntries.length; index += 1) {
          const entry = imageEntries[index];
          const image = entry.image;
          const originalIndex = entry.originalIndex;
          const filename = this.getImageFilename(
            media,
            image,
            originalIndex,
          );
          if (this.downloadCancelRequested) {
            return {
              status: "cancelled",
              successfulAssets,
              failedAssets,
              message: this.t(bulk ? "bulk_download_cancelled" : "download_cancelled"),
            };
          }
          if (bulk) {
            this.showBulkDownloadProgress(
              context.index || 1,
              context.total || 1,
              `${this.t("bulk_type_album")} ${index + 1}/${imageEntries.length} · ${filename}`,
            );
          } else {
            this.notifications.showAlbumProgress(index + 1, imageEntries.length, filename);
          }
          try {
            await this.downloader.downloadUrl(
              unique([image.url, ...ensureArray(image.fallbackUrls)]),
              filename,
            );
            successfulAssets.push({
              index: originalIndex + 1,
              url: image.url,
              filename,
            });
          } catch (err) {
            failedAssets.push({
              index: originalIndex + 1,
              filename,
              message: err?.message || String(err),
              stage: "download-image",
            });
          }
          if (
            bulk &&
            index < imageEntries.length - 1 &&
            !this.downloadCancelRequested
          ) {
            await this.wait(500);
          }
        }
        if (!failedAssets.length) {
          return {
            status: "success",
            successfulAssets,
            failedAssets: [],
            filename: successfulAssets.at(-1)?.filename || "",
          };
        }
        return {
          status: successfulAssets.length ? "partial" : "failed",
          successfulAssets,
          failedAssets,
          message: failedAssets[0]?.message || this.t("download_failed"),
        };
      }
      if (!media?.video?.primaryUrl) {
        return {
          status: "failed",
          successfulAssets: [],
          failedAssets: [],
          message: this.t("no_media"),
        };
      }
      if (this.downloadCancelRequested) {
        return {
          status: "cancelled",
          successfulAssets: [],
          failedAssets: [],
          message: this.t(bulk ? "bulk_download_cancelled" : "download_cancelled"),
        };
      }
      const filename = this.getFilename(
        media,
        media.video.format || "mp4",
      );
      if (!bulk) this.notifications.showVideoPreparing(filename);
      try {
        await this.downloader.downloadUrl(
          [
            media.video.primaryUrl,
            ...ensureArray(media.video.fallbackUrls),
          ],
          filename,
        );
        return {
          status: "success",
          successfulAssets: [{ filename, url: media.video.primaryUrl }],
          failedAssets: [],
          filename,
        };
      } catch (err) {
        const message = err?.message || String(err);
        return {
          status: "failed",
          successfulAssets: [],
          failedAssets: [{ filename, url: media.video.primaryUrl, message }],
          message,
        };
      }
    }

    async downloadProfileBulkItems(items = []) {
      const queue = ensureArray(items).filter(Boolean);
      if (!queue.length) {
        this.notifications.toast(this.t("bulk_no_selection"));
        return;
      }
      if (this.isDownloading) {
        this.notifications.nudgeDownloadStatus();
        return;
      }
      this.isDownloading = true;
      this.downloadCancelRequested = false;
      queue.forEach((item) => {
        item.bulkDownloadResult = { status: "pending" };
      });
      let success = 0;
      let failed = 0;
      let cancelled = false;
      const runTrace = {
        startedAt: new Date().toISOString(),
        queueSize: queue.length,
        results: [],
      };
      try {
        for (let index = 0; index < queue.length; index += 1) {
          const item = queue[index];
          if (this.downloadCancelRequested) {
            cancelled = true;
            break;
          }
          if (index > 0) await this.wait(this.getProfileBulkTaskDelayMs());
          if (this.downloadCancelRequested) {
            cancelled = true;
            break;
          }
          this.showBulkDownloadProgress(
            index + 1,
            queue.length,
            item.desc || item.pageUrl || item.id || "",
          );
          try {
            const media = await this.resolveProfileBulkMedia(item);
            if (!hasUsableMedia(media)) {
              failed += 1;
              item.bulkDownloadResult = { status: "failed" };
              runTrace.results.push({
                itemId: item.id || "",
                status: "failed",
                message: this.t("no_media"),
                errorCode: this.lastProfileBulkResolve?.errorCode || "media-empty",
              });
              continue;
            }
            const result = await this.downloadResolvedMedia(media, {
              bulk: true,
              index: index + 1,
              total: queue.length,
            });
            const status = result?.status || "failed";
            const successfulAssetCount = ensureArray(result?.successfulAssets).length;
            const failedAssetCount = ensureArray(result?.failedAssets).length;
            item.bulkDownloadResult = {
              status,
              successfulAssetCount,
              totalAssetCount: successfulAssetCount + failedAssetCount,
            };
            runTrace.results.push({
              itemId: item.id || media.id || "",
              mediaSource: media.extraction?.source || "",
              status,
              successfulAssetCount,
              failedAssetCount,
              message: result?.message || "",
            });
            if (status === "success") {
              success += 1;
            } else {
              if (status === "cancelled") cancelled = true;
              else failed += 1;
              if (status === "cancelled") {
                break;
              }
            }
          } catch (err) {
            failed += 1;
            item.bulkDownloadResult = { status: "failed" };
            runTrace.results.push({
              itemId: item.id || "",
              status: "failed",
              message: err?.message || String(err),
            });
          }
        }
        runTrace.completedAt = new Date().toISOString();
        runTrace.success = success;
        runTrace.failed = failed;
        runTrace.cancelled = cancelled;
        this.lastProfileBulkRun = runTrace;
        const detail = this.t("bulk_download_result_detailed")
          .replaceAll("${success}", String(success))
          .replaceAll("${failed}", String(failed));
        if (cancelled) {
          this.notifications.setDownloadStatus({
            type: "error",
            title: this.t("bulk_download_cancelled"),
            detail,
          });
        } else if (failed) {
          this.notifications.setDownloadStatus({
            type: "error",
            title: this.t("bulk_download_done"),
            detail,
          });
        } else {
          this.notifications.setDownloadStatus({
            type: "success",
            title: this.t("bulk_download_done"),
            detail,
            autoHideMs: 3500,
          });
        }
      } finally {
        this.isDownloading = false;
        this.downloadCancelRequested = false;
        this.profilePageBulkAdapter?.refreshCheckboxStates?.();
      }
      if (cancelled || failed) this.profilePageBulkAdapter?.openConfirmModal?.();
    }

    requestDownloadCancel() {
      if (!this.isDownloading) return false;
      this.downloadCancelRequested = true;
      return true;
    }

    buildSettingsFieldset(title, ...children) {
      const fieldset = createElement(this.document, "fieldset", `${SCRIPT_PREFIX}-detail-fieldset ${SCRIPT_PREFIX}-settings-fieldset`);
      fieldset.appendChild(createElement(this.document, "legend", "", title));
      children.filter(Boolean).forEach((child) => fieldset.appendChild(child));
      return fieldset;
    }

    buildSettingsAppearanceGrid(config) {
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

      const grid = createElement(this.document, "div", `${SCRIPT_PREFIX}-settings-grid`);
      grid.append(language.wrapper);
      return grid;
    }

    buildSettingsDownloadGrid(config) {
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

      const grid = createElement(this.document, "div", `${SCRIPT_PREFIX}-settings-grid`);
      grid.append(quality.wrapper);

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
      grid.appendChild(sourceColumns);

      return grid;
    }

    buildSettingsProfileBulkGrid(config) {
      const wrapper = createElement(this.document, "div", `${SCRIPT_PREFIX}-field ${SCRIPT_PREFIX}-profile-slider-field`);
      const head = createElement(this.document, "div", `${SCRIPT_PREFIX}-profile-slider-head`);
      const label = createElement(this.document, "label", "", this.t("profile_bulk_checkbox_size"));
      const desc = createElement(
        this.document,
        "span",
        `${SCRIPT_PREFIX}-profile-slider-desc`,
        this.t("tooltip_profile_bulk_checkbox_size"),
      );
      const valueEl = createElement(this.document, "span", `${SCRIPT_PREFIX}-profile-slider-value`);
      const slider = createElement(this.document, "input");
      slider.type = "range";
      slider.dataset.configKey = "profile_bulk_checkbox_size";
      slider.min = "18";
      slider.max = "40";
      slider.step = "2";
      slider.value = String(config.profile_bulk_checkbox_size ?? DEFAULT_CONFIG.profile_bulk_checkbox_size);
      const updateValue = () => {
        valueEl.textContent = `${Math.round(clampNumber(Number(slider.value), 18, 40, DEFAULT_CONFIG.profile_bulk_checkbox_size))}px`;
      };
      slider.addEventListener("input", updateValue);
      updateValue();
      head.append(label, desc, valueEl);
      wrapper.append(head, slider);
      slider.wrapper = wrapper;

      const grid = createElement(this.document, "div", `${SCRIPT_PREFIX}-settings-grid`);
      grid.append(slider.wrapper);
      return grid;
    }

    buildSettingsFilenameGrid(config) {
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
      const grid = createElement(this.document, "div", `${SCRIPT_PREFIX}-settings-grid`);
      grid.append(maxLength.wrapper, albumIndexFormat.wrapper, filenameEditor.element);
      return { grid, filenameEditor };
    }

    buildSettingsShortcutGrid(config) {
      const grid = createElement(this.document, "div", `${SCRIPT_PREFIX}-settings-grid`);
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
      grid.append(...shortcutInputs.map((input) => input.wrapper), shortcutNote);
      return grid;
    }

    buildSettingsAdvancedSection(config, settingsTitle) {
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
      const fieldset = this.buildSettingsFieldset(this.t("advanced_section"), advancedGrid);
      fieldset.hidden = true;

      let clickCount = 0;
      let clickTimer = null;
      settingsTitle.addEventListener("click", () => {
        clickCount += 1;
        if (clickTimer) this.window.clearTimeout?.(clickTimer);
        clickTimer = this.window.setTimeout?.(() => {
          clickCount = 0;
          clickTimer = null;
        }, 1500) || null;
        if (clickCount >= 5) {
          fieldset.hidden = false;
          clickCount = 0;
        }
      });

      return { fieldset, showTestMenu, showDebugInfoMenu };
    }

    openSettings() {
      const config = this.configStore.get();
      const modal = this.createModal(this.t("settings"), "", {
        closeOnBackdrop: false,
        showHeader: false,
      });
      modal.classList.add(`${SCRIPT_PREFIX}-settings-modal`);
      const main = modal.querySelector("main");
      const closeModal = () => modal.close?.();

      const header = createElement(this.document, "header", `${SCRIPT_PREFIX}-settings-header`);
      const settingsTitle = createElement(this.document, "h2", "", this.t("settings"));
      header.appendChild(settingsTitle);
      const headerActions = createElement(this.document, "div", `${SCRIPT_PREFIX}-settings-header-actions`);
      header.appendChild(headerActions);
      modal.insertBefore(header, main);

      const appearanceGrid = this.buildSettingsAppearanceGrid(config);
      const downloadGrid = this.buildSettingsDownloadGrid(config);
      const profileBulkGrid = this.buildSettingsProfileBulkGrid(config);
      const { grid: filenameGrid, filenameEditor } = this.buildSettingsFilenameGrid(config);
      const shortcutGrid = this.buildSettingsShortcutGrid(config);
      const { fieldset: advancedFieldset, showTestMenu, showDebugInfoMenu } =
        this.buildSettingsAdvancedSection(config, settingsTitle);

      main.append(
        this.buildSettingsFieldset(this.t("appearance_section"), appearanceGrid),
        this.buildSettingsFieldset(this.t("download_section"), downloadGrid),
        this.buildSettingsFieldset(this.t("profile_bulk_section"), profileBulkGrid),
        this.buildSettingsFieldset(this.t("filename_section"), filenameGrid),
        this.buildSettingsFieldset(this.t("shortcut_section"), shortcutGrid),
        advancedFieldset,
      );

      headerActions.append(
        createTuxIconButton(this.document, this.t("save"), () => {
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
          this.renderImageDownloadButton();
          this.mountPanel();
          closeModal();
          this.notifications.toast(this.t("settings_saved"));
        }, "save"),
        createTuxIconButton(this.document, this.t("close"), closeModal),
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
        const cursor = templateInput.selectionStart ?? rawValue.length;
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
        if (!getFilenameField(token)) return;
        insertTextAtSelection(templateInput, `\${${token}}`);
        templateInput.dispatchEvent(new Event("input", { bubbles: true }));
      };

      const insertLiteral = (literal) => {
        insertTextAtSelection(templateInput, literal);
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

    fieldLabel(field) {
      const language = resolveLanguage(this.configStore.get(), this.window.navigator);
      return language === "zh" ? field?.zh || field?.en || "" : field?.en || field?.zh || "";
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
      const classes = className.split(/\s+/).filter(Boolean);
      const variant = classes.find((name) => name === "primary" || name === "secondary") || "";
      const tuxClasses = variant
        ? ` TUXButton TUXButton--capsule TUXButton--medium TUXButton--${variant}`
        : "";
      const button = createElement(
        this.document,
        "button",
        `${SCRIPT_PREFIX}-button${tuxClasses}${className ? ` ${className}` : ""}`,
      );
      button.type = "button";
      if (variant) {
        button.appendChild(createElement(this.document, "div", "TUXButton-content", text));
      } else {
        button.textContent = text;
      }
      button.addEventListener("click", onClick);
      return button;
    }

    createModal(title, subtitle = "", options = {}) {
      const backdrop = createElement(
        this.document,
        "div",
        `${SCRIPT_PREFIX}-modal-backdrop`,
      );
      const modal = createElement(
        this.document,
        "section",
        `${SCRIPT_PREFIX}-modal`,
      );
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      if (title) modal.setAttribute("aria-label", title);
      const main = createElement(this.document, "main");
      let close = null;
      if (options.showHeader !== false) {
        const header = createElement(this.document, "header");
        const titleGroup = createElement(this.document, "div");
        const heading = createElement(this.document, "h2", "", title);
        titleGroup.appendChild(heading);
        if (subtitle) {
          titleGroup.appendChild(
            createElement(
              this.document,
              "p",
              `${SCRIPT_PREFIX}-subtitle`,
              subtitle,
            ),
          );
        }
        close = createTuxIconButton(this.document, this.t("close"));
        header.append(titleGroup, close);
        modal.append(header, main);
      } else {
        modal.appendChild(main);
      }
      backdrop.appendChild(modal);

      const previousActiveElement = this.document.activeElement;
      let closed = false;
      const handleEscape = (event) => {
        if (event.key === "Escape" || event.key === "Esc") {
          closeModal("escape");
        }
      };
      const closeModal = (reason = "programmatic") => {
        if (closed) return;
        closed = true;
        this.document.removeEventListener("keydown", handleEscape, true);
        backdrop.remove();
        try {
          options.onClose?.(reason);
        } catch (_err) {}
        if (
          options.restoreFocus !== false &&
          previousActiveElement?.isConnected &&
          typeof previousActiveElement.focus === "function"
        ) {
          previousActiveElement.focus();
        }
      };

      modal.close = closeModal;
      backdrop.closeModal = closeModal;
      close?.addEventListener("click", () => closeModal("close-button"));
      if (options.closeOnBackdrop !== false) {
        backdrop.addEventListener("click", (event) => {
          if (event.target === backdrop) closeModal("backdrop");
        });
      }
      this.document.addEventListener("keydown", handleEscape, true);
      this.document.body.appendChild(backdrop);
      const focusModal = () => {
        const focusTarget = modal.querySelector(`.${SCRIPT_PREFIX}-close-button`);
        if (!closed && focusTarget?.isConnected) focusTarget.focus?.({ preventScroll: true });
      };
      if (typeof this.window.requestAnimationFrame === "function") {
        this.window.requestAnimationFrame(focusModal);
      } else {
        this.window.setTimeout?.(focusModal, 0);
      }
      return modal;
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
            this.currentMedia = null;
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
      const placement = this.resolvePanelPlacement();
      return [
        this.window.location?.href || "",
        placement.surface,
        this.window.innerWidth || 0,
        this.window.innerHeight || 0,
        this.openImageOverlay?.imageUrl || "",
        placement.signature,
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
        const now = Date.now();
        const elapsed = now - (this.lastPanelPositionCheckAt || 0);
        if (elapsed >= PANEL_POSITION_CHECK_THROTTLE_MS) {
          this.lastPanelPositionCheckAt = now;
          const signature = this.getPanelPositionSignature();
          if (signature === this.lastPanelPositionSignature) return;
          this.lastPanelPositionSignature = signature;
          schedule();
          return;
        }
        if (this.pendingPanelPositionCheck) return;
        this.pendingPanelPositionCheck = this.window.setTimeout(() => {
          this.pendingPanelPositionCheck = null;
          this.lastPanelPositionCheckAt = Date.now();
          const signature = this.getPanelPositionSignature();
          if (signature === this.lastPanelPositionSignature) return;
          this.lastPanelPositionSignature = signature;
          schedule();
        }, PANEL_POSITION_CHECK_THROTTLE_MS - elapsed);
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
        this.positionObserver = new this.window.MutationObserver((records) => {
          const hasExternalMutation = records.some((record) => {
            const target = record.target;
            if (this.panel?.contains?.(target)) return false;
            if (this.notifications?.notificationStackEl?.contains?.(target)) return false;
            return true;
          });
          if (hasExternalMutation) scheduleIfChanged();
          checkImageOverlay();
        });
        this.positionObserver.observe(this.document.body, {
          childList: true,
          subtree: true,
        });
      } else {
        this.positionObserver = { disconnect() {} };
      }
      this.window.addEventListener?.("resize", scheduleIfChanged);
      this.window.addEventListener?.("orientationchange", scheduleIfChanged);
      this.document.addEventListener?.("scroll", scheduleIfChanged, true);
      if (!this.positionPoll && typeof this.window.setInterval === "function") {
        this.positionPoll = this.window.setInterval(scheduleIfChanged, 2000);
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

  const INSTALL_FLAG = "__tthelperInstalled__";

  if (root?.document && !root[INSTALL_FLAG]) {
    Object.defineProperty(root, INSTALL_FLAG, {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    });

    const start = () => {
      const app = new TikTokDlApp(root);
      app.start();
    };
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
      start();
    }
  }
})(typeof unsafeWindow !== "undefined" ? unsafeWindow : window);
