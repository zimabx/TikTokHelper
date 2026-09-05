// ==UserScript==
// @name			TikTokHelper
// @name:zh-CN		TikTokHelper - TikTok 下载助手
// @description		Add compact TikTok tools for video and photo downloads, frame capture, media details, comment translation, customizable filenames, and profile bulk downloads.
// @description:zh-CN	为 TikTok 网页端添加紧凑工具，支持视频与图集下载、视频帧截取、媒体详情、评论翻译、自定义文件名和个人主页批量下载。
// @namespace		https://github.com/zimabx/TikTokHelper
// @supportURL		https://github.com/zimabx/TikTokHelper/issues
// @version			1.2.1
// @author			zimabx
// @match           https://*.tiktok.com/*
// @icon            https://www.google.com/s2/favicons?sz=64&domain=tiktok.com
// @license         MIT
// @grant           GM_xmlhttpRequest
// @grant           GM_download
// @grant           GM_registerMenuCommand
// @connect         *
// @noframes
// @run-at          document-start
// ==/UserScript==

(function (root) {
    "use strict";

    const SCRIPT_PREFIX = "tthelper";
    const CONFIG_KEY = "__tthelper-user-js__";

    function installEarlyDarkBootGate() {
        const doc = root?.document;
        if (!doc) return;

        try {
            const raw = root.localStorage?.getItem(CONFIG_KEY);
            const value = raw ? JSON.parse(raw)?.dark_boot_screen : undefined;
            const normalized = String(value ?? "").trim().toLowerCase();
            if (value !== true && !["dark", "true", "1", "yes", "on"].includes(normalized)) {
                return;
            }
        } catch (_err) {
            return;
        }

        const ATTR = `data-${SCRIPT_PREFIX}-black-gate`;
        const STYLE_ID = `${SCRIPT_PREFIX}-black-gate-style`;
        const CHECK_MS = 80;
        const FAILSAFE_MS = 8000;
        const MEDIA_RATIO = 0.06;

        let checkTimer = 0;
        let failSafeTimer = 0;
        let released = false;

        const hold = () => {
            const html = doc.documentElement;
            if (!html) return false;

            html.setAttribute(ATTR, "");

            if (!doc.getElementById(STYLE_ID)) {
                const style = doc.createElement("style");
                style.id = STYLE_ID;
                style.textContent = `
 html[${ATTR}], html[${ATTR}] body { background: #000 !important; }
 html[${ATTR}] { color-scheme: dark; }
 html[${ATTR}] body { visibility: hidden !important; }
`;
                html.appendChild(style);
            }
            return true;
        };

        const visibleArea = (element) => {
            const rect = element.getBoundingClientRect();
            const width = Math.max(0, Math.min(rect.right, root.innerWidth) - Math.max(rect.left, 0));
            const height = Math.max(0, Math.min(rect.bottom, root.innerHeight) - Math.max(rect.top, 0));
            return width * height;
        };

        const ready = () => {
            const viewportArea = root.innerWidth * root.innerHeight;
            if (!doc.body || !viewportArea) return false;

            let largeMedia = false;
            for (const media of doc.querySelectorAll("video, img")) {
                if (visibleArea(media) < viewportArea * MEDIA_RATIO) continue;
                largeMedia = true;

                if (media.tagName === "VIDEO") {
                    if (media.readyState >= 2 && media.videoWidth && media.videoHeight) return true;
                } else if (media.complete && media.naturalWidth && media.naturalHeight) {
                    return true;
                }
            }

            if (largeMedia) return false;

            const content = doc.querySelector(
                'main,[role="main"],[data-e2e="user-post-item-list"],[data-e2e="feed-video"]'
            );
            if (!content || visibleArea(content) < viewportArea * 0.15) return false;

            return content.childElementCount > 0 || content.textContent.trim().length > 20;
        };

        const release = (reason) => {
            if (released) return;
            released = true;
            root.clearInterval(checkTimer);
            root.clearTimeout(failSafeTimer);

            root.requestAnimationFrame(() => root.requestAnimationFrame(() => {
                doc.documentElement?.removeAttribute(ATTR);
                root.console?.info?.(`[TTH Black Gate] ${reason}`);
            }));
        };

        const start = () => {
            if (!hold()) {
                root.setTimeout(start, 0);
                return;
            }

            checkTimer = root.setInterval(() => {
                if (ready()) release("ready");
            }, CHECK_MS);
            failSafeTimer = root.setTimeout(() => release("failsafe"), FAILSAFE_MS);
        };

        root.addEventListener("beforeunload", hold, true);
        root.addEventListener("pagehide", (event) => {
            if (!event.persisted) hold();
        }, true);

        start();
    }

    installEarlyDarkBootGate();
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
    const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
    const PANEL_POSITION_CHECK_THROTTLE_MS = 250;
    const FRAME_SAVE_FORMATS = [
        { extension: "png", mimeType: "image/png" },
        { extension: "jpg", mimeType: "image/jpeg" },
        { extension: "webp", mimeType: "image/webp" },
    ];

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
        filename_max_length: 64,
        album_index_format: "_01",
        video_quality: "highest_resolution",
        video_source_columns: [...DEFAULT_VIDEO_SOURCE_COLUMNS],
        language: "auto",
        dark_boot_screen: "original",
        shortcut_download: "",
        shortcut_frame: "",
        shortcut_details: "",
        shortcut_settings: "",
        profile_bulk_checkbox_size: 26,
        show_test_notification_menu: false,
        show_debug_info_menu: false,
        comment_translation_provider: "google",
        comment_translation_target: "en",
        comment_translation_display_mode: "replace",
        comment_translation_auto_open: "manual",
    };

    const COMMENT_TRANSLATION_PROVIDERS = [
        { value: "google", messageKey: "translation_provider_google" },
        { value: "bing", messageKey: "translation_provider_bing" },
    ];

    const COMMENT_TRANSLATION_TARGETS = [
        ["ar", "العربية"],
        ["de", "Deutsch"],
        ["en", "English"],
        ["es", "Español"],
        ["fr", "Français"],
        ["id", "Bahasa Indonesia"],
        ["ja", "日本語"],
        ["ko", "한국어"],
        ["pt", "Português"],
        ["ru", "Русский"],
        ["th", "ไทย"],
        ["vi", "Tiếng Việt"],
        ["zh-CN", "简体中文"],
        ["zh-TW", "繁體中文"],
    ];

    const COMMENT_TRANSLATION_DISPLAY_MODES = [
        { value: "comparison", messageKey: "translation_display_comparison" },
        { value: "replace", messageKey: "translation_display_replace" },
    ];
    const DARK_BOOT_SCREEN_MODES = [
        { value: "original", messageKey: "startup_page_original" },
        { value: "dark", messageKey: "startup_page_dark" },
    ];
    const COMMENT_TRANSLATION_ACTIVATION_MODES = [
        { value: "manual", messageKey: "translation_activation_manual" },
        { value: "auto", messageKey: "translation_activation_auto" },
    ];
    function normalizeSafeDownloadUrl(rawUrl = "", baseUrl = "https://www.tiktok.com/") {
        const value = String(rawUrl || "").trim();
        if (!value) throw new Error("Empty download URL");

        const parsed = new URL(value, baseUrl);
        if (parsed.protocol !== "https:") {
            throw new Error(`Blocked non-HTTPS download URL: ${parsed.protocol}`);
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
            download_sticker: "Download Sticker",
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
            dark_boot_screen: "Startup page",
            startup_page_original: "Original",
            startup_page_dark: "Dark",
            comment_translation_section: "Comment translation",
            comment_translation_provider: "Translation service",
            comment_translation_target: "Target language",
            comment_translation_display_mode: "Translation display",
            comment_translation_auto_open: "Activation mode",
            translation_activation_manual: "Manual",
            translation_activation_auto: "Automatic",
            translation_display_comparison: "Bilingual comparison",
            translation_display_replace: "Replace with translation",
            translation_provider_google: "Google (free)",
            translation_provider_bing: "Bing (free)",
            comment_translation_note: "Support for AI or API keys may be added in the future.",
            translate_comments: "Translate",
            show_original_comments: "Original",
            show_translated_comments: "Translation",
            hide_translated_comments: "Hide translation",
            translating_comments: "Translating…",
            comment_translation_failed: "Comment translation failed",
            comment_translation_rate_limited: "The translation service is rate-limiting requests. Automatic translation has stopped; try again later or switch providers in Settings.",
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
            invert_selection: "Invert selection",
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
            shortcut_conflict: "Shortcut conflict: ${first} and ${second} both use ${hotkey}.",
            shortcut_reserved_m: "M is reserved for TikTok mute. Choose a modified shortcut such as Shift+M.",
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
            bulk_retry_failed: "Retry failed items",
            bulk_continue_download: "Continue download",
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
            download_sticker: "下载贴纸",
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
            dark_boot_screen: "启动页",
            startup_page_original: "原版",
            startup_page_dark: "黑色",
            comment_translation_section: "评论翻译",
            comment_translation_provider: "翻译服务",
            comment_translation_target: "目标语言",
            comment_translation_display_mode: "翻译显示方式",
            comment_translation_auto_open: "启动方式",
            translation_activation_manual: "手动",
            translation_activation_auto: "自动",
            translation_display_comparison: "双语对照",
            translation_display_replace: "译文替换",
            translation_provider_google: "谷歌（免费）",
            translation_provider_bing: "必应（免费）",
            comment_translation_note: "后续可能会支持接入 AI 或 API Key",
            translate_comments: "翻译",
            show_original_comments: "原文",
            show_translated_comments: "译文",
            hide_translated_comments: "隐藏译文",
            translating_comments: "翻译中…",
            comment_translation_failed: "评论翻译失败",
            comment_translation_rate_limited: "翻译服务请求过于频繁，已停止自动翻译。请稍后重试，或在设置中切换翻译服务。",
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
            invert_selection: "反选",
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
            shortcut_conflict: "快捷键冲突：${first} 和 ${second} 都使用了 ${hotkey}。",
            shortcut_reserved_m: "M 是 TikTok 的静音快捷键，请改用 Shift+M 等带修饰键的组合。",
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
            bulk_retry_failed: "重试失败项",
            bulk_continue_download: "继续下载",
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

    const SHORTCUT_CONFIG_KEYS = [
        "shortcut_download",
        "shortcut_frame",
        "shortcut_details",
        "shortcut_settings",
    ];

    function findShortcutConflict(values = {}) {
        const used = new Map();
        for (const key of SHORTCUT_CONFIG_KEYS) {
            const hotkey = normalizeHotkey(values?.[key]);
            if (!hotkey) continue;
            const firstKey = used.get(hotkey);
            if (firstKey) return { hotkey, firstKey, secondKey: key };
            used.set(hotkey, key);
        }
        return null;
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

    function normalizeDarkBootScreenMode(value) {
        if (value === true) return "dark";
        if (value === false) return "original";
        const text = String(value ?? "").trim().toLowerCase();
        if (text === "dark") return "dark";
        if (text === "original") return "original";
        if (["true", "1", "yes", "on"].includes(text)) return "dark";
        if (["false", "0", "no", "off"].includes(text)) return "original";
        return DEFAULT_CONFIG.dark_boot_screen;
    }

    function normalizeCommentTranslationActivationMode(value) {
        if (value === true) return "auto";
        if (value === false) return "manual";
        const text = String(value ?? "").trim().toLowerCase();
        if (text === "auto") return "auto";
        if (text === "manual") return "manual";
        if (["true", "1", "yes", "on"].includes(text)) return "auto";
        if (["false", "0", "no", "off"].includes(text)) return "manual";
        return DEFAULT_CONFIG.comment_translation_auto_open;
    }

    function sanitizeConfig(config = {}) {
        const merged = { ...DEFAULT_CONFIG, ...(config || {}) };
        const next = {};
        for (const key of Object.keys(DEFAULT_CONFIG)) {
            next[key] = merged[key];
        }
        next.filename_template = getFilenameTemplate(next);
        const filenameMaxLength = Number(next.filename_max_length);
        next.filename_max_length = Number.isFinite(filenameMaxLength)
            ? Math.floor(Math.max(8, Math.min(255, filenameMaxLength)))
        : DEFAULT_CONFIG.filename_max_length;
        next.album_index_format = normalizeAlbumIndexFormat(next.album_index_format);
        if (!VIDEO_QUALITY_OPTIONS.includes(next.video_quality)) {
            next.video_quality = DEFAULT_CONFIG.video_quality;
        }
        if (!LANGUAGE_OPTIONS.some(([value]) => value === next.language)) {
            next.language = DEFAULT_CONFIG.language;
        }
        next.dark_boot_screen = normalizeDarkBootScreenMode(next.dark_boot_screen);
        next.video_source_columns = normalizeVideoSourceColumns(next.video_source_columns);
        next.profile_bulk_checkbox_size = clampNumber(
            Number(next.profile_bulk_checkbox_size),
            18,
            40,
            DEFAULT_CONFIG.profile_bulk_checkbox_size,
        );
        next.shortcut_download = normalizeHotkey(next.shortcut_download);
        if (next.shortcut_download === "M") next.shortcut_download = "";
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
        if (!COMMENT_TRANSLATION_PROVIDERS.some(({ value }) => value === next.comment_translation_provider)) {
            next.comment_translation_provider = DEFAULT_CONFIG.comment_translation_provider;
        }
        if (!COMMENT_TRANSLATION_TARGETS.some(([value]) => value === next.comment_translation_target)) {
            next.comment_translation_target = DEFAULT_CONFIG.comment_translation_target;
        }
        if (!COMMENT_TRANSLATION_DISPLAY_MODES.some(({ value }) => value === next.comment_translation_display_mode)) {
            next.comment_translation_display_mode = DEFAULT_CONFIG.comment_translation_display_mode;
        }
        next.comment_translation_auto_open =
            normalizeCommentTranslationActivationMode(next.comment_translation_auto_open);
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

    function findLiveNicknameInReact(elements = []) {
        const queue = [];
        for (const element of ensureArray(elements).filter(Boolean)) {
            for (const rootValue of getReactInternalRoots(element)) {
                queue.push({ value: rootValue, depth: 0 });
            }
        }

        const seen = new Set();
        let inspected = 0;
        const maxObjects = 240;
        const maxDepth = 6;
        const allowedKey = /^(?:children|props|liveInfo|liveRoomInfo|item|prerenderLiveParams)$/i;

        while (queue.length && inspected < maxObjects) {
            const current = queue.shift();
            const value = current?.value;
            const depth = Number(current?.depth || 0);
            if (!value || typeof value !== "object" || seen.has(value)) continue;
            seen.add(value);
            inspected += 1;

            const liveInfo = value.liveInfo;
            const nickname = firstString(liveInfo?.nickname, liveInfo?.nickName);
            if (nickname) return nickname;
            if (depth >= maxDepth) continue;

            if (Array.isArray(value)) {
                for (const child of value.slice(0, 40)) {
                    if (child && typeof child === "object") {
                        queue.push({ value: child, depth: depth + 1 });
                    }
                }
                continue;
            }

            let entries = [];
            try {
                entries = Object.entries(value);
            } catch (_err) {
                continue;
            }
            for (const [key, child] of entries) {
                if (!allowedKey.test(key) || !child || typeof child !== "object") continue;
                queue.push({ value: child, depth: depth + 1 });
            }
        }
        return "";
    }

    function compactLiveContextText(value = "") {
        return String(value || "").replace(/\s+/g, "").trim();
    }

    function isLikelyLiveContextText(actionText = "", contextText = "") {
        const compactAction = compactLiveContextText(actionText);
        const compactContext = compactLiveContextText(contextText);
        const combined = `${compactAction}${compactContext}`;
        if (!combined) return false;
        if (
            /(点击以观看直播|观看直播|直播中|正在直播|进入直播间|LIVE中|ClicktowatchLIVE|LIVEnow)/i.test(combined)
        ) {
            return true;
        }
        return /^LIVE\d*$/i.test(compactAction);
    }

    function hasStrongLiveContextStructure(context = null) {
        if (!context?.querySelector) return false;
        if (
            context.querySelector(
                '[data-e2e="live-like-icon"], [data-e2e="live-share-icon"], [data-e2e="live-like-count"], [data-e2e="live-share-count"]',
            )
        ) {
            return true;
        }
        return Boolean(
            context.querySelector('a[href*="/live"][href*="video_id=live_"]'),
        );
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

    function safeDecodeURIComponent(value) {
        try {
            return decodeURIComponent(String(value || ""));
        } catch (_err) {
            return "";
        }
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
        return match ? safeDecodeURIComponent(match[1]) : "";
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
        const requestedMaxLength = Number(options.maxLength || 255);
        const maxLength = Number.isFinite(requestedMaxLength)
        ? Math.floor(Math.max(1, Math.min(255, requestedMaxLength)))
        : 255;
        const replacementChar = String(options.replacementChar || "_")
        .replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, "_")
        .slice(0, 1) || "_";
        if (typeof name !== "string") return "";

        const cleanName = name
        .replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, replacementChar)
        .trim()
        .replace(/^\.+/, "")
        .replace(/[. ]+$/, "");
        const extensionMatch = options.preserveExtension === true
        ? cleanName.match(/\.[a-z0-9]{2,5}$/i)
        : null;
        let extension = extensionMatch?.[0] || "";
        let cleanBase = (extension ? cleanName.slice(0, -extension.length) : cleanName)
        .trim()
        .replace(/[. ]+$/, "");
        if (/^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(\..*)?$/i.test(cleanBase)) {
            cleanBase = replacementChar + cleanBase;
        }
        if (!cleanBase) cleanBase = "download";

        if (extension.length >= maxLength) extension = "";
        const allowedBaseLength = Math.max(1, maxLength - extension.length);
        if (cleanBase.length > allowedBaseLength) {
            cleanBase = truncateAtUtf16Boundary(cleanBase, allowedBaseLength).trim();
            if (!cleanBase) cleanBase = truncateAtUtf16Boundary("download", allowedBaseLength);
        }
        return cleanBase + extension;
    }

    function normalizeFileExtension(value = "", fallback = "mp4") {
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
        : null;
        const hasCreateDate = createDate instanceof Date && !Number.isNaN(createDate.getTime());
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
            create_date_YYYYMMDD: hasCreateDate ? formatDate(createDate, "YYYYMMDD") : "",
            create_date_YYYY_MM_DD: hasCreateDate ? formatDate(createDate, "YYYY-MM-DD") : "",
            now_YYYYMMDD_HHmmss: formatDate(now, "YYYYMMDD_HHmmss"),
            media,
        };
    }

    function buildFilename(media, config = {}) {
        const merged = { ...DEFAULT_CONFIG, ...config };
        const context = getFilenameContext(media);
        const value = renderFilenameTemplate(getFilenameTemplate(merged), context);
        return normalizeFilename(String(value), {
            maxLength: Number(merged.filename_max_length || DEFAULT_CONFIG.filename_max_length),
            preserveExtension: false,
        });
    }

    function buildVideoFilename(media = {}, config = {}, format = "mp4") {
        const merged = { ...DEFAULT_CONFIG, ...config };
        const base = buildFilename(media, config);
        const extension = normalizeFileExtension(format, "mp4");
        return normalizeFilename(extension ? `${base}.${extension}` : base, {
            maxLength: Number(merged.filename_max_length || DEFAULT_CONFIG.filename_max_length),
            preserveExtension: true,
        });
    }

    function buildImageFilename(media = {}, image = {}, index = 0, config = {}) {
        const merged = { ...DEFAULT_CONFIG, ...config };
        const base = buildFilename(media, merged);
        const url = String(image.url || "");
        const extension = normalizeFileExtension(
            url.match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i)?.[1],
            "jpg",
        );
        return normalizeFilename(`${base}_image${formatAlbumIndex(index, merged.album_index_format)}.${extension}`, {
            maxLength: Number(merged.filename_max_length || DEFAULT_CONFIG.filename_max_length),
            preserveExtension: true,
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
        const videoName = buildVideoFilename(media, merged, media.video?.format || "mp4");
        const filenameOptions = {
            maxLength: Number(merged.filename_max_length || DEFAULT_CONFIG.filename_max_length),
            preserveExtension: true,
        };
        const coverName = normalizeFilename(`${baseName}_cover.jpg`, filenameOptions);
        const dynamicName = normalizeFilename(`${baseName}_dynamic.webp`, filenameOptions);
        const musicName = normalizeFilename(`${baseName}_music.mp3`, filenameOptions);
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
            filename: buildImageFilename(media, image, index, merged),
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
        const username = safeDecodeURIComponent(match[1]).replace(/^@/, "").trim();
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
            return match ? safeDecodeURIComponent(match[1]).replace(/^@/, "") : "";
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
        const allowedKey = /^(?:memoizedProps|pendingProps|memoizedState|props|item|itemInfo|itemStruct|itemData|itemSnapshot|aweme|awemeInfo|data|children|child|content|videoData|videoInfo|photoData|photoInfo)$/i;

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
            const cached = id ? this.getCached(id) : null;
            let pageFragments = suppliedPageFragments;
            const trace = {
                capturedAt: new Date().toISOString(),
                targetId: id,
                permalink: identity?.permalink || "",
                identityEvidence: identity?.evidence || "",
                localFragmentCount: localFragments.length,
                pageFragmentCount: pageFragments.length,
                pageScanAttempted: false,
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
            const mergeFragments = () => this.enrichAuthorIdentity(
                mergeExactItemFragments(
                    [cached, ...localFragments, ...pageFragments].filter(Boolean),
                    id,
                ),
                identity,
            );
            const pageUrl = identity?.permalink || this.window?.location?.href || "";
            const isUsable = (item) => hasUsableRawMediaItem(item, pageUrl, config);

            if (!id) return finish({ ok: false, code: "current-item-id-not-found" });
            let merged = mergeFragments();
            if (!isUsable(merged) && !suppliedPageFragments.length) {
                trace.pageScanAttempted = true;
                pageFragments = this.collectPageFragments(id);
                trace.pageFragmentCount = pageFragments.length;
                merged = mergeFragments();
            }
            trace.merged = summarizeExactItem(merged, pageUrl, config);
            if (!isUsable(merged)) {
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

    function formatHttpErrorMessage(status, responseText = "") {
        const statusText = status || "error";
        const detail = String(responseText || "").trim();
        if (!detail || /^\s*</.test(detail)) return `HTTP ${statusText}`;
        return `HTTP ${statusText}: ${detail.slice(0, 500)}`;
    }

    function createRequestAbortError() {
        const error = new Error("Network request aborted");
        error.name = "AbortError";
        error.nonRetryable = true;
        return error;
    }

    function userscriptHttpRequest(options = {}) {
        const method = String(options.method || "GET").toUpperCase();
        const signal = options.signal;
        if (signal?.aborted) return Promise.reject(createRequestAbortError());
        if (typeof gmXmlHttpRequest === "function") {
            return new Promise((resolve, reject) => {
                let settled = false;
                let requestHandle = null;
                const finish = (callback, value) => {
                    if (settled) return;
                    settled = true;
                    signal?.removeEventListener?.("abort", onAbort);
                    callback(value);
                };
                const onAbort = () => {
                    requestHandle?.abort?.();
                    finish(reject, createRequestAbortError());
                };
                signal?.addEventListener?.("abort", onAbort, { once: true });
                requestHandle = gmXmlHttpRequest({
                    method,
                    url: options.url,
                    headers: options.headers || {},
                    data: options.data,
                    timeout: Number(options.timeout || 15000),
                    responseType: "text",
                    onload(response) {
                        const status = Number(response?.status || 0);
                        if (status >= 200 && status < 300) {
                            finish(resolve, {
                                status,
                                responseText: String(response?.responseText ?? response?.response ?? ""),
                                finalUrl: String(response?.finalUrl || options.url || ""),
                            });
                            return;
                        }
                        const responseText = String(response?.responseText ?? response?.response ?? "");
                        const error = new Error(formatHttpErrorMessage(status, responseText));
                        error.status = status;
                        error.responseText = responseText;
                        finish(reject, error);
                    },
                    onerror(error) {
                        finish(reject, error instanceof Error ? error : new Error("Network request failed"));
                    },
                    ontimeout() {
                        finish(reject, new Error("Network request timed out"));
                    },
                    onabort() {
                        finish(reject, createRequestAbortError());
                    },
                });
                if (signal?.aborted) onAbort();
            });
        }

        if (typeof root?.fetch !== "function") {
            return Promise.reject(new Error("No cross-origin request API is available"));
        }
        const AbortControllerCtor = root?.AbortController;
        const controller = typeof AbortControllerCtor === "function" ? new AbortControllerCtor() : null;
        let timedOut = false;
        let rejectTimeout;
        const onAbort = () => controller?.abort?.();
        signal?.addEventListener?.("abort", onAbort, { once: true });
        const timeoutPromise = new Promise((_resolve, reject) => {
            rejectTimeout = reject;
        });
        const timeoutId = root.setTimeout?.(() => {
            timedOut = true;
            controller?.abort?.();
            rejectTimeout?.(new Error("Network request timed out"));
        }, Number(options.timeout || 15000));
        const fetchPromise = root.fetch(options.url, {
            method,
            headers: options.headers || {},
            body: options.data,
            credentials: "include",
            signal: controller?.signal || signal,
        }).then(async (response) => {
            const responseText = await response.text();
            if (!response.ok) {
                const error = new Error(formatHttpErrorMessage(response.status, responseText));
                error.status = response.status;
                error.responseText = responseText;
                throw error;
            }
            return { status: response.status, responseText, finalUrl: response.url || options.url };
        });
        return Promise.race([fetchPromise, timeoutPromise]).catch((error) => {
            if (timedOut) throw new Error("Network request timed out");
            if (signal?.aborted || error?.name === "AbortError") throw createRequestAbortError();
            throw error;
        }).finally(() => {
            if (timeoutId !== undefined) root.clearTimeout?.(timeoutId);
            signal?.removeEventListener?.("abort", onAbort);
        });
    }

    function parseTranslationJson(responseText, providerName) {
        try {
            return JSON.parse(String(responseText || ""));
        } catch (_error) {
            throw new Error(`${providerName} returned invalid JSON`);
        }
    }

    function createTranslationResponseError(data, fallbackMessage) {
        const first = Array.isArray(data) ? data[0] : null;
        const captchaRequested = Boolean(data?.ShowCaptcha || first?.ShowCaptcha);
        const message = String(
            (captchaRequested ? "Translation service requested CAPTCHA" : "") ||
            data?.error?.message ||
            data?.errorMessage ||
            data?.message ||
            first?.error?.message ||
            first?.errorMessage ||
            first?.message ||
            fallbackMessage,
        ).trim();
        const error = new Error(message);
        const status = Number(
            data?.statusCode || data?.StatusCode || data?.status || data?.error?.code ||
            first?.statusCode || first?.StatusCode || first?.status || first?.error?.code || 0,
        );
        if (
            captchaRequested ||
            status === 429 ||
            /(?:\b429\b|rate.?limit|too many requests|quota|throttl|exceeded .*allowed translations)/i.test(message)
        ) {
            error.status = 429;
        } else if (status >= 400) {
            error.status = status;
        }
        return error;
    }

    function mapBingTranslationLanguage(language = "") {
        const value = String(language || "");
        if (value === "zh-CN") return "zh-Hans";
        if (value === "zh-TW") return "zh-Hant";
        return value;
    }

    function getBingTranslationResult(data) {
        const value = data?.data ?? data;
        const items = Array.isArray(value) ? value : [value];
        return items.find((item) => Array.isArray(item?.translations)) || items[0];
    }

    function generateGoogleTranslateToken(text = "") {
        const seed = 406644;
        const salt = 3293161072;
        const transform = (value, pattern) => {
            for (let index = 0; index < pattern.length - 2; index += 3) {
                const character = pattern.charAt(index + 2);
                const shift = character >= "a" ? character.charCodeAt(0) - 87 : Number(character);
                const shifted = pattern.charAt(index + 1) === "+" ? value >>> shift : value << shift;
                value = pattern.charAt(index) === "+"
                    ? (value + shifted) & 4294967295
                : value ^ shifted;
            }
            return value;
        };
        const bytes = Array.from(new TextEncoder().encode(String(text || "")));
        let value = seed;
        for (const byte of bytes) value = transform(value + byte, "+-a^+6");
        value = transform(value, "+-3^+b+-f") ^ salt;
        if (value < 0) value = (value & 2147483647) + 2147483648;
        value %= 1000000;
        return `${value}.${value ^ seed}`;
    }

    function createPackedTranslationBatch(texts = []) {
        const timePart = String(Date.now() % 10000000000).padStart(10, "0");
        const randomPart = Math.floor(Math.random() * 1000000000000)
        .toString()
        .padStart(12, "0");
        const nonce = `${timePart}${randomPart}`;
        const items = texts.map((text, index) => {
            const itemId = String(index).padStart(3, "0");
            return {
                startId: `${nonce}${itemId}1`,
                endId: `${nonce}${itemId}2`,
                text: String(text || ""),
            };
        });
        return {
            items,
            text: items.map((item) => (
                `${item.startId}\n` +
                `${item.text}\n` +
                `${item.endId}`
            )).join("\n\n"),
        };
    }

    function estimatePackedTranslationBatchLength(texts = []) {
        const boundaryIdLength = 10 + 12 + 3 + 1;
        const itemOverhead = boundaryIdLength * 2 + 2;
        return texts.reduce(
            (sum, text) => sum + String(text || "").length + itemOverhead,
            Math.max(0, texts.length - 1) * 2,
        );
    }

    function parsePackedTranslationBatch(translatedText = "", payload = {}) {
        const value = String(translatedText || "");
        const items = Array.isArray(payload.items) ? payload.items : [];
        if (!value || !items.length) return items.map(() => null);

        return items.map((item) => {
            const startPosition = value.indexOf(item.startId);
            if (startPosition < 0) return null;
            const start = startPosition + item.startId.length;
            const end = value.indexOf(item.endId, start);
            if (end < 0 || end <= start) return null;
            return value.slice(start, end).trim() || null;
        });
    }

    function normalizeTranslationComparisonText(text = "") {
        const value = String(text || "");
        return (typeof value.normalize === "function" ? value.normalize("NFKC") : value)
            .replace(/\s+/gu, " ")
            .trim();
    }

    function getTranslationClassificationText(text = "") {
        const value = String(text || "");
        const normalized = typeof value.normalize === "function" ? value.normalize("NFC") : value;
        return normalized
            .replace(/^(?:\[(?:贴纸|sticker|ステッカー|스티커)\]\s*)+/iu, "")
            .replace(/\b(?:https?:\/\/|www\.)\S+/giu, " ")
            .replace(/@[\p{L}\p{M}\p{N}_.-]+/gu, " ")
            .trim();
    }

    function isVietnameseLikeLatinText(text = "") {
        const value = String(text || "");
        const normalized = typeof value.normalize === "function" ? value.normalize("NFD") : value;
        return /[đĐ]/u.test(value) || /[\u031B\u0309\u0323]/u.test(normalized);
    }

    function classifyTranslationText(text = "") {
        const value = getTranslationClassificationText(text);
        const counts = { latin: 0, han: 0, kana: 0, hangul: 0, other: 0 };
        for (const character of value) {
            if (!/\p{L}/u.test(character)) continue;
            if (/\p{Script=Latin}/u.test(character)) counts.latin += 1;
            else if (/\p{Script=Han}/u.test(character)) counts.han += 1;
            else if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(character)) counts.kana += 1;
            else if (/\p{Script=Hangul}/u.test(character)) counts.hangul += 1;
            else counts.other += 1;
        }

        const total = counts.latin + counts.han + counts.kana + counts.hangul + counts.other;
        if (!total) return "neutral";
        if (counts.kana > 0 && counts.hangul === 0 && counts.other === 0) return "japanese";
        if (counts.hangul > 0 && counts.kana === 0 && counts.han === 0 && counts.other === 0) return "hangul";
        if (counts.han > 0 && counts.latin === 0 && counts.kana === 0 && counts.hangul === 0 && counts.other === 0) return "han";
        if (counts.latin > 0 && counts.han === 0 && counts.kana === 0 && counts.hangul === 0 && counts.other === 0) {
            return isVietnameseLikeLatinText(value) ? "vietnamese-like" : "latin";
        }
        if (counts.other === total) return "other";
        return "mixed";
    }

    function isBatchableTranslationBucket(bucket = "") {
        return ["latin", "vietnamese-like", "japanese", "hangul", "han"].includes(String(bucket || ""));
    }

    function normalizeTranslationLanguageCode(language = "") {
        const value = String(language || "").trim().toLowerCase().replace(/_/g, "-");
        if (!value) return "";
        if (value === "zh" || value.startsWith("zh-")) return "zh";
        return value.split("-")[0];
    }

    function translationLanguageMatchesTarget(detectedLanguage = "", targetLanguage = "") {
        const detected = normalizeTranslationLanguageCode(detectedLanguage);
        const target = normalizeTranslationLanguageCode(targetLanguage);
        return Boolean(detected && target && detected === target);
    }

    class TranslationProvider {
        constructor(request = userscriptHttpRequest) {
            this.request = request;
        }

        getBatchLimits() {
            return { maxItems: 20, maxPayloadChars: 5000 };
        }

        canTranslateText(text = "", _options = {}) {
            const maxPayloadChars = Math.max(1, Number(this.getBatchLimits().maxPayloadChars || 5000));
            const sourceText = String(text || "");
            return Boolean(sourceText && sourceText.length <= maxPayloadChars);
        }

        async translateBatch(texts = [], options = {}) {
            if (!texts.length) return [];
            const payload = createPackedTranslationBatch(texts);
            const result = await this.translateSingle(payload.text, options);
            const parsed = parsePackedTranslationBatch(result.text, payload);
            if (parsed.some((value) => value === null)) {
                const error = new Error("Translation batch boundaries could not be parsed");
                error.batchParseFailure = true;
                throw error;
            }
            return parsed;
        }

        async translateSingle(_text, _options = {}) {
            throw new Error("Translation provider is not implemented");
        }
    }

    class GoogleFreeTranslationProvider extends TranslationProvider {
        createRequestUrl(text = "", options = {}) {
            const sourceText = String(text || "");
            const url = new URL("https://translate.google.com/translate_a/single");
            url.searchParams.set("client", "t");
            url.searchParams.set("sl", options.source || "auto");
            url.searchParams.set("tl", options.target || DEFAULT_CONFIG.comment_translation_target);
            url.searchParams.set("hl", "en");
            for (const value of ["at", "bd", "ex", "ld", "md", "qca", "rw", "rm", "ss", "t"]) {
                url.searchParams.append("dt", value);
            }
            url.searchParams.set("ie", "UTF-8");
            url.searchParams.set("oe", "UTF-8");
            url.searchParams.set("otf", "1");
            url.searchParams.set("ssel", "0");
            url.searchParams.set("tsel", "0");
            url.searchParams.set("kc", "7");
            url.searchParams.set("q", sourceText);
            url.searchParams.set("tk", generateGoogleTranslateToken(sourceText));
            return url;
        }

        canTranslateText(text = "", options = {}) {
            const sourceText = String(text || "");
            if (!super.canTranslateText(sourceText, options)) return false;
            return this.createRequestUrl(sourceText, options).toString().length <= 8000;
        }

        async translateSingle(text = "", options = {}) {
            const sourceText = String(text || "").trim();
            if (!sourceText) return { text: "", detectedLanguage: "" };
            const url = this.createRequestUrl(sourceText, options);
            const response = await this.request({
                url: url.toString(),
                timeout: 18000,
                signal: options.signal,
            });
            const data = parseTranslationJson(response.responseText, "Google Translate");
            const translated = Array.isArray(data?.[0])
            ? data[0].map((item) => String(item?.[0] || "")).join("").trim()
            : "";
            if (!translated) {
                throw createTranslationResponseError(data, "Google Translate returned an empty result");
            }
            return { text: translated, detectedLanguage: String(data?.[2] || "") };
        }
    }

    class BingFreeTranslationProvider extends TranslationProvider {
        constructor(request = userscriptHttpRequest) {
            super(request);
            this.credentials = null;
            this.credentialsExpireAt = 0;
            this.credentialsPromise = null;
            this.requestSequence = 0;
        }

        getBatchLimits() {
            return { maxItems: 10, maxPayloadChars: 3000 };
        }

        async getCredentials(options = {}) {
            if (this.credentials && Date.now() < this.credentialsExpireAt) {
                return this.credentials;
            }
            if (this.credentialsPromise) return this.credentialsPromise;

            const loadPromise = (async () => {
                const response = await this.request({
                    url: "https://www.bing.com/translator",
                    timeout: 18000,
                    signal: options.signal,
                });
                const page = String(response.responseText || "");
                const tokenMatch = page.match(
                    /params_AbusePreventionHelper\s*=\s*\[\s*["']?(\d+)["']?\s*,\s*["']([^"']+)["'](?:\s*,\s*(\d+))?/,
                );
                const igMatch = page.match(/["']?IG["']?\s*:\s*["']([^"']+)["']/);
                const iidMatch = page.match(/data-iid\s*=\s*["']([^"']+)["']/i);
                if (!tokenMatch || !igMatch || !iidMatch) {
                    throw new Error("Bing Translator bootstrap data was not found");
                }
                const expiryMs = Math.max(60000, Number(tokenMatch[3]) || 15 * 60 * 1000);
                const tokenIssuedAt = Number(tokenMatch[1]);
                let origin = "https://www.bing.com";
                try {
                    const finalUrl = new URL(response.finalUrl || origin);
                    if (finalUrl.hostname === "bing.com" || finalUrl.hostname.endsWith(".bing.com")) {
                        origin = finalUrl.origin;
                    }
                } catch (_error) {}
                this.credentials = {
                    key: tokenMatch[1],
                    token: tokenMatch[2],
                    ig: igMatch[1],
                    iid: iidMatch[1],
                    origin,
                };
                this.credentialsExpireAt =
                    (Number.isFinite(tokenIssuedAt) && tokenIssuedAt > 0 ? tokenIssuedAt : Date.now()) +
                    Math.max(30000, expiryMs - 30000);
                return this.credentials;
            })();
            this.credentialsPromise = loadPromise;
            try {
                return await loadPromise;
            } finally {
                if (this.credentialsPromise === loadPromise) this.credentialsPromise = null;
            }
        }

        createRequestUrl(credentials, useEPT = true) {
            const url = new URL("/ttranslatev3", credentials.origin || "https://www.bing.com");
            url.searchParams.set("isVertical", "1");
            url.searchParams.set("IG", credentials.ig);
            url.searchParams.set("IID", credentials.iid);
            if (useEPT) {
                url.searchParams.set("SFX", String(++this.requestSequence));
                url.searchParams.set("ref", "TThis");
                url.searchParams.set("edgepdftranslator", "1");
            }
            return url;
        }

        async requestTranslationText(text = "", options = {}) {
            const sourceText = String(text || "").trim();
            if (!sourceText) return { text: "", detectedLanguage: "" };
            const credentials = await this.getCredentials(options);
            const target = mapBingTranslationLanguage(
                options.target || DEFAULT_CONFIG.comment_translation_target,
            );
            const source = options.source === "auto"
            ? "auto-detect"
            : mapBingTranslationLanguage(options.source || "auto-detect");
            const useEPT = sourceText.length <= 3000 && [source, target].every((language) => (
                language === "auto-detect" || COMMENT_TRANSLATION_TARGETS.some(([value]) => (
                    mapBingTranslationLanguage(value) === language
                ))
            ));
            const url = this.createRequestUrl(credentials, useEPT);
            const body = new URLSearchParams({
                fromLang: source,
                text: sourceText,
                to: target,
                token: credentials.token,
                key: credentials.key,
            });
            let response;
            try {
                response = await this.request({
                    method: "POST",
                    url: url.toString(),
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                        Referer: `${credentials.origin || "https://www.bing.com"}/translator`,
                    },
                    data: body.toString(),
                    timeout: 18000,
                    signal: options.signal,
                });
            } catch (error) {
                if ([401, 403].includes(Number(error?.status || 0))) {
                    this.credentials = null;
                    this.credentialsExpireAt = 0;
                }
                if (Number(error?.status || 0) === 401) {
                    error.status = 429;
                    error.stopTranslation = true;
                }
                throw error;
            }
            const data = parseTranslationJson(response.responseText, "Bing Translator");
            const result = getBingTranslationResult(data);
            const translated = String(result?.translations?.[0]?.text || "");
            const detectedLanguage = String(result?.detectedLanguage?.language || "");
            if (!translated) {
                if (translationLanguageMatchesTarget(detectedLanguage, target)) {
                    return { text: sourceText, detectedLanguage };
                }
                const error = createTranslationResponseError(
                    result || data,
                    "Bing Translator returned an empty result",
                );
                if (Number(error.status || 0) === 401) {
                    this.credentials = null;
                    this.credentialsExpireAt = 0;
                    error.status = 429;
                }
                if (Number(error.status || 0) === 429) error.stopTranslation = true;
                throw error;
            }
            return { text: translated, detectedLanguage };
        }

        async translateSingle(text = "", options = {}) {
            return this.requestTranslationText(text, options);
        }
    }

    const TRANSLATION_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
    const TRANSLATION_UNTRANSLATED_CACHE_TTL_MS = 5 * 60 * 1000;

    class TranslationService {
        constructor(request = userscriptHttpRequest) {
            this.providerFactories = new Map();
            this.providers = new Map();
            this.cache = new Map();
            this.confirmedSameCache = new Map();
            this.untranslatedCache = new Map();
            this.inFlight = new Map();
            this.registerProvider("google", () => new GoogleFreeTranslationProvider(request));
            this.registerProvider("bing", () => new BingFreeTranslationProvider(request));
        }

        registerProvider(name, factory) {
            this.providerFactories.set(String(name), factory);
            this.providers.delete(String(name));
        }

        getProvider(name) {
            const key = String(name || DEFAULT_CONFIG.comment_translation_provider);
            if (!this.providerFactories.has(key)) throw new Error(`Unknown translation provider: ${key}`);
            if (!this.providers.has(key)) this.providers.set(key, this.providerFactories.get(key)());
            return this.providers.get(key);
        }

        getBatchLimits(providerName = "") {
            return this.getProvider(providerName).getBatchLimits();
        }

        canTranslateBatch(providerName = "", texts = [], options = {}) {
            const provider = this.getProvider(providerName);
            const limits = provider.getBatchLimits();
            const maxItems = Math.max(1, Number(limits.maxItems || 20));
            const packedText = createPackedTranslationBatch(texts).text;
            const withinProviderLimit = typeof provider.canTranslateText === "function"
            ? provider.canTranslateText(packedText, options)
            : packedText.length <= Math.max(1, Number(limits.maxPayloadChars || 5000));
            return (
                texts.length > 0 &&
                texts.length <= maxItems &&
                estimatePackedTranslationBatchLength(texts) <= Math.max(1, Number(limits.maxPayloadChars || 5000)) &&
                withinProviderLimit
            );
        }

        canTranslateSingle(providerName = "", text = "", options = {}) {
            const provider = this.getProvider(providerName);
            if (typeof provider.canTranslateText === "function") {
                return provider.canTranslateText(text, options);
            }
            const maxPayloadChars = Math.max(1, Number(provider.getBatchLimits().maxPayloadChars || 5000));
            const sourceText = String(text || "");
            return Boolean(sourceText && sourceText.length <= maxPayloadChars);
        }

        getCacheKey(providerName, target, sourceText) {
            return `${providerName}\n${target}\n${sourceText}`;
        }

        getCachedResult(store, cacheKey) {
            const entry = store.get(cacheKey);
            if (!entry) return undefined;
            if (entry.expiresAt <= Date.now()) {
                store.delete(cacheKey);
                return undefined;
            }
            store.delete(cacheKey);
            store.set(cacheKey, entry);
            return entry.value;
        }

        setCacheEntry(store, cacheKey, value, ttlMs) {
            store.delete(cacheKey);
            store.set(cacheKey, { value, expiresAt: Date.now() + ttlMs });
            if (store.size > 1200) store.delete(store.keys().next().value);
            return value;
        }

        setCachedResult(cacheKey, result) {
            return this.setCacheEntry(this.cache, cacheKey, result, TRANSLATION_CACHE_TTL_MS);
        }

        setConfirmedSame(cacheKey, result) {
            return this.setCacheEntry(this.confirmedSameCache, cacheKey, result, TRANSLATION_CACHE_TTL_MS);
        }

        setUntranslated(cacheKey, result) {
            return this.setCacheEntry(
                this.untranslatedCache,
                cacheKey,
                result,
                TRANSLATION_UNTRANSLATED_CACHE_TTL_MS,
            );
        }

        getCachedTranslation(cacheKey) {
            return this.getCachedResult(this.cache, cacheKey);
        }

        getConfirmedSame(cacheKey) {
            return this.getCachedResult(this.confirmedSameCache, cacheKey);
        }

        getUntranslated(cacheKey) {
            return this.getCachedResult(this.untranslatedCache, cacheKey);
        }

        async translateBatch(texts = [], options = {}) {
            const providerName = String(options.provider || DEFAULT_CONFIG.comment_translation_provider);
            const target = String(options.target || DEFAULT_CONFIG.comment_translation_target);
            const sourceTexts = texts.map((text) => String(text || "").trim());
            const results = new Array(sourceTexts.length).fill(null);
            const uniqueEntries = new Map();

            sourceTexts.forEach((sourceText, index) => {
                if (!sourceText) return;
                const cacheKey = this.getCacheKey(providerName, target, sourceText);
                let entry = uniqueEntries.get(cacheKey);
                if (!entry) {
                    entry = { cacheKey, sourceText, indices: [] };
                    uniqueEntries.set(cacheKey, entry);
                }
                entry.indices.push(index);
            });

            const freshEntries = [];
            const assignResult = (entry, result) => {
                for (const index of entry.indices) results[index] = result;
            };

            for (const entry of uniqueEntries.values()) {
                const cached = this.getCachedTranslation(entry.cacheKey);
                const confirmedSame = this.getConfirmedSame(entry.cacheKey);
                const untranslated = this.getUntranslated(entry.cacheKey);
                if (cached !== undefined) {
                    assignResult(entry, cached);
                } else if (confirmedSame !== undefined) {
                    assignResult(entry, entry.sourceText);
                } else if (untranslated !== undefined) {
                    assignResult(entry, null);
                } else {
                    freshEntries.push(entry);
                }
            }

            if (freshEntries.length) {
                if (!this.canTranslateBatch(
                    providerName,
                    freshEntries.map((entry) => entry.sourceText),
                    { source: "auto", target },
                )) {
                    throw new Error("Translation batch exceeds provider limits");
                }
                const batchResults = await this.getProvider(providerName).translateBatch(
                    freshEntries.map((entry) => entry.sourceText),
                    { source: "auto", target, signal: options.signal },
                );
                if (!Array.isArray(batchResults) || batchResults.length !== freshEntries.length) {
                    throw new Error("Translation provider returned an invalid batch size");
                }
                freshEntries.forEach((entry, index) => {
                    const value = typeof batchResults[index] === "string"
                    ? batchResults[index].trim()
                    : "";
                    if (
                        !value ||
                        normalizeTranslationComparisonText(value) ===
                        normalizeTranslationComparisonText(entry.sourceText)
                    ) {
                        this.setUntranslated(entry.cacheKey, {
                            status: "untranslated",
                            text: entry.sourceText,
                            detectedLanguage: "",
                            fromCache: false,
                            reason: value ? "source-returned-unchanged" : "batch-item-empty",
                        });
                        return;
                    }
                    assignResult(entry, this.setCachedResult(entry.cacheKey, value));
                });
            }

            return results;
        }

        async translateSingle(text = "", options = {}) {
            const providerName = String(options.provider || DEFAULT_CONFIG.comment_translation_provider);
            const target = String(options.target || DEFAULT_CONFIG.comment_translation_target);
            const sourceText = String(text || "").trim();
            if (!sourceText) return { status: "unchanged", text: "", detectedLanguage: "", fromCache: true };
            if (!this.canTranslateSingle(providerName, sourceText, { source: "auto", target })) {
                throw new Error("Translation text exceeds provider limits");
            }

            const cacheKey = this.getCacheKey(providerName, target, sourceText);
            const cached = this.getCachedTranslation(cacheKey);
            if (cached !== undefined) {
                return { status: "translated", text: cached, detectedLanguage: "", fromCache: true };
            }
            const confirmedSame = this.getConfirmedSame(cacheKey);
            if (confirmedSame !== undefined) return { ...confirmedSame, fromCache: true };
            const untranslated = this.getUntranslated(cacheKey);
            if (untranslated !== undefined) return { ...untranslated, fromCache: true };
            const inFlightEntry = this.inFlight.get(cacheKey);
            if (inFlightEntry) {
                if (!inFlightEntry.signal?.aborted) return inFlightEntry.promise;
                this.inFlight.delete(cacheKey);
            }

            const pending = (async () => {
                const result = await this.getProvider(providerName).translateSingle(
                    sourceText,
                    { source: "auto", target, signal: options.signal },
                );
                const translated = String(result?.text || "").trim();
                const detectedLanguage = String(result?.detectedLanguage || "");
                if (!translated) throw new Error("Translation provider returned an empty single result");
                if (
                    normalizeTranslationComparisonText(translated) !==
                    normalizeTranslationComparisonText(sourceText)
                ) {
                    this.setCachedResult(cacheKey, translated);
                    return { status: "translated", text: translated, detectedLanguage, fromCache: false };
                }
                if (translationLanguageMatchesTarget(detectedLanguage, target)) {
                    return this.setConfirmedSame(cacheKey, {
                        status: "unchanged",
                        text: sourceText,
                        detectedLanguage,
                        fromCache: false,
                    });
                }

                return this.setUntranslated(cacheKey, {
                    status: "untranslated",
                    text: sourceText,
                    detectedLanguage,
                    fromCache: false,
                    reason: "source-returned-unchanged",
                });
            })();
            const pendingEntry = { promise: pending, signal: options.signal };
            this.inFlight.set(cacheKey, pendingEntry);
            try {
                return await pending;
            } finally {
                if (this.inFlight.get(cacheKey) === pendingEntry) this.inFlight.delete(cacheKey);
            }
        }
    }

    const COMMENT_TEXT_SELECTOR = '[data-e2e="comment-level-1"], [data-e2e="comment-level-2"]';
    const MAX_SCRIPT_TRANSLATION_BATCH_ITEMS = 10;
    const COMMENT_TRANSLATION_RETRY_DELAY_MS = 30000;
    const COMMENT_TRANSLATION_MAX_ATTEMPTS = 3;

    class CommentTranslationController {
        constructor(app, service = new TranslationService()) {
            this.app = app;
            this.window = app.window;
            this.document = app.document;
            this.service = service;
            this.enabled = false;
            this.displayMode = "original";
            this.records = new WeakMap();
            this.queue = [];
            this.batchInFlight = false;
            this.activeBatches = new Set();
            this.generation = 0;
            this.observer = null;
            this.observerRoot = null;
            this.discoveryObserver = null;
            this.discoveryRoot = null;
            this.scanTimer = null;
            this.button = null;
            this.buttonHost = null;
            this.buttonTooltip = null;
            this.currentVideoKey = null;
            this.mediaElementKeys = new WeakMap();
            this.mediaElementIdentities = new WeakMap();
            this.nextMediaElementKey = 1;
            this.lastErrorToastAt = 0;
            this.retryTimer = null;
            this.retryAt = 0;
        }

        start() {
            if (this.app.configStore.get().comment_translation_auto_open === "auto") {
                this.enabled = true;
                this.displayMode = "translated";
            }
            this.scheduleScan(0);
            this.syncMutationObservers(null);
        }

        disconnectMutationObservers() {
            this.observer?.disconnect?.();
            this.discoveryObserver?.disconnect?.();
            this.observer = null;
            this.observerRoot = null;
            this.discoveryObserver = null;
            this.discoveryRoot = null;
        }

        syncMutationObservers(panelRoot = null) {
            const MutationObserverCtor = this.window.MutationObserver;
            const body = this.document.body;
            if (typeof MutationObserverCtor !== "function" || !body) return;

            const nextRoot = panelRoot?.isConnected ? panelRoot : null;
            const nextDiscoveryRoot = nextRoot?.parentElement || (!nextRoot ? body : null);
            if (this.observerRoot === nextRoot && this.discoveryRoot === nextDiscoveryRoot) return;

            this.disconnectMutationObservers();

            if (nextRoot) {
                this.observerRoot = nextRoot;
                this.observer = new MutationObserverCtor((records) => {
                    if (records.some((record) => (
                        record.type === "characterData" ||
                        (record.type === "childList" && (record.addedNodes.length || record.removedNodes.length))
                    ))) {
                        this.scheduleScan(80);
                    }
                });
                this.observer.observe(nextRoot, { childList: true, characterData: true, subtree: true });

                if (nextDiscoveryRoot) {
                    this.discoveryRoot = nextDiscoveryRoot;
                    this.discoveryObserver = new MutationObserverCtor((records) => {
                        if (records.some((record) => record.type === "childList" && (record.addedNodes.length || record.removedNodes.length))) {
                            this.scheduleScan(80);
                        }
                    });
                    this.discoveryObserver.observe(nextDiscoveryRoot, { childList: true, subtree: false });
                }
                return;
            }

            this.discoveryRoot = body;
            this.discoveryObserver = new MutationObserverCtor((records) => {
                if (records.some((record) => record.type === "childList" && (record.addedNodes.length || record.removedNodes.length))) {
                    this.scheduleScan(80);
                }
            });
            this.discoveryObserver.observe(body, { childList: true, subtree: true });
        }

        scheduleScan(delay = 80) {
            if (this.scanTimer !== null) return;
            this.scanTimer = this.window.setTimeout?.(() => {
                this.scanTimer = null;
                this.scan();
            }, delay) || null;
        }

        isRendered(element) {
            if (!element?.isConnected) return false;
            const style = this.window.getComputedStyle?.(element);
            if (style?.display === "none" || style?.visibility === "hidden") return false;
            const rect = element.getBoundingClientRect?.();
            return !rect || (rect.width > 0 && rect.height > 0);
        }

        getCommentElements() {
            if (/\/live(?:\/|$)/i.test(this.window.location?.pathname || "")) return [];
            return Array.from(this.document.querySelectorAll(COMMENT_TEXT_SELECTOR)).filter((element) => {
                const hiddenByTranslation = element.classList.contains(
                    `${SCRIPT_PREFIX}-comment-original-hidden`,
                );
                if (!hiddenByTranslation && !this.isRendered(element)) return false;
                if (hiddenByTranslation) {
                    const record = this.records.get(element);
                    if (!record?.translated) {
                        element.classList.remove(`${SCRIPT_PREFIX}-comment-original-hidden`);
                        if (!this.isRendered(element)) return false;
                    }
                }
                if (element.closest?.('[data-e2e*="live-chat"], [data-e2e*="live-room"], [class*="LiveChat"], [class*="ChatRoom"]')) return false;
                return true;
            });
        }

        getPanelContext(commentElements = []) {
            const profilePanel = Array.from(
                this.document.querySelectorAll('[data-e2e="search-comment-container"]'),
            ).find((element) => this.isRendered(element)) || null;
            if (profilePanel) {
                const profileComment = commentElements.find((element) => profilePanel.contains?.(element)) || null;
                let profileList =
                    profileComment?.closest?.('[data-e2e="comment-list"], [class*="DivCommentListContainer"], [class*="CommentListContainer"]') ||
                    profilePanel.querySelector?.('[data-e2e="comment-list"], [class*="DivCommentListContainer"], [class*="CommentListContainer"]') ||
                    null;
                if (!profileList && profileComment) {
                    let candidate = profileComment.parentElement;
                    for (let depth = 0; candidate && candidate !== profilePanel && depth < 8; depth += 1) {
                        if (candidate.querySelectorAll?.(COMMENT_TEXT_SELECTOR).length >= 2) {
                            profileList = candidate;
                            break;
                        }
                        candidate = candidate.parentElement;
                    }
                }
                return {
                    list: profileList || profilePanel,
                    root: profilePanel,
                    placement: "profile",
                };
            }

            const cinemaPanel = Array.from(
                this.document.querySelectorAll('[aria-label="cinema-side-panel-comment-panel"]'),
            ).find((element) => this.isRendered(element)) || null;
            if (cinemaPanel) {
                return {
                    list: cinemaPanel,
                    root: cinemaPanel.parentElement || cinemaPanel,
                    placement: "title",
                };
            }

            const first = commentElements.find((element) => this.isRendered(element)) || null;
            const list =
                  first?.closest?.('[data-e2e="comment-list"], [class*="DivCommentListContainer"]') ||
                  Array.from(this.document.querySelectorAll('[data-e2e="comment-list"]')).find((element) => this.isRendered(element)) ||
                  null;
            let rootElement =
                first?.closest?.('section, [role="complementary"], aside, [class*="CommentSidebarContainer"], [class*="DivCommentContainer"]') ||
                list?.parentElement ||
                null;
            if (!rootElement && first) {
                rootElement = first.parentElement;
                const wantedCount = Math.min(2, commentElements.length);
                for (let depth = 0; rootElement && depth < 8; depth += 1) {
                    if (rootElement.querySelectorAll?.(COMMENT_TEXT_SELECTOR).length >= wantedCount) break;
                    rootElement = rootElement.parentElement;
                }
            }
            return { list: list || rootElement, root: rootElement || list, placement: "title" };
        }

        getCommentInput(context = null) {
            const selector = '[data-e2e="comment-input"]';
            const scoped = context?.root?.querySelectorAll?.(selector) || [];
            const candidates = scoped.length ? Array.from(scoped) : Array.from(this.document.querySelectorAll(selector));
            return candidates.find((element) => (
                this.isRendered(element) &&
                !element.closest?.('[data-e2e*="live-chat"], [data-e2e*="live-room"], [class*="LiveChat"], [class*="ChatRoom"]')
            )) || null;
        }

        getCommentActionRow(commentInput) {
            const mentionButton = commentInput?.querySelector?.('[data-e2e="comment-at-icon"]');
            const emojiButton = commentInput?.querySelector?.('[data-e2e="comment-emoji-icon"]');
            if (!mentionButton || !emojiButton) return null;
            let candidate = emojiButton.parentElement;
            while (candidate && candidate !== commentInput) {
                if (candidate.contains?.(mentionButton) && candidate.contains?.(emojiButton)) return candidate;
                candidate = candidate.parentElement;
            }
            return null;
        }

        getCommentLoginRow(context = null) {
            const selector = ".comment-login-bar";
            const scoped = context?.root?.querySelectorAll?.(selector) || [];
            const candidates = scoped.length ? Array.from(scoped) : Array.from(this.document.querySelectorAll(selector));
            const loginBar = candidates.find((element) => (
                this.isRendered(element) &&
                !element.closest?.('[data-e2e*="live-chat"], [data-e2e*="live-room"], [class*="LiveChat"], [class*="ChatRoom"]')
            )) || null;
            const loginButton = loginBar?.parentElement || null;
            const loginWrapper = loginButton?.parentElement || null;
            return loginWrapper && this.isRendered(loginWrapper) ? loginWrapper : null;
        }

        getCurrentVideoKey() {
            const pathname = String(this.window.location?.pathname || "");
            const mediaMatch = pathname.match(/\/(?:video|photo)\/(\d+)/i);
            if (mediaMatch) return `media:${mediaMatch[1]}`;

            const visibleMedia = this.app.extractor?.getVisibleMediaElement?.() || null;
            const stableElement =
                  this.app.extractor?.getMediaContextElement?.(visibleMedia) ||
                  visibleMedia;
            const visibleUrl = this.app.extractor?.getVisibleMediaContextUrls?.(visibleMedia)?.[0] || "";
            const visibleId = getVideoIdFromUrl(visibleUrl);

            if (stableElement) {
                let identity = this.mediaElementIdentities.get(stableElement);
                if (!identity) {
                    let elementKey = this.mediaElementKeys.get(stableElement);
                    if (!elementKey) {
                        elementKey = this.nextMediaElementKey;
                        this.nextMediaElementKey += 1;
                        this.mediaElementKeys.set(stableElement, elementKey);
                    }
                    identity = {
                        key: visibleId ? `media:${visibleId}` : `media-element:${pathname}:${elementKey}`,
                        mediaId: visibleId || "",
                    };
                    this.mediaElementIdentities.set(stableElement, identity);
                    return identity.key;
                }

                if (visibleId && identity.mediaId && visibleId !== identity.mediaId) {
                    identity = { key: `media:${visibleId}`, mediaId: visibleId };
                    this.mediaElementIdentities.set(stableElement, identity);
                    return identity.key;
                }
                if (visibleId && !identity.mediaId) identity.mediaId = visibleId;
                return identity.key;
            }
            return visibleId ? `media:${visibleId}` : null;
        }

        resetForVideo(nextVideoKey) {
            this.abortActiveRequests();
            this.generation += 1;
            this.queue.length = 0;
            this.clearRetryTimer();
            for (const element of this.document.querySelectorAll(COMMENT_TEXT_SELECTOR)) {
                const record = this.records.get(element);
                record?.translatedElement?.remove?.();
                element.classList.remove(`${SCRIPT_PREFIX}-comment-original-hidden`);
            }
            this.records = new WeakMap();
            const autoOpen = this.app.configStore.get().comment_translation_auto_open === "auto";
            this.enabled = autoOpen;
            this.displayMode = autoOpen ? "translated" : "original";
            this.currentVideoKey = nextVideoKey;
            this.updateButton();
        }

        createTranslationIcon() {
            const svg = this.document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.setAttribute("fill", "none");
            svg.setAttribute("stroke", "currentColor");
            svg.setAttribute("stroke-width", "1.8");
            svg.setAttribute("stroke-linecap", "round");
            svg.setAttribute("stroke-linejoin", "round");
            svg.setAttribute("viewBox", "0 0 24 24");
            svg.setAttribute("width", "1em");
            svg.setAttribute("height", "1em");
            svg.setAttribute("aria-hidden", "true");
            const circle = this.document.createElementNS("http://www.w3.org/2000/svg", "circle");
            circle.setAttribute("cx", "12");
            circle.setAttribute("cy", "12");
            circle.setAttribute("r", "10.25");
            const glyph = this.document.createElementNS("http://www.w3.org/2000/svg", "g");
            glyph.setAttribute("transform", "translate(3.6 3.6) scale(0.7)");
            [
                "m5 8 6 6",
                "m4 14 6-6 2-3",
                "M2 5h12",
                "M7 2h1",
                "m22 22-5-10-5 10",
                "M14 18h6",
            ].forEach((pathData) => {
                const path = this.document.createElementNS("http://www.w3.org/2000/svg", "path");
                path.setAttribute("d", pathData);
                path.setAttribute("vector-effect", "non-scaling-stroke");
                glyph.appendChild(path);
            });
            svg.append(circle, glyph);
            return svg;
        }

        mountButton(commentElements = [], suppliedContext = null) {
            const context = suppliedContext || this.getPanelContext(commentElements);
            const commentInput = this.getCommentInput(context);
            const inputActionRow = this.getCommentActionRow(commentInput);
            const actionRow = inputActionRow || this.getCommentLoginRow(context);
            const placement = inputActionRow ? "input" : "login";
            if (!actionRow) {
                this.buttonHost?.parentElement?.classList?.remove?.(`${SCRIPT_PREFIX}-comment-login-row`);
                this.buttonHost?.remove?.();
                this.button = null;
                this.buttonHost = null;
                this.buttonTooltip = null;
                return;
            }
            if (
                !this.button?.isConnected ||
                !this.buttonHost?.isConnected ||
                this.buttonHost.parentElement !== actionRow ||
                this.buttonHost.dataset.placement !== placement
            ) {
                this.buttonHost?.parentElement?.classList?.remove?.(`${SCRIPT_PREFIX}-comment-login-row`);
                this.buttonHost?.remove?.();
                const host = createElement(
                    this.document,
                    "div",
                    `TUXTooltip-reference ${SCRIPT_PREFIX}-comment-translation-host`,
                );
                host.dataset.placement = placement;
                if (placement === "login") actionRow.classList?.add?.(`${SCRIPT_PREFIX}-comment-login-row`);
                const referenceButton = commentInput?.querySelector?.('[data-e2e="comment-emoji-icon"]');
                const colorScheme = (referenceButton || actionRow)
                ?.closest?.('[data-tux-color-scheme]')
                ?.getAttribute?.("data-tux-color-scheme");
                if (colorScheme) host.setAttribute("data-tux-color-scheme", colorScheme);
                const referenceClasses = String(referenceButton?.className || "").trim();
                const button = createElement(
                    this.document,
                    "button",
                    `${referenceClasses || "TUXButton TUXButton--default TUXButton--medium TUXButton--secondary"} ${SCRIPT_PREFIX}-comment-translate-button`,
                );
                button.type = "button";
                button.dataset.e2e = `${SCRIPT_PREFIX}-comment-translate-icon`;
                button.setAttribute("aria-disabled", "false");
                button.setAttribute("aria-expanded", "false");
                button.tabIndex = 0;
                const content = createElement(this.document, "div", "TUXButton-content");
                const iconContainer = createElement(this.document, "div", "TUXButton-iconContainer");
                iconContainer.appendChild(this.createTranslationIcon());
                content.appendChild(iconContainer);
                button.appendChild(content);
                button.addEventListener("click", (event) => {
                    event.preventDefault();
                    event.stopPropagation();



                    host.dataset.tooltipSuppressed = "true";
                    button.blur?.();
                    this.toggleDisplay();
                });
                host.addEventListener("pointerleave", () => {
                    delete host.dataset.tooltipSuppressed;
                });
                host.appendChild(button);
                const tooltip = createElement(
                    this.document,
                    "div",
                    `${SCRIPT_PREFIX}-comment-translation-tooltip`,
                );
                tooltip.id = `${SCRIPT_PREFIX}-comment-translation-tooltip`;
                tooltip.setAttribute("role", "tooltip");
                button.setAttribute("aria-describedby", tooltip.id);
                host.appendChild(tooltip);
                actionRow.appendChild(host);
                this.buttonHost = host;
                this.button = button;
                this.buttonTooltip = tooltip;
            }
            this.updateButton();
        }

        updateButton() {
            if (!this.button) return;
            const busy = this.enabled && this.displayMode === "translated" && (this.batchInFlight || this.queue.length > 0);
            const comparison = this.app.configStore.get().comment_translation_display_mode === "comparison";
            const label = !this.enabled
            ? this.app.t("translate_comments")
            : busy
            ? this.app.t("translating_comments")
            : this.displayMode === "translated"
            ? this.app.t(comparison ? "hide_translated_comments" : "show_original_comments")
            : this.app.t("show_translated_comments");
            this.button.setAttribute("aria-label", label);
            if (this.buttonTooltip && this.buttonTooltip.textContent !== label) this.buttonTooltip.textContent = label;
            this.button.dataset.state = busy ? "busy" : this.displayMode;
            this.button.setAttribute("aria-pressed", String(this.enabled && this.displayMode === "translated"));
        }

        stop() {
            this.enabled = false;
            this.displayMode = "original";
            this.abortActiveRequests();
            this.clearRetryTimer();
            for (const task of this.queue) {
                if (task.record.status === "pending") task.record.status = "idle";
            }
            this.queue.length = 0;
        }

        toggleDisplay() {
            if (!this.enabled) {
                this.enabled = true;
                this.displayMode = "translated";
            } else {
                this.stop();
            }
            this.applyDisplayMode();
            this.updateButton();
            this.scan();
        }
        getTranslationSourceText(text = "") {
            const value = String(text || "").trim();
            return value
                .replace(/^(?:\[(?:贴纸|sticker|ステッカー|스티커)\]\s*)+/iu, "")
                .trim();
        }

        normalizeTranslationComparison(text = "") {
            return normalizeTranslationComparisonText(text);
        }

        getCommentText(element) {
            const nodes = Array.from(element?.childNodes || []);
            if (!nodes.length) return String(element?.textContent || "").trim();

            const inlineTags = new Set(["SPAN", "A", "STRONG", "EM", "B", "I", "S", "U"]);
            const isExcludedElement = (node) => Boolean(
                node?.matches?.(COMMENT_TEXT_SELECTOR) ||
                node?.querySelector?.(COMMENT_TEXT_SELECTOR) ||
                node?.matches?.('button, [role="button"], svg, [aria-hidden="true"]') ||
                node?.querySelector?.('button, [role="button"]')
            );

            const parts = [];
            const safeContainers = [];
            for (const node of nodes) {
                if (node?.nodeType === 3) {
                    parts.push(String(node.textContent || ""));
                    continue;
                }
                if (node?.nodeType !== 1 || isExcludedElement(node)) continue;
                if (inlineTags.has(String(node.tagName || "").toUpperCase())) {
                    parts.push(String(node.textContent || ""));
                } else {
                    safeContainers.push(node);
                }
            }
            const directText = parts.join("").trim();
            if (directText) return directText;
            if (safeContainers.length === 1) return String(safeContainers[0]?.textContent || "").trim();
            return "";
        }

        clearRetryTimer() {
            if (this.retryTimer !== null) this.window.clearTimeout?.(this.retryTimer);
            this.retryTimer = null;
            this.retryAt = 0;
        }

        scheduleRetry(delayMs = COMMENT_TRANSLATION_RETRY_DELAY_MS) {
            if (!this.enabled) return;
            const runAt = Date.now() + Math.max(0, Number(delayMs) || 0);
            if (this.retryTimer !== null && this.retryAt && this.retryAt <= runAt) return;
            this.clearRetryTimer();
            this.retryAt = runAt;
            this.retryTimer = this.window.setTimeout?.(() => {
                this.retryTimer = null;
                this.retryAt = 0;
                if (this.enabled) this.scan();
            }, Math.max(0, runAt - Date.now())) ?? null;
        }

        getRecord(element) {
            const currentText = this.getCommentText(element);
            let record = this.records.get(element);
            if (record && record.original === currentText) return record;
            record?.translatedElement?.remove?.();
            record = {
                original: currentText,
                translated: "",
                translatedElement: null,
                status: "idle",
                failedAt: 0,
                failureCount: 0,
            };
            this.records.set(element, record);
            return record;
        }

        getTranslationBucket(text = "") {
            return classifyTranslationText(this.getTranslationSourceText(text));
        }

        isTranslatableText(text = "") {
            return this.getTranslationBucket(text) !== "neutral";
        }

        renderRecord(element, record) {
            if (!record.translated) return;
            if (!record.translatedElement?.isConnected) {
                const translatedElement = createElement(
                    this.document,
                    "span",
                    `${SCRIPT_PREFIX}-comment-translation-text`,
                    record.translated,
                );
                element.insertAdjacentElement?.("afterend", translatedElement);
                record.translatedElement = translatedElement;
            } else if (record.translatedElement.textContent !== record.translated) {
                record.translatedElement.textContent = record.translated;
            }
            const showTranslation = this.enabled && this.displayMode === "translated";
            const replaceOriginal =
                  showTranslation && this.app.configStore.get().comment_translation_display_mode === "replace";
            element.classList.toggle(`${SCRIPT_PREFIX}-comment-original-hidden`, replaceOriginal);
            record.translatedElement.hidden = !showTranslation;
        }

        applyDisplayMode() {
            const showTranslation = this.enabled && this.displayMode === "translated";
            const replaceOriginal =
                  showTranslation && this.app.configStore.get().comment_translation_display_mode === "replace";
            for (const element of this.getCommentElements()) {
                const record = this.records.get(element);
                if (!record?.translatedElement) continue;
                element.classList.toggle(`${SCRIPT_PREFIX}-comment-original-hidden`, replaceOriginal);
                record.translatedElement.hidden = !showTranslation;
            }
        }

        enqueue(element, record, config) {
            if (["pending", "blocked", "unchanged", "untranslated"].includes(record.status)) return;
            if (record.status === "failed") {
                const remaining = COMMENT_TRANSLATION_RETRY_DELAY_MS - (Date.now() - record.failedAt);
                if (remaining > 0) {
                    this.scheduleRetry(remaining);
                    return;
                }
            }

            const sourceText = this.getTranslationSourceText(record.original);
            if (!sourceText) return;
            const bucket = classifyTranslationText(sourceText);
            if (bucket === "neutral") {
                record.status = "unchanged";
                return;
            }

            record.status = "pending";
            const task = {
                element,
                record,
                sourceText,
                bucket,
                provider: config.comment_translation_provider,
                target: config.comment_translation_target,
                generation: this.generation,
            };
            if (element.matches?.('[data-e2e="comment-level-2"]')) this.queue.unshift(task);
            else this.queue.push(task);
        }

        abortActiveRequests() {
            for (const active of this.activeBatches) {
                for (const task of active.tasks) {
                    if (task.record.status === "pending") task.record.status = "idle";
                }
                active.controller?.abort?.();
            }
            this.activeBatches.clear();
            this.batchInFlight = false;
        }

        drainQueue() {
            if (!this.enabled) {
                for (const task of this.queue) {
                    if (task.record.status === "pending") task.record.status = "idle";
                }
                this.queue.length = 0;
                this.updateButton();
                return;
            }
            if (!this.queue.length) {
                this.updateButton();
                return;
            }

            let firstTask = null;
            for (let index = 0; index < this.queue.length;) {
                const candidate = this.queue[index];
                if (!candidate.element?.isConnected || candidate.generation !== this.generation) {
                    candidate.record.status = "idle";
                    this.queue.splice(index, 1);
                    continue;
                }
                firstTask = candidate;
                this.queue.splice(index, 1);
                break;
            }
            if (!firstTask) {
                this.updateButton();
                return;
            }

            const canBatchBucket = !firstTask.forceSingle && isBatchableTranslationBucket(firstTask.bucket);
            const limits = this.service.getBatchLimits(firstTask.provider);
            const providerMaxItems = Math.max(1, Number(limits.maxItems || 20));
            const maxItems = Math.min(MAX_SCRIPT_TRANSLATION_BATCH_ITEMS, providerMaxItems);
            const batch = [firstTask];

            if (canBatchBucket) {
                for (let index = 0; index < this.queue.length;) {
                    const task = this.queue[index];
                    if (!task.element?.isConnected || task.generation !== this.generation) {
                        task.record.status = "idle";
                        this.queue.splice(index, 1);
                        continue;
                    }
                    const sameBucket =
                          task.generation === firstTask.generation &&
                          task.provider === firstTask.provider &&
                          task.target === firstTask.target &&
                          task.bucket === firstTask.bucket &&
                          !task.forceSingle;
                    if (
                        sameBucket &&
                        batch.length < maxItems &&
                        this.service.canTranslateBatch(
                            firstTask.provider,
                            [...batch.map((entry) => entry.sourceText), task.sourceText],
                            { source: "auto", target: firstTask.target },
                        )
                    ) {
                        batch.push(task);
                        this.queue.splice(index, 1);
                        continue;
                    }
                    index += 1;
                }
            }

            const usePackedBatch = canBatchBucket && batch.length >= 2;
            const requestSingle = !usePackedBatch;

            if (requestSingle && !this.service.canTranslateSingle(
                firstTask.provider,
                firstTask.sourceText,
                { source: "auto", target: firstTask.target },
            )) {
                firstTask.record.status = "blocked";
                firstTask.record.failedAt = Date.now();
                if (Date.now() - this.lastErrorToastAt > 8000) {
                    this.lastErrorToastAt = Date.now();
                    this.app.notifications.toast(this.app.t("comment_translation_failed"), {
                        type: "error",
                        detail: "Comment is too long for the selected translation provider",
                    });
                }
                this.updateButton();
                this.drainQueue();
                return;
            }

            const batchGeneration = firstTask.generation;
            const AbortControllerCtor = this.window.AbortController || root?.AbortController;
            const requestController = typeof AbortControllerCtor === "function"
            ? new AbortControllerCtor()
            : null;
            const activeBatch = {
                controller: requestController,
                tasks: batch,
                generation: batchGeneration,
            };
            this.activeBatches.add(activeBatch);
            this.batchInFlight = this.activeBatches.size > 0;
            this.updateButton();

            const applyTranslatedItem = (task, translatedValue) => {
                if (
                    task.generation !== this.generation ||
                    !task.element?.isConnected ||
                    this.records.get(task.element) !== task.record
                ) return;
                task.record.translated = String(translatedValue || "").trim();
                task.record.status = "done";
                this.renderRecord(task.element, task.record);
            };

            const markTaskUntranslated = (task) => {
                if (
                    task.generation !== this.generation ||
                    !task.element?.isConnected ||
                    this.records.get(task.element) !== task.record
                ) return;
                task.record.translated = "";
                task.record.status = "untranslated";
            };

            const markTaskFailed = (task, error) => {
                if (
                    task.generation !== this.generation ||
                    !task.element?.isConnected ||
                    this.records.get(task.element) !== task.record
                ) return false;
                if (!this.enabled) {
                    task.record.status = "idle";
                    return false;
                }
                const rateLimited = Number(error?.status || 0) === 429;
                const stopTranslation = rateLimited || Boolean(error?.stopTranslation);
                task.record.failureCount = Number(task.record.failureCount || 0) + 1;
                task.record.status = stopTranslation || error?.nonRetryable ||
                    task.record.failureCount >= COMMENT_TRANSLATION_MAX_ATTEMPTS
                    ? "blocked"
                : "failed";
                task.record.failedAt = Date.now();
                if (task.record.status === "failed") {
                    this.scheduleRetry(COMMENT_TRANSLATION_RETRY_DELAY_MS);
                }
                if (stopTranslation) this.stop();
                if (Date.now() - this.lastErrorToastAt > 8000) {
                    this.lastErrorToastAt = Date.now();
                    this.app.notifications.toast(this.app.t("comment_translation_failed"), {
                        type: "error",
                        detail: rateLimited
                        ? this.app.t("comment_translation_rate_limited")
                        : error?.message || String(error),
                    });
                }
                return true;
            };

            let work;
            if (requestSingle) {
                work = this.service.translateSingle(firstTask.sourceText, {
                    provider: firstTask.provider,
                    target: firstTask.target,
                    signal: requestController?.signal,
                }).then((result) => {
                    if (
                        firstTask.generation !== this.generation ||
                        !firstTask.element?.isConnected ||
                        this.records.get(firstTask.element) !== firstTask.record
                    ) return;
                    if (result?.status === "translated" && String(result.text || "").trim()) {
                        applyTranslatedItem(firstTask, result.text);
                    } else if (result?.status === "unchanged" || result?.status === "untranslated") {
                        firstTask.record.translated = "";
                        firstTask.record.status = result.status;
                    } else {
                        markTaskFailed(firstTask, new Error("Single translation returned an invalid result"));
                    }
                }).catch((error) => {
                    markTaskFailed(firstTask, error);
                });
            } else {
                work = this.service.translateBatch(batch.map((task) => task.sourceText), {
                    provider: firstTask.provider,
                    target: firstTask.target,
                    signal: requestController?.signal,
                }).then((translatedItems) => {
                    if (!Array.isArray(translatedItems) || translatedItems.length !== batch.length) {
                        throw new Error("Translation service returned an invalid batch size");
                    }
                    batch.forEach((task, index) => {
                        const translated = typeof translatedItems[index] === "string"
                        ? translatedItems[index].trim()
                        : "";
                        if (
                            translated &&
                            this.normalizeTranslationComparison(translated) !==
                            this.normalizeTranslationComparison(task.sourceText)
                        ) {
                            applyTranslatedItem(task, translated);
                        } else {
                            markTaskUntranslated(task);
                        }
                    });
                }).catch((error) => {
                    const fallbackToSingle = (
                        !Number.isFinite(Number(error?.status)) || Number(error.status) < 500
                    ) && Number(error?.status || 0) !== 429 && (
                        error?.batchParseFailure ||
                        [400, 413, 414, 422].includes(Number(error?.status || 0)) ||
                        /(?:empty result|invalid json|invalid batch|boundaries could not be parsed)/i.test(
                            String(error?.message || ""),
                        )
                    );
                    if (fallbackToSingle) {
                        const retryTasks = batch.filter((task) => (
                            task.generation === this.generation &&
                            task.element?.isConnected &&
                            this.records.get(task.element) === task.record
                        ));
                        for (const task of retryTasks) {
                            task.forceSingle = true;
                            task.record.status = "pending";
                        }
                        this.queue.unshift(...retryTasks);
                        return;
                    }
                    for (const task of batch) markTaskFailed(task, error);
                });
            }

            work.finally(() => {
                this.activeBatches.delete(activeBatch);
                this.batchInFlight = this.activeBatches.size > 0;
                this.updateButton();
                this.drainQueue();
            });
            this.updateButton();
            this.drainQueue();
        }

        scan() {
            const videoKey = this.getCurrentVideoKey();
            if (videoKey !== null) {
                if (this.currentVideoKey === null) this.currentVideoKey = videoKey;
                else if (videoKey !== this.currentVideoKey) this.resetForVideo(videoKey);
            }
            const allCommentElements = this.getCommentElements();
            const context = this.getPanelContext(allCommentElements);
            this.syncMutationObservers(context.root);
            const commentElements = context.root
            ? allCommentElements.filter((element) => context.root.contains?.(element))
            : allCommentElements;
            this.mountButton(commentElements, context);
            if (!this.enabled) return;
            const config = this.app.configStore.get();
            for (const element of commentElements) {
                const record = this.getRecord(element);
                if (!this.isTranslatableText(record.original)) continue;
                if (["unchanged", "untranslated", "blocked"].includes(record.status)) continue;
                if (record.translated) {
                    this.renderRecord(element, record);
                    continue;
                }
                this.enqueue(element, record, config);
            }
            this.drainQueue();
        }

        handleSettingsChanged(previousConfig = {}, nextConfig = {}) {
            const serviceChanged =
                  previousConfig.comment_translation_provider !== nextConfig.comment_translation_provider ||
                  previousConfig.comment_translation_target !== nextConfig.comment_translation_target;
            const displayChanged =
                  previousConfig.comment_translation_display_mode !== nextConfig.comment_translation_display_mode;
            const autoOpenChanged =
                  previousConfig.comment_translation_auto_open !== nextConfig.comment_translation_auto_open;
            if (!serviceChanged && !displayChanged && !autoOpenChanged) return;
            if (autoOpenChanged) {
                const autoOpen = nextConfig.comment_translation_auto_open === "auto";
                if (autoOpen) {
                    this.enabled = true;
                    this.displayMode = "translated";
                } else {
                    this.stop();
                }
                this.applyDisplayMode();
                if (autoOpen) this.scheduleScan(0);
            }
            if (displayChanged) {
                this.applyDisplayMode();
                this.updateButton();
                this.scheduleScan(0);
            }
            if (!serviceChanged) {
                this.updateButton();
                return;
            }
            this.abortActiveRequests();
            this.generation += 1;
            this.queue.length = 0;
            this.clearRetryTimer();
            for (const element of this.getCommentElements()) {
                const record = this.records.get(element);
                if (!record) continue;
                record.translated = "";
                record.status = "idle";
                record.failedAt = 0;
                record.failureCount = 0;
                record.translatedElement?.remove?.();
                record.translatedElement = null;
                element.classList.remove(`${SCRIPT_PREFIX}-comment-original-hidden`);
            }
            if (this.enabled) {
                this.displayMode = "translated";
                this.scheduleScan(0);
            }
            this.updateButton();
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
            const cinemaRoot = element.closest?.('[role="dialog"][aria-label="Cinema mode"]');
            if (cinemaRoot) {
                const currentRow = cinemaRoot
                .querySelector?.('[data-cinema-mode-slot-stage="current"]')
                ?.closest?.("[data-cinema-mode-snap-row]");
                return currentRow || cinemaRoot;
            }
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

    function createDownloadCancelledError() {
        const error = new Error("Download cancelled");
        error.name = "AbortError";
        error.code = "download-cancelled";
        return error;
    }

    function isDownloadCancelledError(error) {
        return error?.code === "download-cancelled" || error?.name === "AbortError";
    }

    function throwIfDownloadAborted(signal) {
        if (signal?.aborted) throw createDownloadCancelledError();
    }

    class Downloader {
        constructor(win, gmRequest = null, gmDownloadFn = null) {
            this.window = win;
            this.gmRequest = gmRequest;
            this.gmDownload = gmDownloadFn;
            this.lastResult = null;
        }

        getDebugSnapshot() {
            return {
                lastResult: this.lastResult ? { ...this.lastResult } : null,
            };
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

        async fetchBlob(url, headers = {}, signal = null) {
            throwIfDownloadAborted(signal);
            const AbortControllerCtor = this.window.AbortController;
            const timeoutController = typeof AbortControllerCtor === "function"
            ? new AbortControllerCtor()
            : null;
            let timeoutTimer = null;
            let timedOut = false;
            const abortFetch = () => timeoutController?.abort();
            signal?.addEventListener?.("abort", abortFetch, { once: true });
            const timeoutPromise = new Promise((_resolve, reject) => {
                timeoutTimer = this.window.setTimeout(() => {
                    timedOut = true;
                    abortFetch();
                    reject(new Error("Request timeout"));
                }, DOWNLOAD_TIMEOUT_MS);
            });
            const withTimeout = (promise) => Promise.race([promise, timeoutPromise]);
            try {
                const response = await withTimeout(this.window.fetch(url, {
                    credentials: "include",
                    headers: this.normalizeFetchHeaders(headers),
                    referrer: this.window.location?.href || "https://www.tiktok.com/",
                    signal: timeoutController?.signal || signal || undefined,
                }));
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                const blob = await withTimeout(response.blob());
                throwIfDownloadAborted(signal);
                return {
                    blob,
                    requestedUrl: url,
                    url: response.url || url,
                    method: "fetch-blob",
                };
            } catch (err) {
                if (signal?.aborted || (!timedOut && isDownloadCancelledError(err))) {
                    throw createDownloadCancelledError();
                }
                if (!this.gmRequest) throw timedOut ? new Error("Request timeout") : err;
                return this.fetchBlobWithGm(url, headers, signal);
            } finally {
                this.window.clearTimeout(timeoutTimer);
                signal?.removeEventListener?.("abort", abortFetch);
            }
        }

        fetchBlobWithGm(url, headers = {}, signal = null) {
            return new Promise((resolve, reject) => {
                if (signal?.aborted) {
                    reject(createDownloadCancelledError());
                    return;
                }
                let request = null;
                let settled = false;
                let timeoutTimer = null;
                const cleanup = () => {
                    this.window.clearTimeout(timeoutTimer);
                    signal?.removeEventListener?.("abort", onAbort);
                };
                const settle = (callback, value) => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    callback(value);
                };
                const onAbort = () => {
                    try {
                        request?.abort?.();
                    } catch (_err) {
                    }
                    settle(reject, createDownloadCancelledError());
                };
                const onTimeout = () => {
                    settle(reject, new Error("Request timeout"));
                    try {
                        request?.abort?.();
                    } catch (_err) {
                    }
                };
                signal?.addEventListener?.("abort", onAbort, { once: true });
                timeoutTimer = this.window.setTimeout(onTimeout, DOWNLOAD_TIMEOUT_MS);
                try {
                    request = this.gmRequest({
                        method: "GET",
                        url,
                        headers: normalizeHeaders(headers),
                        responseType: "blob",
                        timeout: DOWNLOAD_TIMEOUT_MS,
                        onload: (response) => {
                            const status = Number(response.status || 0);
                            if (status >= 200 && status < 300 && response.response) {
                                settle(resolve, {
                                    blob: response.response,
                                    requestedUrl: url,
                                    url: response.finalUrl || url,
                                    method: "gm-xhr-blob",
                                });
                                return;
                            }
                            settle(reject, new Error(`HTTP ${status || "unknown"}`));
                        },
                        onabort: () => settle(reject, createDownloadCancelledError()),
                        onerror: (error) => settle(
                            reject,
                            signal?.aborted
                            ? createDownloadCancelledError()
                            : error,
                        ),
                        ontimeout: () => settle(reject, new Error("Request timeout")),
                    });
                    if (signal?.aborted) onAbort();
                } catch (err) {
                    settle(
                        reject,
                        signal?.aborted ? createDownloadCancelledError() : err,
                    );
                }
            });
        }

        downloadWithGm(url, filename, headers = {}, signal = null) {
            if (typeof this.gmDownload !== "function") {
                return Promise.reject(new Error("GM_download unavailable"));
            }

            return new Promise((resolve, reject) => {
                if (signal?.aborted) {
                    reject(createDownloadCancelledError());
                    return;
                }
                let download = null;
                let settled = false;
                let timeoutTimer = null;
                const cleanup = () => {
                    this.window.clearTimeout(timeoutTimer);
                    signal?.removeEventListener?.("abort", onAbort);
                };
                const settle = (callback, value) => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    callback(value);
                };
                const onAbort = () => {
                    try {
                        download?.abort?.();
                    } catch (_err) {
                    }
                    settle(reject, createDownloadCancelledError());
                };
                const onTimeout = () => {
                    settle(reject, new Error("Download timeout"));
                    try {
                        download?.abort?.();
                    } catch (_err) {
                    }
                };
                signal?.addEventListener?.("abort", onAbort, { once: true });
                timeoutTimer = this.window.setTimeout(onTimeout, DOWNLOAD_TIMEOUT_MS);
                try {
                    download = this.gmDownload({
                        url,
                        name: filename,
                        headers: normalizeHeaders(headers),
                        saveAs: false,
                        timeout: DOWNLOAD_TIMEOUT_MS,
                        onload: () => settle(resolve, {
                            requestedUrl: url,
                            url,
                            method: "gm-download",
                        }),
                        onerror: (error) => settle(
                            reject,
                            signal?.aborted
                            ? createDownloadCancelledError()
                            : error?.error
                            ? new Error(error.error)
                            : error,
                        ),
                        ontimeout: () => settle(reject, new Error("Download timeout")),
                    });
                    if (signal?.aborted) onAbort();
                } catch (err) {
                    settle(
                        reject,
                        signal?.aborted ? createDownloadCancelledError() : err,
                    );
                }
            });
        }

        async downloadUrl(urls, filename, headers = {}, signal = null) {
            let lastError = null;
            this.lastResult = null;
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

            for (let candidateIndex = 0; candidateIndex < allUrls.length; candidateIndex += 1) {
                const url = allUrls[candidateIndex];
                throwIfDownloadAborted(signal);
                try {
                    const result = await this.downloadWithGm(url, filename, headers, signal);
                    const fact = {
                        ...result,
                        candidateIndex,
                        fallbackUsed: candidateIndex > 0,
                    };
                    this.lastResult = { ...fact, filename };
                    return fact;
                } catch (err) {
                    if (signal?.aborted || isDownloadCancelledError(err)) {
                        throw createDownloadCancelledError();
                    }
                    lastError = err;
                }

                throwIfDownloadAborted(signal);
                try {
                    const result = await this.fetchBlob(url, headers, signal);
                    throwIfDownloadAborted(signal);
                    this.downloadBlob(result.blob, filename);
                    const fact = {
                        requestedUrl: result.requestedUrl || url,
                        url: result.url || url,
                        method: result.method || "fetch-blob",
                        candidateIndex,
                        fallbackUsed: candidateIndex > 0,
                    };
                    this.lastResult = { ...fact, filename };
                    return fact;
                } catch (err) {
                    if (signal?.aborted || isDownloadCancelledError(err)) {
                        throw createDownloadCancelledError();
                    }
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

    function clearFixedMenuPlacement(menu) {
        if (!menu) return;
        for (const property of ["left", "right", "top", "bottom"]) {
            menu.style[property] = "";
        }
        menu.style.position = "";
        menu.style.transform = "";
        delete menu.dataset.placement;
    }

    function applyFixedMenuPlacement(menu, placement) {
        if (!menu || !placement) return;
        menu.style.position = "fixed";
        menu.style.left = `${Math.round(placement.left)}px`;
        menu.style.top = `${Math.round(placement.top)}px`;
        menu.style.right = "auto";
        menu.style.bottom = "auto";
        menu.style.transform = "none";
        menu.dataset.placement = placement.placement;
    }

    const RECOMMEND_ACTION_BAR_SELECTOR = [
        'section[class*="SectionActionBarContainer"]',
        '[class*="SectionActionBarContainer"]',
        'section[class*="ActionBarContainer"]',
        '[class*="ActionBarContainer"]',
    ].join(",");

    const RECOMMEND_ACTION_METRIC_SELECTOR =
          '[data-e2e="like-icon"], [data-e2e="comment-icon"], [data-e2e="favorite-icon"], [data-e2e="share-icon"], ' +
          '[data-e2e="live-like-icon"], [data-e2e="live-share-icon"]';

    const PROFILE_BROWSE_DIALOG_SELECTOR = '[role="dialog"], [aria-modal="true"]';
    const PROFILE_BROWSE_ELLIPSIS_SELECTOR = '[data-e2e="browse-ellipsis"]';
    const PROFILE_BROWSE_MEDIA_SELECTOR = '[data-e2e="browse-video"], video, img';
    const CINEMA_MODE_ROOT_SELECTOR = '[role="dialog"][aria-label="Cinema mode"]';
    const CINEMA_PLAYER_ROOT_SELECTOR = '[data-cinema-mode-player-root="true"]';
    const CINEMA_MORE_BUTTON_SELECTOR =
          'button[data-testid="tux-web-button"][aria-haspopup="dialog"]';
    const CINEMA_CLOSE_BUTTON_SELECTOR =
          'button[data-testid="tux-web-button"][aria-label="Close"]';

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

    function getVisibleCinemaPlayerRoot(doc = root?.document, cinema = getCinemaModeRoot(doc)) {
        const win = doc?.defaultView || root;
        const viewportWidth = Number(win?.innerWidth || 0);
        const viewportHeight = Number(win?.innerHeight || 0);
        if (!cinema?.querySelectorAll || !viewportWidth || !viewportHeight) return null;
        return Array.from(cinema.querySelectorAll(CINEMA_PLAYER_ROOT_SELECTOR)).find((player) => {
            const rect = player.getBoundingClientRect?.();
            return Boolean(
                rect?.width > 0 &&
                rect?.height > 0 &&
                getVisibleRectRatio(rect, viewportWidth, viewportHeight) >= 0.5
            );
        }) || null;
    }

    function getVisibleCinemaControl(
        selector,
        doc = root?.document,
        scope = getVisibleCinemaPlayerRoot(doc) || getCinemaModeRoot(doc),
    ) {
        const win = doc?.defaultView || root;
        const viewportWidth = Number(win?.innerWidth || 0);
        const viewportHeight = Number(win?.innerHeight || 0);
        if (!scope?.querySelectorAll || !viewportWidth || !viewportHeight) return null;
        return Array.from(scope.querySelectorAll(selector))
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

    function getVisibleCinemaMoreButton(doc = root?.document, cinema = getCinemaModeRoot(doc)) {
        const player = getVisibleCinemaPlayerRoot(doc, cinema);
        return getVisibleCinemaControl(CINEMA_MORE_BUTTON_SELECTOR, doc, player || cinema);
    }

    function getVisibleCinemaCloseButton(doc = root?.document, cinema = getCinemaModeRoot(doc)) {
        const player = getVisibleCinemaPlayerRoot(doc, cinema);
        return player ? getVisibleCinemaControl(CINEMA_CLOSE_BUTTON_SELECTOR, doc, player) : null;
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
        return /^(?:like|comment|favorite|share|live-like|live-share)-icon$/i.test(value);
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
:where(.${SCRIPT_PREFIX}-panel, .${SCRIPT_PREFIX}-menu, .${SCRIPT_PREFIX}-modal, .${SCRIPT_PREFIX}-notification-card, .${SCRIPT_PREFIX}-image-button, .${SCRIPT_PREFIX}-sticker-button, .${SCRIPT_PREFIX}-profile-bulk-menu) {
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
  color: var(--tux-v2-color-ui-text-1);
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
  color: var(--tux-v2-color-ui-text-1);
  background: var(--tux-v2-color-ui-shape-neutral-4);
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  box-shadow: none;
  transition: background-color 0.15s ease;
}
.${SCRIPT_PREFIX}-image-button:hover { background: var(--tux-v2-color-ui-shape-neutral-3); }
.${SCRIPT_PREFIX}-image-button:focus-visible { outline: 2px solid var(--tux-v2-color-ui-text-3); outline-offset: 2px; }
.${SCRIPT_PREFIX}-sticker-button {
  position: fixed;
  z-index: 2147483200;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 96px;
  min-height: 42px;
  border: 0;
  border-radius: 999px;
  padding: 8px 12px;
  color: var(--tux-v2-color-ui-text-1);
  background: var(--tux-v2-color-ui-shape-neutral-4);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.15;
  text-align: center;
  white-space: normal;
  cursor: pointer;
  box-shadow: none;
  transition: background-color 0.15s ease;
}
.${SCRIPT_PREFIX}-sticker-button:hover { background: var(--tux-v2-color-ui-shape-neutral-3); }
.${SCRIPT_PREFIX}-sticker-button:focus-visible { outline: 2px solid var(--tux-v2-color-ui-text-3); outline-offset: 2px; }
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
  color: var(--tux-v2-color-ui-text-1);
  background: var(--tux-v2-color-ui-shape-neutral-4);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}
.${SCRIPT_PREFIX}-icon-button .TUXButton-content,
.${SCRIPT_PREFIX}-icon-button .TUXButton-iconContainer { display: flex; align-items: center; justify-content: center; }
.${SCRIPT_PREFIX}-icon-button svg { display: block; width: 1em; height: 1em; pointer-events: none; }
.${SCRIPT_PREFIX}-icon-button:hover { color: var(--tux-v2-color-ui-text-1); background: var(--tux-v2-color-ui-shape-neutral-3); }
button.TUXButton.${SCRIPT_PREFIX}-icon-button.${SCRIPT_PREFIX}-save-button { color: var(--tux-v2-color-ui-shape-text-1-on-primary); background: var(--tux-v2-color-ui-shape-primary); }
button.TUXButton.${SCRIPT_PREFIX}-icon-button.${SCRIPT_PREFIX}-save-button:hover { color: var(--tux-v2-color-ui-shape-text-1-on-primary); background: var(--tux-v2-color-ui-shape-primary-2); }
.${SCRIPT_PREFIX}-icon-button:focus-visible { outline: 2px solid var(--tux-v2-color-ui-text-3); outline-offset: 2px; }
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
  color: var(--tux-v2-color-ui-text-1);
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
  color: var(--tux-v2-color-ui-text-1);
  background: var(--tux-v2-color-ui-shape-neutral-4);
  box-shadow: none;
}
.${SCRIPT_PREFIX}-launcher-shell:hover .${SCRIPT_PREFIX}-launcher-container,
.${SCRIPT_PREFIX}-panel.open .${SCRIPT_PREFIX}-launcher-container {
  background: var(--tux-v2-color-ui-shape-neutral-3);
  color: var(--tux-v2-color-ui-text-1);
  transform: none;
}
.${SCRIPT_PREFIX}-panel.embedded .${SCRIPT_PREFIX}-launcher-shell:hover .${SCRIPT_PREFIX}-launcher-container,
.${SCRIPT_PREFIX}-panel.embedded.open .${SCRIPT_PREFIX}-launcher-container {
  color: var(--tux-v2-color-ui-text-1);
  background: var(--tux-v2-color-ui-shape-neutral-3);
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
  color: var(--tux-v2-color-ui-text-1) !important;
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
  color: var(--tux-v2-color-ui-text-1);
  background: var(--tux-v2-color-ui-shape-neutral-4);
}
.${SCRIPT_PREFIX}-panel.floating .${SCRIPT_PREFIX}-launcher-shell:hover .${SCRIPT_PREFIX}-launcher-container,
.${SCRIPT_PREFIX}-panel.floating.open .${SCRIPT_PREFIX}-launcher-container {
  color: var(--tux-v2-color-ui-text-1);
  background: var(--tux-v2-color-ui-shape-neutral-3);
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
.${SCRIPT_PREFIX}-profile-bulk-wrap:hover, .${SCRIPT_PREFIX}-profile-bulk-wrap.${SCRIPT_PREFIX}-profile-bulk-open { border-radius: 999px; background: var(--tux-v2-color-ui-shape-neutral-3) !important; }
.${SCRIPT_PREFIX}-profile-bulk-button:focus-visible { outline: 2px solid var(--tux-v2-color-ui-text-3); outline-offset: 2px; border-radius: 999px; }
.${SCRIPT_PREFIX}-profile-bulk-button svg {
  width: 24px;
  height: 24px;
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
  border: 2px solid var(--tux-v2-color-ui-image-overlay-white-a75);
  border-radius: 999px;
  background: var(--tux-v2-color-ui-image-overlay-black-a50);
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
.${SCRIPT_PREFIX}-profile-select-box:hover { background: var(--tux-v2-color-ui-image-overlay-black-a80); }
.${SCRIPT_PREFIX}-profile-select-box:focus-visible { outline: 2px solid var(--tux-v2-color-ui-image-overlay-white-a75); outline-offset: 2px; }
.${SCRIPT_PREFIX}-profile-select-box.selected { border-color: var(--tux-v2-color-ui-shape-primary); background: var(--tux-v2-color-ui-shape-primary); box-shadow: none; }
.${SCRIPT_PREFIX}-profile-select-box.downloaded { border-color: var(--tux-v2-color-ui-shape-success); background: var(--tux-v2-color-ui-shape-success); }
.${SCRIPT_PREFIX}-profile-drag-select {
  position: fixed;
  z-index: 2147483646;
  pointer-events: none;
  border: 1px solid var(--tux-v2-color-ui-shape-primary);
  background: rgba(37, 244, 238, 0.16);
  box-sizing: border-box;
}
.${SCRIPT_PREFIX}-profile-drag-select.deselecting {
  border-color: #fe2c55;
  background: rgba(254, 44, 85, 0.18);
}
body.${SCRIPT_PREFIX}-profile-dragging { user-select: none !important; }
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
  border: solid var(--tux-v2-color-ui-shape-text-1-on-primary);
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
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 14px;
  align-items: stretch;
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--tux-v2-color-ui-shape-neutral-3);
  border-radius: 12px;
  padding: 12px;
  background: var(--tux-v2-color-ui-shape-neutral-4);
  cursor: pointer;
  user-select: none;
  transition: background-color 140ms ease, border-color 140ms ease;
}
.${SCRIPT_PREFIX}-modal label.${SCRIPT_PREFIX}-bulk-row {
  display: grid;
  align-items: stretch;
  gap: 14px;
  margin: 0;
  font-weight: inherit;
}
.${SCRIPT_PREFIX}-bulk-row:hover { background: var(--tux-v2-color-ui-shape-neutral-3); }
.${SCRIPT_PREFIX}-bulk-row.selected { border-color: var(--tux-v2-color-ui-shape-primary-3); background: var(--tux-v2-color-ui-shape-primary-5); }
.${SCRIPT_PREFIX}-bulk-row.selected:hover { background: var(--tux-v2-color-ui-shape-primary-4); }
.${SCRIPT_PREFIX}-bulk-cover {
  width: 88px;
  height: 116px;
  border-radius: 9px;
  object-fit: cover;
  background: var(--tux-v2-color-ui-sheet-flat-2);
}
.${SCRIPT_PREFIX}-bulk-content {
  min-width: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 8px;
}
.${SCRIPT_PREFIX}-bulk-top,
.${SCRIPT_PREFIX}-bulk-bottom {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.${SCRIPT_PREFIX}-bulk-author {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 800;
}
.${SCRIPT_PREFIX}-bulk-badges {
  flex: 0 0 auto;
  margin-left: auto;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 6px;
}
.${SCRIPT_PREFIX}-bulk-desc {
  min-width: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  align-self: center;
  font-size: 13px;
  line-height: 1.5;
}
.${SCRIPT_PREFIX}-bulk-music {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--tux-v2-color-ui-text-3);
  font-size: 12px;
}
.${SCRIPT_PREFIX}-modal .${SCRIPT_PREFIX}-bulk-bottom input[type="checkbox"] {
  flex: 0 0 auto;
  width: 18px;
  min-width: 18px;
  height: 18px;
  margin: 0 0 0 auto;
  padding: 0;
  accent-color: var(--tux-v2-color-ui-shape-primary);
}
.${SCRIPT_PREFIX}-bulk-type {
  border-radius: 999px;
  padding: 5px 9px;
  font-size: 12px;
  font-weight: 700;
  background: var(--tux-v2-color-ui-shape-primary-5);
  color: var(--tux-v2-color-ui-text-primary);
  white-space: nowrap;
}
.${SCRIPT_PREFIX}-bulk-type.downloaded { background: var(--tux-v2-color-ui-shape-success-4); color: var(--tux-v2-color-ui-text-success); }
.${SCRIPT_PREFIX}-bulk-status { color: var(--tux-v2-color-ui-text-danger); font-size: 12px; font-weight: 700; white-space: nowrap; }
.${SCRIPT_PREFIX}-bulk-footer {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--tux-v2-color-ui-shape-neutral-3);
}
.${SCRIPT_PREFIX}-bulk-footer-left {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
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
  accent-color: var(--tux-v2-color-ui-shape-primary);
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
  color: var(--tux-v2-color-ui-text-3);
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
  color: var(--tux-v2-color-ui-text-primary);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.${SCRIPT_PREFIX}-profile-slider-field input[type="range"] { width: 100%; accent-color: var(--tux-v2-color-ui-shape-primary); }
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
  background: var(--tux-v2-color-ui-sheet-flat-2);
  border: 0;
  box-shadow: 0 24px 60px var(--tux-v2-color-shadow-floating);
  opacity: 1;
  color: var(--tux-v2-color-ui-text-1);
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
  color: var(--tux-v2-color-ui-text-1);
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  text-align: left;
  font-family: inherit;
}
.${SCRIPT_PREFIX}-menu .${SCRIPT_PREFIX}-button { width: 100%; min-height: 52px; border-radius: 8px; background: transparent; font-size: 16px; }
.${SCRIPT_PREFIX}-button.secondary { background: transparent; }
.${SCRIPT_PREFIX}-button:hover { background: var(--tux-v2-color-ui-shape-neutral-3); color: var(--tux-v2-color-ui-text-1); }
.${SCRIPT_PREFIX}-menu .${SCRIPT_PREFIX}-button:hover { background: var(--tux-v2-color-ui-shape-neutral-4); }
.${SCRIPT_PREFIX}-button:focus-visible { outline: 2px solid var(--tux-v2-color-ui-text-3); outline-offset: 2px; }
.${SCRIPT_PREFIX}-comment-translation-host {
  position: relative;
  display: flex;
  align-items: center;
  align-self: end;
  flex: 0 0 auto;
}
.${SCRIPT_PREFIX}-comment-login-row {
  display: flex !important;
  align-items: center !important;
}
.${SCRIPT_PREFIX}-comment-login-row > :first-child { flex: 1 1 auto; min-width: 0; }
.${SCRIPT_PREFIX}-comment-translation-host[data-placement="login"] { align-self: center; margin-left: 8px; margin-right: 12px; }
button.TUXButton.${SCRIPT_PREFIX}-comment-translate-button {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  box-sizing: border-box !important;
  width: 32px !important;
  min-width: 0 !important;
  height: 32px !important;
  min-height: 0 !important;
  margin: 4px 0 !important;
  border: 0 !important;
  border-radius: 8px !important;
  padding: 4px !important;
  color: var(--tux-v2-color-ui-text-1) !important;
  background: transparent !important;
  cursor: pointer !important;
  font-size: 16px !important;
  line-height: 21px !important;
}
.${SCRIPT_PREFIX}-comment-translate-button .TUXButton-content,
.${SCRIPT_PREFIX}-comment-translate-button .TUXButton-iconContainer {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}
.${SCRIPT_PREFIX}-comment-translate-button svg {
  width: 24px !important;
  height: 24px !important;
}
button.TUXButton.${SCRIPT_PREFIX}-comment-translate-button:hover {
  color: var(--tux-v2-color-ui-text-1) !important;
  background: var(--tux-v2-color-ui-shape-neutral-4) !important;
}
.${SCRIPT_PREFIX}-comment-translate-button:focus-visible {
  outline: 2px solid var(--tux-v2-color-ui-text-3);
  outline-offset: 2px;
}
button.TUXButton.${SCRIPT_PREFIX}-comment-translate-button[data-state="translated"],
button.TUXButton.${SCRIPT_PREFIX}-comment-translate-button[data-state="busy"] {
  color: var(--tux-v2-color-ui-text-primary) !important;
}
button.TUXButton.${SCRIPT_PREFIX}-comment-translate-button[data-state="busy"] {
  cursor: progress !important;
  opacity: 0.72;
}
.${SCRIPT_PREFIX}-comment-translation-tooltip {
  position: absolute;
  z-index: 2147483644;
  left: 50%;
  bottom: calc(100% + 8px);
  transform: translate(-50%, 4px);
  visibility: hidden;
  opacity: 0;
  pointer-events: none;
  box-sizing: border-box;
  min-width: 48px;
  min-height: 36px;
  max-width: 240px;
  padding: 9px 12px;
  border-radius: 10px;
  color: #fff;
  background: var(--tux-v2-color-ui-image-overlay-dark-gray-a85);
  font: 500 14px/1.3em var(--tux-fontFamilyParagraph, "TikTokFont", Arial, Tahoma, PingFangSC, sans-serif);
  letter-spacing: 0.0067em;
  white-space: nowrap;
  transition: opacity 100ms ease, transform 100ms ease, visibility 100ms ease;
}
.${SCRIPT_PREFIX}-comment-translation-host:hover:not([data-tooltip-suppressed="true"]) .${SCRIPT_PREFIX}-comment-translation-tooltip {
  visibility: visible;
  opacity: 1;
  transform: translate(-50%, 0);
  transition-delay: 300ms;
}
.${SCRIPT_PREFIX}-comment-original-hidden { display: none !important; }
.${SCRIPT_PREFIX}-comment-translation-text[hidden] { display: none !important; }
.${SCRIPT_PREFIX}-comment-translation-text {
  display: block;
  color: inherit;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
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
  color: var(--tux-v2-color-ui-text-1);
  background: var(--tux-v2-color-ui-sheet-flat-1);
  border: 1px solid var(--tux-v2-color-ui-shape-neutral-4);
  box-shadow: 0 24px 60px var(--tux-v2-color-shadow-floating);
  font: 14px/1.42 var(--tux-fontFamilyParagraph, "TikTokFont", Arial, Tahoma, PingFangSC, sans-serif);
  pointer-events: auto;
  overflow: hidden;
  transition: opacity 150ms ease, transform 150ms ease;
  animation: ${SCRIPT_PREFIX}-notification-card-in 150ms ease-out;
}
.${SCRIPT_PREFIX}-notification-card.${SCRIPT_PREFIX}-download-status.busy,
.${SCRIPT_PREFIX}-notification-card.${SCRIPT_PREFIX}-download-status.album,
.${SCRIPT_PREFIX}-notification-card.${SCRIPT_PREFIX}-download-status.image {
  border-color: var(--tux-v2-color-ui-shape-neutral-3);
}
.${SCRIPT_PREFIX}-notification-icon {
  width: 34px;
  height: 34px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: var(--tux-v2-color-ui-shape-neutral-4);
  color: var(--tux-v2-color-ui-text-1);
  font-weight: 700;
  font-size: 17px;
}
.${SCRIPT_PREFIX}-notification-card.error .${SCRIPT_PREFIX}-notification-icon {
  background: var(--tux-v2-color-ui-shape-danger-4);
  color: var(--tux-v2-color-ui-text-danger);
}
.${SCRIPT_PREFIX}-notification-card.success .${SCRIPT_PREFIX}-notification-icon {
  background: var(--tux-v2-color-ui-shape-success-4);
  color: var(--tux-v2-color-ui-text-success);
}
.${SCRIPT_PREFIX}-notification-card.${SCRIPT_PREFIX}-download-status.busy .${SCRIPT_PREFIX}-notification-icon,
.${SCRIPT_PREFIX}-notification-card.${SCRIPT_PREFIX}-download-status.album .${SCRIPT_PREFIX}-notification-icon,
.${SCRIPT_PREFIX}-notification-card.${SCRIPT_PREFIX}-download-status.image .${SCRIPT_PREFIX}-notification-icon {
  background: var(--tux-v2-color-ui-shape-neutral-4);
  color: var(--tux-v2-color-ui-text-primary);
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
  color: var(--tux-v2-color-ui-text-3);
  font-weight: 700;
  font-size: 13px;
}
.${SCRIPT_PREFIX}-notification-card.error .${SCRIPT_PREFIX}-notification-meta { color: var(--tux-v2-color-ui-text-danger); }
.${SCRIPT_PREFIX}-notification-card.success .${SCRIPT_PREFIX}-notification-meta { color: var(--tux-v2-color-ui-text-success); }
.${SCRIPT_PREFIX}-notification-detail {
  margin-top: 4px;
  color: var(--tux-v2-color-ui-text-3);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.${SCRIPT_PREFIX}-notification-close { align-self: center; }
.${SCRIPT_PREFIX}-notification-card.fading { opacity: 0; transform: translateX(12px); pointer-events: none; }
.${SCRIPT_PREFIX}-notification-card.attention { background: var(--tux-v2-color-ui-shape-neutral-4); }
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
  background: var(--tux-v2-color-ui-sheet-backdrop-2);
  display: grid;
  place-items: center;
  padding: 14px;
}
.${SCRIPT_PREFIX}-modal {
  width: min(900px, calc(100vw - 28px));
  max-height: min(760px, calc(100vh - 28px));
  overflow: auto;
  border-radius: 16px;
  background: var(--tux-v2-color-ui-sheet-flat-1);
  color: var(--tux-v2-color-ui-text-1);
  font: 14px/1.5 var(--tux-fontFamilyParagraph, "TikTokFont", Arial, Tahoma, PingFangSC, sans-serif);
  box-shadow: 0 24px 60px var(--tux-v2-color-shadow-floating);
}
.${SCRIPT_PREFIX}-modal header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 18px 22px;
  border-bottom: 1px solid var(--tux-v2-color-ui-shape-neutral-4);
}
.${SCRIPT_PREFIX}-modal main { padding: 18px 22px 22px; }
.${SCRIPT_PREFIX}-modal h2 { margin: 0; font-size: 20px; line-height: 1.2; }
.${SCRIPT_PREFIX}-settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
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
  border: 1px solid var(--tux-v2-color-ui-shape-neutral-3);
  border-radius: 8px;
  padding: 10px 12px;
  font: inherit;
  color: var(--tux-v2-color-ui-text-1);
  background-color: var(--tux-v2-color-ui-sheet-flat-2);
}
.${SCRIPT_PREFIX}-modal select {
  appearance: none;
  -webkit-appearance: none;
  padding-right: 44px;
  background-image:
    linear-gradient(45deg, transparent 50%, currentColor 50%),
    linear-gradient(135deg, currentColor 50%, transparent 50%);
  background-position:
    calc(100% - 18px) calc(50% - 1px),
    calc(100% - 13px) calc(50% - 1px);
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
}
.${SCRIPT_PREFIX}-modal input[type="checkbox"] {
  width: auto;
  min-width: 18px;
  height: 18px;
  padding: 0;
  accent-color: var(--tux-v2-color-ui-shape-primary);
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
  border-bottom: 1px solid var(--tux-v2-color-ui-shape-neutral-4);
  padding: 6px;
  text-align: left;
  vertical-align: top;
}
.${SCRIPT_PREFIX}-detail-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--tux-v2-color-ui-shape-neutral-4);
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
.${SCRIPT_PREFIX}-detail-tab.active { color: var(--tux-v2-color-ui-text-primary); border-bottom-color: var(--tux-v2-color-ui-shape-primary); }
.${SCRIPT_PREFIX}-detail-panel[hidden] { display: none !important; }
.${SCRIPT_PREFIX}-link { color: var(--tux-v2-color-ui-text-primary); overflow-wrap: anywhere; }
.${SCRIPT_PREFIX}-json-pre {
  max-height: 360px;
  overflow: auto;
  margin: 0;
  border: 1px solid var(--tux-v2-color-ui-shape-neutral-3);
  border-radius: 6px;
  padding: 10px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: var(--tux-v2-color-ui-sheet-flat-2);
  font: 12px Consolas, "Courier New", monospace;
}
.${SCRIPT_PREFIX}-details-modal {
  position: relative;
  width: min(1120px, calc(100vw - 28px));
  overflow: hidden;
  border-radius: 16px;
  background: var(--tux-v2-color-ui-sheet-flat-1);
  color: var(--tux-v2-color-ui-text-1);
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
  overflow: hidden;
  border-bottom: 0;
  background: var(--tux-v2-color-ui-sheet-flat-2);
  box-shadow: inset 0 -1px var(--tux-v2-color-ui-shape-neutral-4);
}
button.TUXButton.${SCRIPT_PREFIX}-icon-button.${SCRIPT_PREFIX}-details-close {
  flex: 0 0 1.75rem;
  margin: 0 10px;
}
.${SCRIPT_PREFIX}-launcher:focus, .${SCRIPT_PREFIX}-details-modal .${SCRIPT_PREFIX}-detail-tab:focus, .${SCRIPT_PREFIX}-detail-pill:focus { outline: none; }
.${SCRIPT_PREFIX}-launcher:focus-visible,
.${SCRIPT_PREFIX}-details-modal .${SCRIPT_PREFIX}-detail-tab:focus-visible,
.${SCRIPT_PREFIX}-detail-pill:focus-visible {
  outline: 2px solid var(--tux-v2-color-ui-text-3);
  outline-offset: 2px;
}
.${SCRIPT_PREFIX}-details-modal .${SCRIPT_PREFIX}-detail-tabs {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  gap: 0;
  margin: 0;
  border-bottom: 0;
  padding: 0 0 0 12px;
  overflow: hidden;
}
.${SCRIPT_PREFIX}-details-modal .${SCRIPT_PREFIX}-detail-tab {
  position: relative;
  flex: 0 0 auto;
  min-width: 112px;
  margin: 0;
  border: 0;
  padding: 18px 20px 16px;
  color: var(--tux-v2-color-ui-text-3);
  background: transparent;
  font-size: 16px;
  font-weight: 700;
}
.${SCRIPT_PREFIX}-details-modal .${SCRIPT_PREFIX}-detail-tab.active {
  color: var(--tux-v2-color-ui-text-primary);
  background: var(--tux-v2-color-ui-shape-primary-5);
}
.${SCRIPT_PREFIX}-details-modal .${SCRIPT_PREFIX}-detail-tab.active::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: var(--tux-v2-color-ui-shape-primary);
  pointer-events: none;
}
.${SCRIPT_PREFIX}-detail-body { flex: 1 1 auto; overflow: auto; padding: 22px 28px 28px; }
.${SCRIPT_PREFIX}-detail-fieldset {
  min-width: 0;
  margin: 0 0 22px;
  border: 1px solid var(--tux-v2-color-ui-shape-neutral-3);
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
  background: var(--tux-v2-color-ui-sheet-flat-2);
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
  background: var(--tux-v2-color-ui-sheet-flat-2);
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
  border: 1px solid var(--tux-v2-color-ui-shape-neutral-3);
  border-radius: 999px;
  padding: 5px 14px;
  color: inherit;
  background: var(--tux-v2-color-ui-shape-neutral-4);
  cursor: pointer;
  text-decoration: none;
  font: 13px var(--tux-fontFamilyParagraph, "TikTokFont", Arial, Tahoma, PingFangSC, sans-serif);
  white-space: nowrap;
}
.${SCRIPT_PREFIX}-detail-pill:hover { color: var(--tux-v2-color-ui-text-1); border-color: var(--tux-v2-color-ui-shape-neutral-3); background: var(--tux-v2-color-ui-shape-neutral-3); }
.${SCRIPT_PREFIX}-detail-table-wrap { overflow: auto; border: 1px solid var(--tux-v2-color-ui-shape-neutral-3); border-radius: 8px; }
.${SCRIPT_PREFIX}-detail-table {
  margin: 0;
  min-width: 780px;
  border-collapse: collapse;
  font-size: 13px;
}
.${SCRIPT_PREFIX}-detail-table th,
.${SCRIPT_PREFIX}-detail-table td {
  border-right: 1px solid var(--tux-v2-color-ui-shape-neutral-4);
  border-bottom: 1px solid var(--tux-v2-color-ui-shape-neutral-4);
  padding: 12px;
  vertical-align: middle;
}
.${SCRIPT_PREFIX}-detail-table th { font-weight: 800; background: var(--tux-v2-color-ui-shape-neutral-4); }
.${SCRIPT_PREFIX}-detail-rows {
  width: 100%;
  border-collapse: collapse;
  margin: 0;
  font-size: 14px;
}
.${SCRIPT_PREFIX}-detail-rows th, .${SCRIPT_PREFIX}-detail-rows td { border-bottom: 1px solid var(--tux-v2-color-ui-shape-neutral-4); padding: 10px 0; vertical-align: top; }
.${SCRIPT_PREFIX}-detail-rows th {
  width: 150px;
  padding-right: 18px;
  color: var(--tux-v2-color-ui-text-3);
  text-align: left;
  font-weight: 800;
}
.${SCRIPT_PREFIX}-detail-value { overflow-wrap: anywhere; white-space: pre-wrap; }
.${SCRIPT_PREFIX}-detail-json-actions { display: flex; gap: 10px; margin-bottom: 10px; }
.${SCRIPT_PREFIX}-details-modal .${SCRIPT_PREFIX}-json-pre { max-height: 560px; border-color: var(--tux-v2-color-ui-shape-neutral-3); }
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
  background: var(--tux-v2-color-ui-sheet-flat-2);
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
  background: var(--tux-v2-color-ui-sheet-flat-1);
  color: var(--tux-v2-color-ui-text-1);
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
  border-bottom: 1px solid var(--tux-v2-color-ui-shape-neutral-4);
  background: var(--tux-v2-color-ui-sheet-flat-2);
}
.${SCRIPT_PREFIX}-settings-header h2 {
  margin: 0;
  color: var(--tux-v2-color-ui-text-primary);
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
  border: 1px solid var(--tux-v2-color-ui-shape-neutral-4);
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--tux-v2-color-ui-shape-neutral-4);
}
.${SCRIPT_PREFIX}-filename-template-editor { display: grid; gap: 12px; }
.${SCRIPT_PREFIX}-filename-preview {
  min-height: 22px;
  border-top: 1px solid var(--tux-v2-color-ui-shape-neutral-3);
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
  background: var(--tux-v2-color-ui-sheet-flat-2);
}
.${SCRIPT_PREFIX}-modal label.${SCRIPT_PREFIX}-frame-format-control {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 auto 0 0;
  font-weight: 700;
}
.${SCRIPT_PREFIX}-modal select.${SCRIPT_PREFIX}-frame-format-select {
  width: auto;
  min-width: 104px;
  padding: 8px 36px 8px 12px;
  background-position:
    calc(100% - 16px) calc(50% - 1px),
    calc(100% - 11px) calc(50% - 1px);
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
  background: var(--tux-v2-color-ui-shape-neutral-3);
  text-align: center;
}
.${SCRIPT_PREFIX}-row .${SCRIPT_PREFIX}-button.danger { color: var(--tux-v2-color-ui-text-danger); border: 1px solid var(--tux-v2-color-ui-shape-danger); background: var(--tux-v2-color-ui-shape-danger-4); }
.${SCRIPT_PREFIX}-row .${SCRIPT_PREFIX}-button.danger:hover { color: var(--tux-v2-color-ui-text-danger); background: var(--tux-v2-color-ui-shape-neutral-3); }
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
.${SCRIPT_PREFIX}-button.TUXButton.primary { color: var(--tux-v2-color-ui-shape-text-1-on-primary); background: var(--tux-v2-color-ui-shape-primary); }
.${SCRIPT_PREFIX}-button.TUXButton.primary:hover:not(:disabled) { color: var(--tux-v2-color-ui-shape-text-1-on-primary); background: var(--tux-v2-color-ui-shape-primary-2); }
.${SCRIPT_PREFIX}-button.TUXButton.secondary { color: var(--tux-v2-color-ui-text-1); background: var(--tux-v2-color-ui-shape-neutral-4); }
.${SCRIPT_PREFIX}-button.TUXButton.secondary:hover:not(:disabled) { color: var(--tux-v2-color-ui-text-1); background: var(--tux-v2-color-ui-shape-neutral-3); }
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
  border: 1px solid var(--tux-v2-color-ui-shape-neutral-3);
  border-radius: 999px;
  padding: 7px 10px;
  color: var(--tux-v2-color-ui-text-1);
  background: var(--tux-v2-color-ui-shape-neutral-4);
  cursor: pointer;
  font: 12px var(--tux-fontFamilyParagraph, "TikTokFont", Arial, Tahoma, PingFangSC, sans-serif);
}
.${SCRIPT_PREFIX}-chip.available { cursor: pointer; background: transparent; }
.${SCRIPT_PREFIX}-chip.separator { border-style: dashed; }
.${SCRIPT_PREFIX}-chip small { color: var(--tux-v2-color-ui-text-3); font-size: 11px; }
.${SCRIPT_PREFIX}-check-chip {
  display: inline-flex !important;
  align-items: center;
  gap: 7px;
  margin: 0 !important;
  border: 1px solid var(--tux-v2-color-ui-shape-neutral-3);
  border-radius: 999px;
  padding: 7px 10px;
  color: inherit;
  background: var(--tux-v2-color-ui-shape-neutral-4);
  cursor: pointer;
  font: 12px var(--tux-fontFamilyParagraph, "TikTokFont", Arial, Tahoma, PingFangSC, sans-serif);
}
.${SCRIPT_PREFIX}-check-chip input {
  width: 14px !important;
  height: 14px;
  margin: 0;
  padding: 0;
  accent-color: var(--tux-v2-color-ui-shape-primary);
}
.${SCRIPT_PREFIX}-readonly { color: var(--tux-v2-color-ui-text-3); font-size: 13px; line-height: 1.45; }
.${SCRIPT_PREFIX}-actions { justify-content: flex-end; padding-top: 6px; border-top: 1px solid var(--tux-v2-color-ui-shape-neutral-4); }
@media (max-width: 720px) {
  .${SCRIPT_PREFIX}-settings-grid, .${SCRIPT_PREFIX}-detail-media-grid { grid-template-columns: 1fr; }
  .${SCRIPT_PREFIX}-modal header { padding: 16px; border-bottom: 1px solid var(--tux-v2-color-ui-shape-neutral-4); }
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
    const COMMENT_STICKER_SELECTOR = '[data-e2e="comment-sticker-comment"], [data-testid="comment-sticker-comment"]';
    const COMMENT_STICKER_BUTTON_MARGIN = 12;
    const COMMENT_STICKER_BUTTON_GAP = 8;
    const COMMENT_STICKER_BUTTON_ESTIMATED_WIDTH = 96;
    const COMMENT_STICKER_BUTTON_ESTIMATED_HEIGHT = 42;

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

    function getCommentStickerButtonPlacement(stickerRect, options = {}) {
        const viewportWidth = Number(options.viewportWidth || 0);
        const viewportHeight = Number(options.viewportHeight || 0);
        const buttonWidth = Number(options.buttonWidth || COMMENT_STICKER_BUTTON_ESTIMATED_WIDTH);
        const buttonHeight = Number(options.buttonHeight || COMMENT_STICKER_BUTTON_ESTIMATED_HEIGHT);
        const sticker = toPlainRect(stickerRect);
        if (!viewportWidth || !viewportHeight || !buttonWidth || !buttonHeight || !sticker) return null;

        const margin = Number(options.margin || COMMENT_STICKER_BUTTON_MARGIN);
        const gap = Number(options.gap || COMMENT_STICKER_BUTTON_GAP);
        const maxTop = Math.max(margin, viewportHeight - buttonHeight - margin);
        const top = clampNumber(
            sticker.top + sticker.height / 2 - buttonHeight / 2,
            margin,
            maxTop,
            sticker.top,
        );
        const leftCandidate = sticker.left - gap - buttonWidth;
        if (leftCandidate >= margin) return { left: leftCandidate, top };

        const rightCandidate = sticker.right + gap;
        if (rightCandidate + buttonWidth <= viewportWidth - margin) {
            return { left: rightCandidate, top };
        }

        return {
            left: clampNumber(leftCandidate, margin, Math.max(margin, viewportWidth - buttonWidth - margin), margin),
            top,
        };
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
            this.dragSelection = null;
            this.suppressedClickBox = null;
            this.checkboxItems = new WeakMap();
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
            this.disableSelectionMode();
            this.unmountButtonOnly();
        }

        unmount() {
            this.closeMenu();
            this.disableSelectionMode();
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
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
            <path d="M12 3v12" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"></path>
            <path d="M7 11l5 5 5-5" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"></path>
            <path d="M5 20h14" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"></path>
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
            if (immediate) {
                this.menuLifecycle.closeImmediate();
            } else {
                this.menuLifecycle.close(() => {
                    this.buttonWrapper?.classList?.remove?.(`${SCRIPT_PREFIX}-profile-bulk-open`);
                });
            }
        }

        clearMenuPosition() {
            clearFixedMenuPlacement(this.menu);
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
            applyFixedMenuPlacement(menu, placement);
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
                this.document.querySelector?.('main,[role="main"]') ||
                this.document.querySelector?.('[class*="DivShareLayoutMain"]') ||
                this.document.querySelector?.('[data-e2e^="user-"][data-e2e$="-item-list"]') ||
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
                const observerRoot = mutationRoot.matches?.('main,[role="main"],[class*="DivShareLayoutMain"]')
                ? mutationRoot
                : mutationRoot.parentElement || mutationRoot;
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
            this.cancelDragSelection(false);
            this.selectedItems.clear();
            this.document.querySelectorAll(`.${SCRIPT_PREFIX}-profile-select-box`).forEach((box) => {
                box.classList.remove("selected");
                box.setAttribute("aria-checked", "false");
            });
            this.updateMenuLabels();
            this.scheduleScan();
        }

        disableSelectionMode() {
            this.selectionMode = false;
            this.cancelDragSelection();
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
                      anchor.closest?.('[data-e2e^="user-"][data-e2e$="-item"]') ||
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
                  anchor?.closest?.('[data-e2e^="user-"][data-e2e$="-item"]') ||
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

        setItemSelected(item, selected) {
            const id = String(item?.id || "");
            if (!id) return false;
            if (!selected) return this.selectedItems.delete(id);
            if (this.selectedItems.has(id)) return false;

            const card = item.card || null;
            const cardAnchor = card?.querySelector?.('a[href*="/video/"], a[href*="/photo/"]') || null;
            const fresh = this.extractItemFromAnchor(cardAnchor) || item;
            const reactFragments = collectLocalReactItems([
                { element: card, source: "profile-card" },
                { element: cardAnchor, source: "profile-card-link" },
            ]).entries
            .filter((entry) => entry.id === id)
            .map((entry) => entry.item);
            this.selectedItems.set(id, {
                ...item,
                ...fresh,
                exactItem: mergeExactItemFragments(reactFragments, id),
                card: null,
            });
            return true;
        }

        startDragSelection(event, sourceBox) {
            if (!this.selectionMode || !event?.isPrimary || event.button !== 0) return;
            const sourceItem = this.checkboxItems.get(sourceBox);
            if (!sourceItem?.id) return;
            this.cancelDragSelection();
            event.preventDefault();
            event.stopPropagation();

            const drag = {
                pointerId: event.pointerId,
                sourceBox,
                startX: event.clientX,
                startY: event.clientY,
                currentX: event.clientX,
                currentY: event.clientY,
                held: false,
                moved: false,
                active: false,
                frame: null,
                overlay: null,
                selecting: !this.selectedItems.has(String(sourceItem.id)),
                candidates: [],
            };
            const activate = () => {
                if (this.dragSelection !== drag || drag.active || !drag.held || !drag.moved) return;
                drag.active = true;
                drag.candidates = Array.from(
                    this.document.querySelectorAll(`.${SCRIPT_PREFIX}-profile-select-box`),
                )
                    .map((box) => {
                    const item = this.checkboxItems.get(box);
                    const rect = (item?.card || box.parentElement)?.getBoundingClientRect?.();
                    if (!item?.id || !rect?.width || !rect?.height) return null;
                    const baselineSelected = this.selectedItems.has(String(item.id));
                    return {
                        box,
                        item,
                        rect,
                        baselineSelected,
                        previewSelected: baselineSelected,
                        inside: false,
                    };
                })
                    .filter(Boolean);
                drag.overlay = createElement(this.document, "div", `${SCRIPT_PREFIX}-profile-drag-select`);
                if (!drag.selecting) drag.overlay.classList.add("deselecting");
                drag.overlay.setAttribute("aria-hidden", "true");
                this.document.body.appendChild(drag.overlay);
                this.document.body.classList.add(`${SCRIPT_PREFIX}-profile-dragging`);
                this.scheduleDragSelectionUpdate(drag);
            };
            drag.onMove = (moveEvent) => {
                if (moveEvent.pointerId !== drag.pointerId) return;
                drag.currentX = moveEvent.clientX;
                drag.currentY = moveEvent.clientY;
                drag.moved = drag.moved || Math.hypot(
                    drag.currentX - drag.startX,
                    drag.currentY - drag.startY,
                ) >= 6;
                activate();
                if (!drag.active) return;
                moveEvent.preventDefault();
                moveEvent.stopPropagation();
                this.scheduleDragSelectionUpdate(drag);
            };
            drag.onEnd = (endEvent) => {
                if (endEvent.pointerId !== drag.pointerId) return;
                if (drag.active) {
                    endEvent.preventDefault();
                    endEvent.stopPropagation();
                    drag.currentX = endEvent.clientX;
                    drag.currentY = endEvent.clientY;
                    this.updateDragSelection(drag);
                    this.commitDragSelection(drag);
                    this.suppressedClickBox = sourceBox;
                    this.window.setTimeout?.(() => {
                        if (this.suppressedClickBox === sourceBox) this.suppressedClickBox = null;
                    }, 0);
                }
                this.cancelDragSelection(false);
            };
            drag.onCancel = () => this.cancelDragSelection();
            drag.holdTimer = this.window.setTimeout?.(() => {
                drag.held = true;
                activate();
            }, 260);
            this.dragSelection = drag;
            this.document.addEventListener("pointermove", drag.onMove, true);
            this.document.addEventListener("pointerup", drag.onEnd, true);
            this.document.addEventListener("pointercancel", drag.onCancel, true);
            this.window.addEventListener?.("blur", drag.onCancel, true);
        }

        scheduleDragSelectionUpdate(drag) {
            if (this.dragSelection !== drag || drag.frame) return;
            const run = () => {
                drag.frame = null;
                this.updateDragSelection(drag);
            };
            drag.frame = typeof this.window.requestAnimationFrame === "function"
                ? this.window.requestAnimationFrame(run)
            : this.window.setTimeout(run, 16);
        }

        updateDragSelection(drag) {
            if (this.dragSelection !== drag || !drag.active || !drag.overlay) return;
            const left = Math.min(drag.startX, drag.currentX);
            const top = Math.min(drag.startY, drag.currentY);
            const right = Math.max(drag.startX, drag.currentX);
            const bottom = Math.max(drag.startY, drag.currentY);
            drag.overlay.style.left = `${left}px`;
            drag.overlay.style.top = `${top}px`;
            drag.overlay.style.width = `${right - left}px`;
            drag.overlay.style.height = `${bottom - top}px`;

            drag.candidates.forEach((candidate) => {
                const { rect } = candidate;
                const inside = !(
                    rect.right < left || rect.left > right || rect.bottom < top || rect.top > bottom
                );
                if (inside === candidate.inside) return;
                candidate.inside = inside;
                const selected = inside ? drag.selecting : candidate.baselineSelected;
                if (selected === candidate.previewSelected) return;
                candidate.previewSelected = selected;
                const downloaded = selected &&
                      this.selectedItems.get(String(candidate.item.id))?.bulkDownloadResult?.status === "success";
                candidate.box.classList.toggle("selected", selected);
                candidate.box.classList.toggle("downloaded", downloaded);
                candidate.box.setAttribute("aria-checked", selected ? "true" : "false");
                candidate.box.setAttribute(
                    "aria-label",
                    downloaded ? this.app.t("download_completed") : this.app.t("bulk_download_selected"),
                );
            });
        }

        commitDragSelection(drag) {
            let changed = false;
            drag.candidates.forEach((candidate) => {
                if (candidate.previewSelected === candidate.baselineSelected) return;
                if (this.setItemSelected(candidate.item, candidate.previewSelected)) changed = true;
                this.updateCheckboxState(candidate.box, candidate.item.id);
            });
            if (changed) this.updateMenuLabels();
        }

        cancelDragSelection(restorePreview = true) {
            const drag = this.dragSelection;
            if (!drag) return;
            this.window.clearTimeout?.(drag.holdTimer);
            if (drag.frame) {
                if (typeof this.window.cancelAnimationFrame === "function") {
                    this.window.cancelAnimationFrame(drag.frame);
                } else {
                    this.window.clearTimeout?.(drag.frame);
                }
            }
            this.document.removeEventListener("pointermove", drag.onMove, true);
            this.document.removeEventListener("pointerup", drag.onEnd, true);
            this.document.removeEventListener("pointercancel", drag.onCancel, true);
            this.window.removeEventListener?.("blur", drag.onCancel, true);
            if (restorePreview && drag.active) {
                drag.candidates.forEach((candidate) => {
                    if (candidate.previewSelected !== candidate.baselineSelected) {
                        this.updateCheckboxState(candidate.box, candidate.item.id);
                    }
                });
            }
            drag.overlay?.remove?.();
            this.document.body.classList.remove(`${SCRIPT_PREFIX}-profile-dragging`);
            this.dragSelection = null;
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
                    this.setItemSelected(item, nextChecked);
                    setBoxState(box);
                    this.updateMenuLabels();
                };

                box.addEventListener("pointerdown", (event) => {
                    this.startDragSelection(event, box);
                });
                box.addEventListener("click", (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (this.suppressedClickBox === box) {
                        this.suppressedClickBox = null;
                        return;
                    }
                    toggleSelected();
                });
                const mark = createElement(this.document, "span", `${SCRIPT_PREFIX}-profile-select-mark`);
                box.appendChild(mark);
                card.appendChild(box);
            }

            this.checkboxItems.set(box, item);
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
            const modal = this.app.createModal(this.app.t("bulk_confirm_title"), { closeOnBackdrop: false });
            modal.classList.add(`${SCRIPT_PREFIX}-bulk-confirm-modal`);
            const main = modal.querySelector("main");
            const selected = new Set(
                items
                .filter((item) => item.bulkDownloadResult?.status !== "success")
                .map((item) => item.id),
            );
            const list = createElement(this.document, "div", `${SCRIPT_PREFIX}-bulk-list`);
            const footer = createElement(this.document, "div", `${SCRIPT_PREFIX}-bulk-footer`);
            const footerLeft = createElement(this.document, "div", `${SCRIPT_PREFIX}-bulk-footer-left`);
            const countLabel = createElement(this.document, "div", `${SCRIPT_PREFIX}-readonly`);
            const selectionActions = createElement(this.document, "div", `${SCRIPT_PREFIX}-row`);
            const actions = createElement(this.document, "div", `${SCRIPT_PREFIX}-row`);
            const rowControls = new Map();
            const close = this.app.actionButton(this.app.t("cancel"), () => modal.close?.(), "secondary");
            const start = this.app.actionButton(this.app.t("bulk_start_download"), () => {
                const finalItems = items.filter((item) => selected.has(item.id));
                modal.close?.();
                this.app.downloadProfileBulkItems(finalItems);
            }, "primary");
            const retryItems = items.filter((item) =>
                                            ["failed", "partial"].includes(item.bulkDownloadResult?.status),
                                           );
            const retryFailed = retryItems.length
            ? this.app.actionButton(this.app.t("bulk_retry_failed"), () => {
                modal.close?.();
                this.app.downloadProfileBulkItems(retryItems, { retryFailedOnly: true });
            }, "secondary")
            : null;
            const continueItems = items.filter((item) =>
                                               ["cancelled", "pending"].includes(item.bulkDownloadResult?.status),
                                              );
            const continueDownload = continueItems.length
            ? this.app.actionButton(this.app.t("bulk_continue_download"), () => {
                modal.close?.();
                this.app.downloadProfileBulkItems(continueItems, { resumeCancelled: true });
            }, "secondary")
            : null;
            const updateCount = () => {
                countLabel.textContent = `${this.app.t("bulk_selected_count")} ${selected.size}`;
                start.disabled = selected.size <= 0;
            };
            const syncSelectionUi = () => {
                rowControls.forEach(({ row, checkbox }, itemId) => {
                    const checked = selected.has(itemId);
                    checkbox.checked = checked;
                    row.classList.toggle("selected", checked);
                });
                updateCount();
            };
            const selectAll = this.app.actionButton(this.app.t("select_all"), () => {
                items.forEach((item) => selected.add(item.id));
                syncSelectionUi();
            }, "secondary");
            const invertSelection = this.app.actionButton(this.app.t("invert_selection"), () => {
                items.forEach((item) => {
                    if (selected.has(item.id)) selected.delete(item.id);
                    else selected.add(item.id);
                });
                syncSelectionUi();
            }, "secondary");

            for (const item of items) {
                const row = createElement(this.document, "label", `${SCRIPT_PREFIX}-bulk-row`);
                const checkbox = createElement(this.document, "input");
                checkbox.type = "checkbox";
                checkbox.checked = selected.has(item.id);
                checkbox.addEventListener("change", () => {
                    if (checkbox.checked) selected.add(item.id);
                    else selected.delete(item.id);
                    row.classList.toggle("selected", checkbox.checked);
                    updateCount();
                });
                row.classList.toggle("selected", checkbox.checked);
                rowControls.set(item.id, { row, checkbox });
                const cover = createElement(this.document, "img", `${SCRIPT_PREFIX}-bulk-cover`);
                cover.alt = "";
                if (item.coverUrl) cover.src = item.coverUrl;

                const media = item.exactItem
                ? normalizeMediaItem(item.exactItem, item.pageUrl || item.href || "", this.app.configStore.get())
                : null;
                const authorName = String(
                    media?.author?.nickname ||
                    media?.author?.uniqueId ||
                    this.getProfileKey().replace(/^@/, "") ||
                    "-",
                ).trim();
                const description = String(media?.desc || item.desc || item.pageUrl || item.id || "").trim();
                const musicTitle = String(media?.music?.title || "").trim();
                const musicAuthor = String(media?.music?.authorName || "").trim();
                const musicText = musicTitle
                ? `♫ ${musicTitle}${musicAuthor ? ` - ${musicAuthor}` : ""}`
                : "";

                const content = createElement(this.document, "div", `${SCRIPT_PREFIX}-bulk-content`);
                const top = createElement(this.document, "div", `${SCRIPT_PREFIX}-bulk-top`);
                const author = createElement(this.document, "div", `${SCRIPT_PREFIX}-bulk-author`, authorName);
                const badges = createElement(this.document, "div", `${SCRIPT_PREFIX}-bulk-badges`);
                badges.append(createElement(this.document, "div", `${SCRIPT_PREFIX}-bulk-type`, this.getItemTypeLabel(item)));
                const result = item.bulkDownloadResult;
                if (result?.status === "success") {
                    badges.append(createElement(
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
                    badges.append(createElement(
                        this.document,
                        "div",
                        `${SCRIPT_PREFIX}-bulk-status`,
                        `${this.app.t("download_failed")}${progress}`,
                    ));
                }
                if (result?.status === "cancelled") {
                    const progress = result.totalAssetCount > 1
                    ? ` ${result.successfulAssetCount}/${result.totalAssetCount}`
                    : "";
                    badges.append(createElement(
                        this.document,
                        "div",
                        `${SCRIPT_PREFIX}-bulk-status`,
                        `${this.app.t("download_cancelled")}${progress}`,
                    ));
                }
                top.append(author, badges);

                const desc = createElement(this.document, "div", `${SCRIPT_PREFIX}-bulk-desc`, description);
                const bottom = createElement(this.document, "div", `${SCRIPT_PREFIX}-bulk-bottom`);
                const music = createElement(this.document, "div", `${SCRIPT_PREFIX}-bulk-music`, musicText);
                bottom.append(music, checkbox);
                content.append(top, desc, bottom);
                row.append(cover, content);
                list.appendChild(row);
            }
            selectionActions.append(selectAll, invertSelection);
            footerLeft.append(selectionActions, countLabel);
            actions.append(close);
            if (retryFailed) actions.append(retryFailed);
            if (continueDownload) actions.append(continueDownload);
            actions.append(start);
            footer.append(footerLeft, actions);
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
            this.downloadStatusHideCancel = null;
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

        scheduleNotificationRemoval(card, delay, remove) {
            let timer = null;
            const attempt = () => {
                timer = null;
                if (card?.matches?.(":hover")) {
                    timer = this.window.setTimeout?.(attempt, 200);
                    return;
                }
                remove();
            };
            timer = this.window.setTimeout?.(attempt, delay);
            return () => {
                if (timer) this.window.clearTimeout?.(timer);
                timer = null;
            };
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
            if (this.downloadStatusHideCancel) {
                this.downloadStatusHideCancel();
                this.downloadStatusHideCancel = null;
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

            if (this.downloadStatusHideCancel) {
                this.downloadStatusHideCancel();
                this.downloadStatusHideCancel = null;
            }

            if (immediate || delay <= 0) {
                remove();
                return;
            }

            const statusCard = this.downloadStatusEl;
            this.downloadStatusHideCancel = this.scheduleNotificationRemoval(statusCard, delay, () => {
                this.downloadStatusHideCancel = null;
                remove();
            });
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
                this.scheduleNotificationRemoval(
                    refs.card,
                    autoHideMs,
                    () => this.removeNotificationCard(refs.card),
                );
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
            this.downloadAbortController = null;
            this.lastProfileBulkRun = null;
            this.lastProfileBulkResolve = null;
            this.lastExtractionTrace = null;
            this.notifications = new NotificationCenter(this);
            this.commentTranslation = new CommentTranslationController(this);
            this.menuLifecycle = new MenuLifecycle(win, {
                onStateChange: () => this.applyPanelState(),
                onClosed: () => {
                    this.clearPanelMenuPosition();
                    this.mountPanel();
                },
            });
            this.imageDownloadButton = null;
            this.commentStickerButton = null;
            this.commentStickerTarget = null;
            this.imageOverlayWatcherBound = false;
            this.commentStickerWatcherBound = false;
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
            this.commentTranslation.start();
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
            this.renderCommentStickerButton();
            this.bindImageOverlayWatcher();
            this.bindCommentStickerWatcher();
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

        ensureCommentStickerButton() {
            if (this.commentStickerButton) return this.commentStickerButton;
            const button = createElement(this.document, "button", `${SCRIPT_PREFIX}-sticker-button`);
            button.type = "button";
            button.style.display = "none";
            button.addEventListener("click", (event) => {
                event.stopPropagation();
                this.downloadCommentSticker();
            });
            this.document.body.appendChild(button);
            this.commentStickerButton = button;
            return button;
        }

        getCommentStickerTarget(container) {
            if (!container || !this.document.contains(container)) return null;
            const image =
                  container.matches?.("img") ? container :
            container.querySelector?.('img[alt="sticker"], img') || null;
            if (!image) return null;
            const imageUrl = getDownloadableOverlayImageUrl(getElementImageUrl(image, this.window));
            if (!imageUrl) return null;
            const rect = toPlainRect(container.getBoundingClientRect?.());
            if (!rect?.width || !rect?.height) return null;
            return {
                element: container,
                imageElement: image,
                imageUrl,
                rect,
            };
        }

        clearCommentStickerTarget() {
            this.commentStickerTarget = null;
            if (this.commentStickerButton) this.commentStickerButton.style.display = "none";
        }

        renderCommentStickerButton() {
            const button = this.ensureCommentStickerButton();
            button.textContent = this.t("download_sticker");
            button.removeAttribute?.("title");
            button.style.left = "auto";
            button.style.top = "auto";

            const target = this.commentStickerTarget;
            if (!target?.element || !this.document.contains(target.element)) {
                button.style.display = "none";
                return;
            }

            const nextTarget = this.getCommentStickerTarget(target.element);
            if (!nextTarget?.imageUrl) {
                this.clearCommentStickerTarget();
                return;
            }
            this.commentStickerTarget = nextTarget;

            const buttonRect = toPlainRect(button.getBoundingClientRect?.());
            const placement = getCommentStickerButtonPlacement(nextTarget.rect, {
                viewportWidth: this.window.innerWidth || 0,
                viewportHeight: this.window.innerHeight || 0,
                buttonWidth: buttonRect?.width || COMMENT_STICKER_BUTTON_ESTIMATED_WIDTH,
                buttonHeight: buttonRect?.height || COMMENT_STICKER_BUTTON_ESTIMATED_HEIGHT,
            });
            if (!placement) {
                button.style.display = "none";
                return;
            }

            button.style.left = `${Math.round(placement.left)}px`;
            button.style.top = `${Math.round(placement.top)}px`;
            button.style.right = "auto";
            button.style.bottom = "auto";
            button.style.display = "";
        }

        getCommentStickerFilename(url) {
            const config = this.configStore.get();
            const previewMedia = this.getFilenamePreviewMedia();
            const base = buildFilename(previewMedia, config) || `tiktok_${Date.now()}`;
            const sourceExtension = String(
                String(url || "").match(/\.([a-z0-9]{2,8})(?:[?#]|$)/i)?.[1] || "",
            ).toLowerCase();
            const extension = sourceExtension === "awebp"
            ? "webp"
            : ["webp", "png", "jpg", "jpeg", "gif", "avif"].includes(sourceExtension)
            ? sourceExtension
            : "webp";
            return normalizeFilename(`${base}_sticker.${extension}`, {
                maxLength: Number(config.filename_max_length || DEFAULT_CONFIG.filename_max_length),
                preserveExtension: true,
            });
        }

        async downloadCommentSticker() {
            const imageUrl = this.commentStickerTarget?.imageUrl || "";
            const filename = imageUrl ? this.getCommentStickerFilename(imageUrl) : "";
            return this.downloadAsset(imageUrl, filename, "image");
        }

        bindCommentStickerWatcher() {
            if (this.commentStickerWatcherBound) return;
            this.commentStickerWatcherBound = true;

            const hideButton = () => this.clearCommentStickerTarget();

            const handleClick = (event) => {
                const target = event.target;
                if (!target) return;
                if (this.panel?.contains(target) || this.menu?.contains(target)) return;
                if (this.commentStickerButton?.contains(target)) return;
                const container = typeof target.closest === "function"
                ? target.closest(COMMENT_STICKER_SELECTOR)
                : null;
                if (!container) {
                    this.clearCommentStickerTarget();
                    return;
                }
                const nextTarget = this.getCommentStickerTarget(container);
                if (!nextTarget?.imageUrl) {
                    this.clearCommentStickerTarget();
                    return;
                }
                this.commentStickerTarget = nextTarget;
                this.window.setTimeout?.(() => this.renderCommentStickerButton(), 0);
            };

            this.document.addEventListener?.("click", handleClick, true);
            this.window.addEventListener?.("resize", hideButton);
            this.document.addEventListener?.("scroll", hideButton, true);
        }

        bindImageOverlayWatcher() {
            if (this.imageOverlayWatcherBound) return;
            this.imageOverlayWatcherBound = true;
            const handleClick = (event) => {
                const target = event.target;
                if (!target) return;
                if (this.getCurrentPageType() !== "recommend") return;
                if (this.panel?.contains(target) || this.imageDownloadButton?.contains(target)) return;
                if (typeof target.closest === "function" && target.closest(COMMENT_STICKER_SELECTOR)) return;
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
            const isLiveMenuContext = Boolean(
                isOpen && this.isCurrentLiveContext(this.getCurrentActionAnchor())
            );
            if (this.downloadButtonEl) {
                this.downloadButtonEl.textContent = this.t("download");
                this.downloadButtonEl.hidden = isLiveMenuContext;
            }
            if (this.frameButtonEl) this.frameButtonEl.textContent = this.t("frame_capture");
            if (this.detailsButtonEl) {
                this.detailsButtonEl.textContent = this.t("details");
                this.detailsButtonEl.hidden = isLiveMenuContext;
            }
            if (this.settingsButtonEl) this.settingsButtonEl.textContent = this.t("settings");
            const showDebugItems = Boolean(config.show_debug_info_menu && !isLiveMenuContext);
            if (this.debugInfoButtonEl) {
                this.debugInfoButtonEl.textContent = this.t("debug_info");
                this.debugInfoButtonEl.hidden = !showDebugItems;
            }
            const showTestItems = Boolean(config.show_test_notification_menu && !isLiveMenuContext);
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
            clearFixedMenuPlacement(this.menu);
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
            applyFixedMenuPlacement(this.menu, placement);
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
            }, true);
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

        mountPanelLeftOfButton(anchor, placementMode, mirrorSurface = null) {
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
            const margin = 12;
            const viewportWidth = this.window.innerWidth || 0;
            const viewportHeight = this.window.innerHeight || 0;
            const cinemaPlacement = placementMode === "cinema";
            const mirrorRect = mirrorSurface?.getBoundingClientRect?.();
            const mirroredCinemaPlacement = Boolean(
                cinemaPlacement && mirrorRect?.width > 0 && mirrorRect?.height > 0
            );
            const preferredLeft = rect.left - size - margin;
            const fallbackLeft = rect.right + margin;
            const left = mirroredCinemaPlacement
            ? clampNumber(
                mirrorRect.right - (rect.left - mirrorRect.left) - size,
                margin,
                Math.max(margin, viewportWidth - size - margin),
                rect.left,
            )
            : cinemaPlacement
            ? clampNumber(rect.left + rect.width / 2 - size / 2, margin, Math.max(margin, viewportWidth - size - margin), rect.left)
            : preferredLeft >= margin
            ? preferredLeft
            : Math.min(Math.max(fallbackLeft, margin), Math.max(margin, viewportWidth - size - margin));
            const top = mirroredCinemaPlacement
            ? clampNumber(rect.top + rect.height / 2 - size / 2, margin, Math.max(margin, viewportHeight - size - margin), rect.top)
            : cinemaPlacement
            ? clampNumber(rect.bottom + margin, margin, Math.max(margin, viewportHeight - size - margin), rect.bottom + margin)
            : clampNumber(rect.top + rect.height / 2 - size / 2, margin, Math.max(margin, viewportHeight - size - margin), rect.top);


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
                const player = getVisibleCinemaPlayerRoot(this.document, cinemaRoot);
                const moreButton = getVisibleCinemaMoreButton(this.document, cinemaRoot);
                const anchor = moreButton || getVisibleCinemaCloseButton(this.document, cinemaRoot);
                const mirrorSurface = moreButton ? null : player;
                const rect = this.actionBarLocator.getElementRect(anchor);
                const surfaceRect = this.actionBarLocator.getElementRect(mirrorSurface);
                return {
                    surface: "cinema",
                    mode: !this.openImageOverlay && anchor ? "cinema" : "inactive",
                    anchor,
                    mirrorSurface,
                    signature: rect
                    ? [
                        moreButton ? "cinema-more" : "cinema-close-mirror",
                        Math.round(rect.left),
                        Math.round(rect.top),
                        Math.round(rect.width),
                        Math.round(rect.height),
                        Math.round(surfaceRect?.left || 0),
                        Math.round(surfaceRect?.right || 0),
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
                    this.mountPanelLeftOfButton(
                        placement.anchor,
                        "cinema",
                        placement.mirrorSurface,
                    )
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

            const visibleMedia = this.extractor?.getVisibleMediaElement?.() || null;
            const visibleVideo = this.extractor?.getVisibleVideoElement?.() || null;
            const contexts = [...new Set([
                this.extractor?.getMediaContextElement?.(anchorElement),
                this.extractor?.getMediaContextElement?.(visibleMedia),
                this.extractor?.getMediaContextElement?.(visibleVideo),
            ].filter(Boolean))];
            if (contexts.some((context) => hasStrongLiveContextStructure(context))) return true;

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
            return buildVideoFilename(media, this.configStore.get(), suffix);
        }

        getImageFilename(media, image = {}, index = 0) {
            return buildImageFilename(media, image, index, this.configStore.get());
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
                version: "debug-full-v20",
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
                downloader: this.downloader?.getDebugSnapshot?.() || null,
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

        beginDownloadOperation() {
            this.downloadCancelRequested = false;
            const AbortControllerCtor = this.window.AbortController;
            this.downloadAbortController = typeof AbortControllerCtor === "function"
                ? new AbortControllerCtor()
            : null;
            return this.downloadAbortController?.signal || null;
        }

        finishDownloadOperation() {
            this.downloadAbortController = null;
            this.downloadCancelRequested = false;
        }

        async downloadVideo() {
            if (this.isDownloading) {
                this.notifications.nudgeDownloadStatus();
                return;
            }
            this.isDownloading = true;
            const signal = this.beginDownloadOperation();
            this.notifications.showDownloadPreparing();

            try {
                const media = await this.waitForCurrentMedia({
                    anchorElement: this.getCurrentActionAnchor(),
                });
                const images = ensureArray(media?.images).filter((image) => image?.url);
                if (
                    !this.downloadCancelRequested &&
                    !signal?.aborted &&
                    !media?.video?.primaryUrl &&
                    !images.length
                ) {
                    this.notifications.showDownloadError(this.getLastMediaErrorMessage());
                    return;
                }
                const result = await this.downloadResolvedMedia(media, { signal });
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
                this.finishDownloadOperation();
            }
        }

        async downloadAsset(url, filename, kind = "image") {
            if (this.isDownloading) {
                this.notifications.nudgeDownloadStatus();
                return;
            }
            this.isDownloading = true;
            const signal = this.beginDownloadOperation();

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
                    await this.downloader.downloadUrl(urls, filename, {}, signal);
                    this.notifications.showDownloadSuccess(filename);
                } catch (err) {
                    if (signal?.aborted || isDownloadCancelledError(err)) {
                        this.notifications.setDownloadStatus({
                            type: "error",
                            title: this.t("download_cancelled"),
                            detail: filename,
                        });
                    } else {
                        this.notifications.showDownloadError(err?.message || String(err));
                    }
                }
            } finally {
                this.isDownloading = false;
                this.finishDownloadOperation();
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
                maxLength: Number(config.filename_max_length || DEFAULT_CONFIG.filename_max_length),
                preserveExtension: true,
            });
        }

        async downloadOverlayImage() {
            const imageUrl = this.openImageOverlay?.imageUrl || "";
            const filename = imageUrl
            ? this.getOverlayImageFilename(this.currentMedia || {}, imageUrl)
            : "";
            return this.downloadAsset(imageUrl, filename, "image");
        }

        getFrameFilename(media = {}, extension = "png") {
            const config = this.configStore.get();
            const previewMedia = media?.id ? media : this.getFilenamePreviewMedia();
            const base = buildFilename(previewMedia, config) || `tiktok_frame_${Date.now()}`;
            return normalizeFilename(`${base}_frame.${normalizeFileExtension(extension, "png")}`, {
                maxLength: Number(config.filename_max_length || DEFAULT_CONFIG.filename_max_length),
                preserveExtension: true,
            });
        }

        getLiveFrameAuthorName(video = null) {
            const context =
                  this.extractor.getMediaContextElement(video) ||
                  video?.parentElement ||
                  null;
            const nickname = findLiveNicknameInReact([video?.parentElement, context]);
            if (nickname) return nickname;
            const authorLink =
                  context?.querySelector?.('a[data-e2e="video-author-avatar"][href*="/@"][href*="/live"]') ||
                  context?.querySelector?.('a[href*="/@"][href*="/live"]') ||
                  null;
            return getAuthorFromUrl(authorLink?.href || authorLink?.getAttribute?.("href") || "");
        }

        getCapturedFrameFilename(frame = {}, extension = "png") {
            if (!frame?.isLive) return this.getFrameFilename(frame?.media || {}, extension);
            const config = this.configStore.get();
            const authorName = String(frame.liveAuthorName || "").trim();
            const timestamp = formatDate(frame.capturedAt, "YYYYMMDDHHmmss").slice(2);
            const base = authorName
            ? `${authorName}_live_${timestamp}_frame`
                : `live_${timestamp}_frame`;
            return normalizeFilename(`${base}.${normalizeFileExtension(extension, "png")}`, {
                maxLength: Number(config.filename_max_length || DEFAULT_CONFIG.filename_max_length),
                preserveExtension: true,
            });
        }

        captureCurrentFrame(media = {}, anchorElement = null, options = {}) {
            this.mountPanel();
            const anchorContext = this.extractor.getMediaContextElement(anchorElement);
            const video =
                  this.extractor.getContextVideoElement(anchorContext) ||
                  (options.allowVisibleVideo ? this.extractor.getVisibleVideoElement() : null);
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
            const frame = {
                canvas,
                media,
                isLive: options.isLive === true,
                liveAuthorName: options.isLive === true ? this.getLiveFrameAuthorName(video) : "",
                capturedAt: new Date(),
                width: canvas.width,
                height: canvas.height,
                blobCache: new Map(),
            };
            frame.filename = this.getCapturedFrameFilename(frame);
            return frame;
        }

        getCapturedFrameBlob(frame, mimeType = "image/png") {
            if (!frame?.canvas) return Promise.reject(new Error("Canvas is unavailable."));
            frame.blobCache ||= new Map();
            if (frame.blobCache.has(mimeType)) return frame.blobCache.get(mimeType);
            const blobPromise = new Promise((resolve, reject) => {
                try {
                    frame.canvas.toBlob((value) => {
                        if (!value) {
                            reject(
                                new Error(
                                    "Canvas export failed. The video may be blocked by browser cross-origin restrictions.",
                                ),
                            );
                            return;
                        }
                        if (value.type && value.type !== mimeType) {
                            reject(new Error(`Canvas export format is unavailable: ${mimeType}`));
                            return;
                        }
                        resolve(value);
                    }, mimeType);
                } catch (err) {
                    reject(err);
                }
            }).catch((err) => {
                frame.blobCache.delete(mimeType);
                throw err;
            });
            frame.blobCache.set(mimeType, blobPromise);
            return blobPromise;
        }

        async copyFrameToClipboard(frame) {
            const ClipboardItem = this.window.ClipboardItem;
            if (!ClipboardItem || !this.window.navigator.clipboard?.write) {
                throw new Error(this.t("frame_copy_unsupported"));
            }
            const blob = await this.getCapturedFrameBlob(frame, "image/png");
            await this.window.navigator.clipboard.write([
                new ClipboardItem({ [blob.type || "image/png"]: blob }),
            ]);
        }

        async openFrameCapture() {
            try {
                const initialAnchor = this.getCurrentActionAnchor();
                const isLive = this.isCurrentLiveContext(initialAnchor);
                let frameAnchor = initialAnchor;
                let media = {};
                if (isLive) {
                    this.currentMedia = null;
                } else {
                    media = await this.waitForCurrentMedia({ anchorElement: initialAnchor });
                    if (!hasUsableMedia(media) || media?.isImagePost || ensureArray(media?.images).length) {
                        throw new Error(this.getLastMediaErrorMessage());
                    }
                    frameAnchor = initialAnchor?.isConnected
                        ? initialAnchor
                    : this.getCurrentActionAnchor();
                    const identityResult = this.currentItemResolver.resolve({
                        anchorElement: frameAnchor,
                        pageType: this.getCurrentPageType(),
                        isLive: false,
                    });
                    if (
                        !identityResult?.ok ||
                        String(identityResult.identity?.id || "") !== String(media.id || "")
                    ) {
                        throw new Error(this.t("current_item_not_found"));
                    }
                }
                const frame = this.captureCurrentFrame(media, frameAnchor, {
                    allowVisibleVideo: isLive,
                    isLive,
                });
                const modal = this.createModal(this.t("frame_title"), {
                    closeOnBackdrop: false,
                });
                modal.classList.add(`${SCRIPT_PREFIX}-frame-modal`);
                const main = modal.querySelector("main");
                const preview = frame.canvas;
                preview.className = `${SCRIPT_PREFIX}-frame-preview`;
                preview.setAttribute("role", "img");
                preview.setAttribute("aria-label", this.t("frame_title"));
                const meta = createElement(
                    this.document,
                    "p",
                    `${SCRIPT_PREFIX}-readonly`,
                    `${frame.width}x${frame.height} - ${frame.filename}`,
                );
                const actions = createElement(this.document, "div", `${SCRIPT_PREFIX}-row ${SCRIPT_PREFIX}-actions`);
                const formatControl = createElement(
                    this.document,
                    "label",
                    `${SCRIPT_PREFIX}-frame-format-control`,
                );
                formatControl.appendChild(
                    createElement(this.document, "span", "", this.t("format")),
                );
                const formatSelect = createElement(
                    this.document,
                    "select",
                    `${SCRIPT_PREFIX}-frame-format-select`,
                );
                for (const format of FRAME_SAVE_FORMATS) {
                    const option = createElement(this.document, "option", "", format.extension.toUpperCase());
                    option.value = format.extension;
                    formatSelect.appendChild(option);
                }
                formatSelect.value = FRAME_SAVE_FORMATS[0].extension;
                const getFrameSaveFormat = () =>
                FRAME_SAVE_FORMATS.find((format) => format.extension === formatSelect.value) ||
                      FRAME_SAVE_FORMATS[0];
                const updateFrameSaveFormat = () => {
                    const format = getFrameSaveFormat();
                    frame.filename = this.getCapturedFrameFilename(frame, format.extension);
                    meta.textContent = `${frame.width}x${frame.height} - ${frame.filename}`;
                };
                formatSelect.addEventListener("change", updateFrameSaveFormat);
                formatControl.appendChild(formatSelect);
                updateFrameSaveFormat();
                actions.append(
                    formatControl,
                    this.actionButton(this.t("copy_frame"), async () => {
                        try {
                            await this.copyFrameToClipboard(frame);
                            this.notifications.toast(this.t("frame_copied"));
                        } catch (err) {
                            this.notifications.toast(`${this.t("frame_copy_failed")}: ${err?.message || err}`);
                        }
                    }, "primary"),
                    this.actionButton(this.t("save_frame"), async () => {
                        try {
                            const format = getFrameSaveFormat();
                            const filename = this.getCapturedFrameFilename(frame, format.extension);
                            const blob = await this.getCapturedFrameBlob(frame, format.mimeType);
                            this.downloader.downloadBlob(blob, filename);
                        } catch (err) {
                            this.notifications.toast(`${this.t("frame_failed")}: ${err?.message || err}`);
                        }
                    }, "secondary"),
                );
                main.append(preview, meta, actions);
            } catch (err) {
                this.notifications.toast(`${this.t("frame_failed")}: ${err?.message || err}`);
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
            const modal = this.createModal(this.t("details_title"), { showHeader: false });
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
            const signal = context.signal || this.downloadAbortController?.signal || null;
            const cancelledResult = (
                successfulAssets = [],
                failedAssets = [],
                retryAssetIndexes = [],
                totalAssetCount = successfulAssets.length + failedAssets.length,
            ) => ({
                status: "cancelled",
                successfulAssets,
                failedAssets,
                retryAssetIndexes,
                totalAssetCount,
                message: this.t(bulk ? "bulk_download_cancelled" : "download_cancelled"),
            });
            if (this.downloadCancelRequested || signal?.aborted) {
                return cancelledResult();
            }
            const requestedImageIndexes = new Set(
                ensureArray(context.imageIndexes)
                .map((value) => Number(value))
                .filter((value) => Number.isInteger(value) && value > 0),
            );
            const imageEntries = ensureArray(media?.images)
            .filter((image) => image?.url)
            .map((image, index) => ({
                image,
                originalIndex: Math.max(0, Number(image.index || index + 1) - 1),
            }))
            .filter((entry) =>
                    !requestedImageIndexes.size || requestedImageIndexes.has(entry.originalIndex + 1),
                   );
            if (!media?.video?.primaryUrl && imageEntries.length) {
                const successfulAssets = [];
                const failedAssets = [];
                const getRetryAssetIndexes = () => {
                    const successfulIndexes = new Set(
                        successfulAssets
                        .map((asset) => Number(asset?.index))
                        .filter((value) => Number.isInteger(value) && value > 0),
                    );
                    return imageEntries
                        .map((entry) => entry.originalIndex + 1)
                        .filter((assetIndex) => !successfulIndexes.has(assetIndex));
                };
                for (let index = 0; index < imageEntries.length; index += 1) {
                    const entry = imageEntries[index];
                    const image = entry.image;
                    const originalIndex = entry.originalIndex;
                    const filename = this.getImageFilename(
                        media,
                        image,
                        originalIndex,
                    );
                    if (this.downloadCancelRequested || signal?.aborted) {
                        return cancelledResult(
                            successfulAssets,
                            failedAssets,
                            getRetryAssetIndexes(),
                            imageEntries.length,
                        );
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
                        const transfer = await this.downloader.downloadUrl(
                            unique([image.url, ...ensureArray(image.fallbackUrls)]),
                            filename,
                            {},
                            signal,
                        );
                        successfulAssets.push({
                            index: originalIndex + 1,
                            url: transfer?.url || image.url,
                            requestedUrl: transfer?.requestedUrl || image.url,
                            method: transfer?.method || "",
                            fallbackUsed: transfer?.fallbackUsed === true,
                            filename,
                        });
                    } catch (err) {
                        if (signal?.aborted || isDownloadCancelledError(err)) {
                            return cancelledResult(
                                successfulAssets,
                                failedAssets,
                                getRetryAssetIndexes(),
                                imageEntries.length,
                            );
                        }
                        failedAssets.push({
                            index: originalIndex + 1,
                            filename,
                            message: err?.message || String(err),
                            stage: "download-image",
                        });
                    }
                }
                if (!failedAssets.length) {
                    return {
                        status: "success",
                        successfulAssets,
                        failedAssets: [],
                        totalAssetCount: imageEntries.length,
                        filename: successfulAssets.at(-1)?.filename || "",
                    };
                }
                return {
                    status: successfulAssets.length ? "partial" : "failed",
                    successfulAssets,
                    failedAssets,
                    totalAssetCount: imageEntries.length,
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
            if (this.downloadCancelRequested || signal?.aborted) {
                return cancelledResult([], [], [], 1);
            }
            const filename = this.getFilename(
                media,
                media.video.format || "mp4",
            );
            if (!bulk) this.notifications.showVideoPreparing(filename);
            try {
                const transfer = await this.downloader.downloadUrl(
                    [
                        media.video.primaryUrl,
                        ...ensureArray(media.video.fallbackUrls),
                    ],
                    filename,
                    {},
                    signal,
                );
                return {
                    status: "success",
                    successfulAssets: [{
                        filename,
                        url: transfer?.url || media.video.primaryUrl,
                        requestedUrl: transfer?.requestedUrl || media.video.primaryUrl,
                        method: transfer?.method || "",
                        fallbackUsed: transfer?.fallbackUsed === true,
                    }],
                    failedAssets: [],
                    totalAssetCount: 1,
                    filename,
                };
            } catch (err) {
                if (signal?.aborted || isDownloadCancelledError(err)) {
                    return cancelledResult([], [], [], 1);
                }
                const message = err?.message || String(err);
                return {
                    status: "failed",
                    successfulAssets: [],
                    failedAssets: [{ filename, url: media.video.primaryUrl, message }],
                    totalAssetCount: 1,
                    message,
                };
            }
        }

        async downloadProfileBulkItems(items = [], options = {}) {
            const queue = ensureArray(items).filter(Boolean);
            if (!queue.length) {
                this.notifications.toast(this.t("bulk_no_selection"));
                return;
            }
            if (this.isDownloading) {
                this.notifications.nudgeDownloadStatus();
                return;
            }
            const retryFailedOnly = options.retryFailedOnly === true;
            const resumeCancelled = options.resumeCancelled === true;
            const previousResults = new Map(
                queue.map((item) => [item.id, item.bulkDownloadResult || null]),
            );
            this.isDownloading = true;
            const signal = this.beginDownloadOperation();
            queue.forEach((item) => {
                item.bulkDownloadResult = { status: "pending" };
            });
            let success = 0;
            let failed = 0;
            let cancelled = false;
            const runTrace = {
                startedAt: new Date().toISOString(),
                queueSize: queue.length,
                retryFailedOnly,
                resumeCancelled,
                results: [],
            };
            try {
                for (let index = 0; index < queue.length; index += 1) {
                    const item = queue[index];
                    if (this.downloadCancelRequested || signal?.aborted) {
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
                        if (this.downloadCancelRequested || signal?.aborted) {
                            cancelled = true;
                            break;
                        }
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
                        const previousResult = previousResults.get(item.id);
                        const retryImageIndexes = retryFailedOnly
                        ? ensureArray(previousResult?.failedAssetIndexes)
                        .map((value) => Number(value))
                        .filter((value) => Number.isInteger(value) && value > 0)
                        : [];
                        const resumeImageIndexes = resumeCancelled && previousResult?.status === "cancelled"
                        ? ensureArray(previousResult?.retryAssetIndexes)
                        .map((value) => Number(value))
                        .filter((value) => Number.isInteger(value) && value > 0)
                        : [];
                        const retryingAlbumAssets = Boolean(
                            retryImageIndexes.length &&
                            !media?.video?.primaryUrl &&
                            ensureArray(media?.images).length,
                        );
                        const resumingAlbumAssets = Boolean(
                            resumeImageIndexes.length &&
                            !media?.video?.primaryUrl &&
                            ensureArray(media?.images).length,
                        );
                        const requestedImageIndexes = retryingAlbumAssets
                        ? retryImageIndexes
                        : resumingAlbumAssets
                        ? resumeImageIndexes
                        : [];
                        const mergingAlbumAssets = retryingAlbumAssets || resumingAlbumAssets;
                        const result = await this.downloadResolvedMedia(media, {
                            bulk: true,
                            index: index + 1,
                            total: queue.length,
                            imageIndexes: requestedImageIndexes,
                            signal,
                        });
                        const resultSuccessfulAssets = ensureArray(result?.successfulAssets);
                        const resultFailedAssets = ensureArray(result?.failedAssets);
                        let status = result?.status || "failed";
                        let successfulAssetCount = resultSuccessfulAssets.length;
                        let totalAssetCount = Math.max(
                            0,
                            Number(result?.totalAssetCount || 0),
                        ) || successfulAssetCount + resultFailedAssets.length;
                        let failedAssetIndexes = resultFailedAssets
                        .map((asset) => Number(asset?.index))
                        .filter((value) => Number.isInteger(value) && value > 0);
                        let retryAssetIndexes = ensureArray(result?.retryAssetIndexes)
                        .map((value) => Number(value))
                        .filter((value) => Number.isInteger(value) && value > 0);

                        if (mergingAlbumAssets) {
                            const successfulIndexes = new Set(
                                resultSuccessfulAssets
                                .map((asset) => Number(asset?.index))
                                .filter((value) => Number.isInteger(value) && value > 0),
                            );
                            const remainingAssetIndexes = requestedImageIndexes.filter(
                                (assetIndex) => !successfulIndexes.has(assetIndex),
                            );
                            const previousSuccessfulAssetCount = Math.max(
                                0,
                                Number(previousResult?.successfulAssetCount || 0),
                            );
                            totalAssetCount = Math.max(
                                Number(previousResult?.totalAssetCount || 0),
                                previousSuccessfulAssetCount + requestedImageIndexes.length,
                            );
                            successfulAssetCount = Math.min(
                                totalAssetCount,
                                previousSuccessfulAssetCount + successfulIndexes.size,
                            );
                            if (status === "cancelled") {
                                retryAssetIndexes = remainingAssetIndexes;
                            } else {
                                failedAssetIndexes = remainingAssetIndexes;
                                retryAssetIndexes = [];
                                status = failedAssetIndexes.length
                                    ? successfulAssetCount > 0
                                    ? "partial"
                                : "failed"
                                : "success";
                            }
                        }

                        item.bulkDownloadResult = {
                            status,
                            successfulAssetCount,
                            totalAssetCount,
                            failedAssetIndexes,
                            retryAssetIndexes,
                        };
                        runTrace.results.push({
                            itemId: item.id || media.id || "",
                            mediaSource: media.extraction?.source || "",
                            status,
                            successfulAssetCount,
                            failedAssetCount: failedAssetIndexes.length || resultFailedAssets.length,
                            failedAssetIndexes,
                            retryAssetIndexes,
                            retryFailedOnly: retryingAlbumAssets,
                            resumeCancelled: resumingAlbumAssets || (resumeCancelled && previousResult?.status === "pending"),
                            downloadMethods: unique(resultSuccessfulAssets.map((asset) => asset?.method).filter(Boolean)),
                            fallbackAssetCount: resultSuccessfulAssets.filter((asset) => asset?.fallbackUsed).length,
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
                this.finishDownloadOperation();
                this.profilePageBulkAdapter?.refreshCheckboxStates?.();
            }
            if (cancelled || failed) this.profilePageBulkAdapter?.openConfirmModal?.();
        }

        requestDownloadCancel() {
            if (!this.isDownloading) return false;
            this.downloadCancelRequested = true;
            try {
                this.downloadAbortController?.abort?.();
            } catch (_err) {
            }
            return true;
        }

        buildSettingsFieldset(title, ...children) {
            const fieldset = createElement(this.document, "fieldset", `${SCRIPT_PREFIX}-detail-fieldset ${SCRIPT_PREFIX}-settings-fieldset`);
            fieldset.appendChild(createElement(this.document, "legend", "", title));
            children.filter(Boolean).forEach((child) => fieldset.appendChild(child));
            return fieldset;
        }

        buildSettingsAppearanceGrid(config) {
            const language = this.selectInput(
                this.t("language"),
                "language",
                config.language,
                LANGUAGE_OPTIONS,
            );
            const darkBootScreen = this.selectInput(
                this.t("dark_boot_screen"),
                "dark_boot_screen",
                config.dark_boot_screen,
                DARK_BOOT_SCREEN_MODES.map((definition) => [
                    definition.value,
                    this.t(definition.messageKey),
                ]),
            );

            const grid = createElement(this.document, "div", `${SCRIPT_PREFIX}-settings-grid`);
            grid.append(language.wrapper, darkBootScreen.wrapper);
            return grid;
        }

        buildSettingsDownloadGrid(config) {
            const quality = this.selectInput(
                this.t("video_resolution"),
                "video_quality",
                config.video_quality,
                VIDEO_QUALITY_OPTIONS.map((value) => [value, this.t(`quality_${value}`)]),
            );

            const grid = createElement(this.document, "div", `${SCRIPT_PREFIX}-settings-grid`);
            grid.append(quality.wrapper);

            const selectedSourceColumns = new Set(normalizeVideoSourceColumns(config.video_source_columns));
            const sourceColumns = this.fieldWrapper(this.t("source_columns"), "full");
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

        buildSettingsCommentTranslationGrid(config) {
            const provider = this.selectInput(
                this.t("comment_translation_provider"),
                "comment_translation_provider",
                config.comment_translation_provider,
                COMMENT_TRANSLATION_PROVIDERS.map((definition) => [
                    definition.value,
                    this.t(definition.messageKey),
                ]),
            );
            const target = this.selectInput(
                this.t("comment_translation_target"),
                "comment_translation_target",
                config.comment_translation_target,
                COMMENT_TRANSLATION_TARGETS,
            );
            const displayMode = this.selectInput(
                this.t("comment_translation_display_mode"),
                "comment_translation_display_mode",
                config.comment_translation_display_mode,
                COMMENT_TRANSLATION_DISPLAY_MODES.map((definition) => [
                    definition.value,
                    this.t(definition.messageKey),
                ]),
            );

            const autoOpen = this.selectInput(
                this.t("comment_translation_auto_open"),
                "comment_translation_auto_open",
                config.comment_translation_auto_open,
                COMMENT_TRANSLATION_ACTIVATION_MODES.map((definition) => [
                    definition.value,
                    this.t(definition.messageKey),
                ]),
            );

            const note = createElement(
                this.document,
                "div",
                `${SCRIPT_PREFIX}-settings-note full`,
                this.t("comment_translation_note"),
            );
            const grid = createElement(this.document, "div", `${SCRIPT_PREFIX}-settings-grid`);
            grid.append(
                provider.wrapper,
                target.wrapper,
                displayMode.wrapper,
                autoOpen.wrapper,
                note,
            );
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
            );
            maxLength.min = "8";
            maxLength.max = "255";
            maxLength.step = "1";
            const albumIndexFormat = this.selectInput(
                this.t("album_index_format"),
                "album_index_format",
                normalizeAlbumIndexFormat(config.album_index_format),
                ALBUM_INDEX_FORMAT_OPTIONS.map((definition) => [definition.value, definition.label]),
            );
            const filenameEditor = this.createFilenameTemplateEditor(config, {
                previewMedia: this.getFilenamePreviewMedia(),
                getMaxLength: () => Number(maxLength.value || config.filename_max_length || DEFAULT_CONFIG.filename_max_length),
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
            const modal = this.createModal(this.t("settings"), {
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
            const commentTranslationGrid = this.buildSettingsCommentTranslationGrid(config);
            const downloadGrid = this.buildSettingsDownloadGrid(config);
            const profileBulkGrid = this.buildSettingsProfileBulkGrid(config);
            const { grid: filenameGrid, filenameEditor } = this.buildSettingsFilenameGrid(config);
            const shortcutGrid = this.buildSettingsShortcutGrid(config);
            const { fieldset: advancedFieldset, showTestMenu, showDebugInfoMenu } =
                  this.buildSettingsAdvancedSection(config, settingsTitle);

            main.append(
                this.buildSettingsFieldset(this.t("appearance_section"), appearanceGrid),
                this.buildSettingsFieldset(this.t("comment_translation_section"), commentTranslationGrid),
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
                    formValues.filename_max_length = Number(formValues.filename_max_length || DEFAULT_CONFIG.filename_max_length);
                    formValues.profile_bulk_checkbox_size = clampNumber(
                        Number(formValues.profile_bulk_checkbox_size),
                        18,
                        40,
                        DEFAULT_CONFIG.profile_bulk_checkbox_size,
                    );
                    formValues.video_source_columns = Array.from(
                        modal.querySelectorAll("[data-source-column]:checked"),
                    ).map((input) => input.dataset.sourceColumn);
                    if (normalizeHotkey(formValues.shortcut_download) === "M") {
                        this.notifications.toast(this.t("shortcut_reserved_m"), { type: "error" });
                        return;
                    }
                    const shortcutConflict = findShortcutConflict(formValues);
                    if (shortcutConflict) {
                        const labels = {
                            shortcut_download: this.t("shortcut_download"),
                            shortcut_frame: this.t("shortcut_frame"),
                            shortcut_details: this.t("shortcut_details"),
                            shortcut_settings: this.t("shortcut_settings"),
                        };
                        this.notifications.toast(
                            this.t("shortcut_conflict")
                            .replace("${first}", labels[shortcutConflict.firstKey] || shortcutConflict.firstKey)
                            .replace("${second}", labels[shortcutConflict.secondKey] || shortcutConflict.secondKey)
                            .replace("${hotkey}", shortcutConflict.hotkey),
                            { type: "error" },
                        );
                        return;
                    }
                    const savedConfig = this.configStore.save({ ...formValues, ...filenameEditor.getValues() });
                    this.commentTranslation.handleSettingsChanged(config, savedConfig);
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
            );
            delete templateInput.dataset.configKey;
            const previewBlock = this.fieldWrapper(this.t("filename_preview"), "full");
            const previewValue = createElement(this.document, "div", `${SCRIPT_PREFIX}-filename-preview`);
            previewBlock.appendChild(previewValue);
            const renderPreview = () => {
                const previewConfig = {
                    ...config,
                    filename_template: getFilenameTemplate({ filename_template: templateInput.value }),
                    filename_max_length:
                    Number(options.getMaxLength?.() || config.filename_max_length || DEFAULT_CONFIG.filename_max_length) || DEFAULT_CONFIG.filename_max_length,
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
                chip.innerHTML = `<span>${escapeHtml(field)}</span><small>${escapeHtml(this.localizedMetadataLabel(metadata))}</small>`;
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
                chip.innerHTML = `<span>${escapeHtml(separator.display)}</span><small>${escapeHtml(this.localizedMetadataLabel(separator))}</small>`;
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

        localizedMetadataLabel(item) {
            const language = resolveLanguage(this.configStore.get(), this.window.navigator);
            return language === "zh" ? item?.zh || item?.en || "" : item?.en || item?.zh || "";
        }

        fieldWrapper(labelText, className = "") {
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

        input(labelText, type, key, value, className = "") {
            const wrapper = this.fieldWrapper(labelText, className);
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
        selectInput(labelText, key, value, options = []) {
            const select = this.input(labelText, "select", key, "");
            options.forEach(([optionValue, optionLabel]) => {
                const option = createElement(this.document, "option", "", optionLabel);
                option.value = optionValue;
                select.appendChild(option);
            });
            select.value = value ?? "";
            if (select.selectedIndex < 0 && select.options.length) select.selectedIndex = 0;
            return select;
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

        createModal(title, options = {}) {
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
                const heading = createElement(this.document, "h2", "", title);
                close = createTuxIconButton(this.document, this.t("close"));
                header.append(heading, close);
                modal.append(header, main);
            } else {
                modal.appendChild(main);
            }
            backdrop.appendChild(modal);

            const previousActiveElement = this.document.activeElement;
            let closed = false;
            const handleEscape = (event) => {
                if (event.key === "Escape" || event.key === "Esc") closeModal();
            };
            const closeModal = () => {
                if (closed) return;
                closed = true;
                this.document.removeEventListener("keydown", handleEscape, true);
                backdrop.remove();
                if (
                    previousActiveElement?.isConnected &&
                    typeof previousActiveElement.focus === "function"
                ) {
                    previousActiveElement.focus();
                }
            };

            modal.close = closeModal;
            close?.addEventListener("click", closeModal);
            if (options.closeOnBackdrop !== false) {
                backdrop.addEventListener("click", (event) => {
                    if (event.target === backdrop) closeModal();
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
                        this.clearCommentStickerTarget();
                        this.mountPanel();
                        this.applyPanelState();
                        this.commentTranslation.scheduleScan(80);
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
                if (this.pendingPanelPositionCheck) return;
                const now = Date.now();
                const elapsed = now - (this.lastPanelPositionCheckAt || 0);
                const delay = Math.max(0, PANEL_POSITION_CHECK_THROTTLE_MS - elapsed);
                this.pendingPanelPositionCheck = this.window.setTimeout(() => {
                    this.pendingPanelPositionCheck = null;
                    this.lastPanelPositionCheckAt = Date.now();
                    const signature = this.getPanelPositionSignature();
                    if (signature === this.lastPanelPositionSignature) return;
                    this.lastPanelPositionSignature = signature;
                    schedule();
                }, delay);
            };

            let imageOverlayTimer = null;
            const checkImageOverlay = () => {
                if (imageOverlayTimer) return;
                imageOverlayTimer = this.window.setTimeout(() => {
                    imageOverlayTimer = null;
                    this.refreshImageOverlayState();
                }, PANEL_POSITION_CHECK_THROTTLE_MS);
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
                    if (
                        this.openImageOverlay ||
                        Date.now() - this.lastImageOpenGestureAt <= IMAGE_OVERLAY_RECENT_GESTURE_MS
                    ) checkImageOverlay();
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
