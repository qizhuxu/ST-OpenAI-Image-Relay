// ═══════════════════════════════════════════════════════════════
// ST-OpenAI-Image-Relay — Plan C (Hybrid UI Architecture)
// SillyTavern 第三方扩展：AI 图片生成中继
// L0 (Panel) + L1 (FAB) + L2 (Floating Window)
// ═══════════════════════════════════════════════════════════════

import { extension_settings, getContext } from "../../../extensions.js";
import {
    eventSource,
    event_types,
    saveSettingsDebounced,
    updateMessageBlock,
    setExtensionPrompt,
    extension_prompt_types,
    extension_prompt_roles,
} from "../../../../script.js";
import { regexFromString } from "../../../utils.js";

// ═══════════════════════════════════════════════════════════════
// SECTION 1: IMPORTS & CONSTANTS
// ═══════════════════════════════════════════════════════════════

const extensionName = "ST-OpenAI-Image-Relay";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const mainPromptKey = `${extensionName}-MAIN-PROMPT`;
const markdownImageRegex = /!\[[^\]]*]\(([^)\s]+)\)/g;
const looseImageUrlRegex = /((?:https?:\/\/|\/)[^\s)"']+\.(?:png|jpe?g|webp|gif|bmp|svg)(?:\?[^\s)"']*)?)/gi;
const inFlightMessages = new Set();

// ═══════════════════════════════════════════════════════════════
// SECTION 2: DEFAULT SETTINGS & TEMPLATES
// ═══════════════════════════════════════════════════════════════

const DEFAULT_MAIN_PROMPT = [
    '在正常生成回复正文时，可以同时为当前这一次回复补充一条用于 image2 的绘图提示词，并将它放在正文末尾，格式必须为：',
    '',
    '<pic prompt="这里填写提示词">',
    '',
    '生成这条提示词时，必须严格遵守以下规则：',
    '',
    '1. 每次回复至多只能输出一条 `<pic prompt="...">`，不要输出多个，不要提供备选。',
    '2. `<pic prompt="...">` 里的内容必须始终是纯 SFW 的安全画面，不允许出现色情、裸露、性暗示、露骨身体描写、性行为、血腥重伤等内容。即使正文内容本身带有 NSFW 倾向，这条提示词也必须自动转化为安全、纯净、自然的 SFW 画面。',
    '3. 提示词内容必须使用中文连贯句子书写，而不是关键词堆砌。应充分利用强大的世界理解能力和文字生成能力，把画面描述成完整、自然、可直接用于生成单张图片的中文句子。',
    '4. 提示词应尽量与本次正文内容、场景、角色状态、环境氛围保持一致，但画面必须优先安全，可改写为人物立绘、日常场景、背景环境、建筑、街景、室内、道具展示、风景等适合 SFW 呈现的内容。',
    '5. 提示词中可以明确描述人物外观、服装、动作、表情、镜头、构图、光线、时间、天气、背景细节、环境气氛，也可以直接写出画面里应出现的中文文字内容、位置、样式或招牌文字。',
    '6. 提示词只服务于生成一张图片，因此内容必须统一、集中、明确，避免拆分成多幅画面，避免"第一张/第二张/"等表达。',
    '7. 除正文和这一条 `<pic prompt="...">` 外，不要输出任何额外说明，不要解释这条提示词的生成过程。',
    '',
    '如果当前回复内容明显不适合配图，或者没有合适的安全画面可提炼，则不要输出 `<pic prompt="...">`。',
].join('\n');

const DEFAULT_OPTIMIZE_TEMPLATE = [
    '你是一个专业的图片提示词优化专家。请将用户提供的简单描述优化为更详细、更有画面感的图片生成提示词。',
    '',
    '优化要求：',
    '1. 补充画面细节：光线、构图、色彩、氛围、视角、人物表情和动作等',
    '2. 使用更具描述性和视觉化的语言',
    '3. 保持原始描述的核心意图不变',
    '4. 输出纯优化后的提示词，不要包含任何解释、前言或后记',
    '5. 使用中文连贯句子描述，而不是关键词堆砌',
    '',
    '原始描述：',
    '{{prompt}}',
].join('\n');

const DEFAULT_NSFW_TEMPLATE = [
    '你是一个内容安全审查专家。请审查并修改以下图片生成提示词，确保其内容安全（SFW）。',
    '',
    '规则：',
    '1. 移除任何色情、裸露、性暗示、露骨身体描写、性行为的内容',
    '2. 移除任何血腥、暴力、重度伤害的描述',
    '3. 将不安全的内容替换为安全、自然、健康的替代描述（如改为人物立绘、日常场景、风景等）',
    '4. 保持提示词的整体画面意图和构图方向',
    '5. 如果原始提示词完全是安全的，直接原样返回不做修改',
    '6. 只输出修改后的提示词，不要包含任何解释',
    '',
    '原始提示词：',
    '{{prompt}}',
].join('\n');

const DEFAULT_SUMMARIZE_TEMPLATE = [
    '请将以下聊天消息内容转换为一张图片的生成提示词。',
    '',
    '要求：',
    '1. 提取消息中最有画面感的场景、角色动作或环境描写',
    '2. 将其转化为完整的图片描述，包含构图、光线、氛围等细节',
    '3. 确保内容安全（SFW），避免色情或暴力内容',
    '4. 使用中文连贯句子描述，而不是关键词堆砌',
    '5. 只输出提示词，不要包含解释',
    '',
    '消息内容：',
    '{{message}}',
].join('\n');

const defaultSettings = {
    // ─── 基础 ──────────────────────────────────────────────
    enabled: true,
    mainPrompt: DEFAULT_MAIN_PROMPT,

    // ─── 后端 ──────────────────────────────────────────────
    apiMode: "chat",                            // "chat" | "images"
    serviceUrl: "",
    apiKey: "",
    model: "",
    timeoutMs: 120000,
    promptTemplate: "请根据以下提示词生成图片，并且只返回最终图片。\n\n{{prompt}}",
    imagesPromptTemplate: "{{prompt}}",         // images API 模板（默认直通）
    imageSize: "1024x1024",
    imageCount: 1,
    imageResponseFormat: "url",                 // "url" | "b64_json"
    extraBody: "",

    // ─── 提取 ──────────────────────────────────────────────
    extractionRegex: '/<pic[^>]*\\sprompt="([^"]+)"[^>]*>/g',
    responseImageRegex: "/!\\[[^\\]]*\\]\\(([^)\\s]+)\\)/g",

    // ─── 优化 ──────────────────────────────────────────────
    optimizeEnabled: false,
    optimizeAuto: false,
    optimizeTemplate: DEFAULT_OPTIMIZE_TEMPLATE,
    optimizeApiUrl: "",
    optimizeModel: "",
    optimizeApiKey: "",

    // ─── NSFW 规避 ──────────────────────────────────────────
    nsfwAvoidance: false,
    nsfwAvoidanceTemplate: DEFAULT_NSFW_TEMPLATE,

    // ─── 消息生图 ──────────────────────────────────────────
    messageGenEnabled: true,
    summarizeTemplate: DEFAULT_SUMMARIZE_TEMPLATE,

    // ─── FAB & 浮动窗口 ─────────────────────────────────────
    fabEnabled: false,
    fabPosition: { x: null, y: null },
};

// ═══════════════════════════════════════════════════════════════
// SECTION 3: INITIALIZATION & EVENT WIRING
// ═══════════════════════════════════════════════════════════════

$(function () {
    (async function () {
        ensureSettings();
        applyMainPromptInjection();

        // ─── L0: 等待 SillyTavern 自动注入面板 HTML ──────
        waitForElement("#ST-OpenAI-Image-Relay-settings").then(() => {
            bindPanelEvents();
            syncAllUi();
            setStatus("就绪");
        }).catch((err) => {
            console.warn(`[${extensionName}] Panel element not found, falling back to manual injection`, err);
            // Fallback: 如果 SillyTavern 没有自动注入，手动注入
            const container = $("#extensions_settings");
            if (container.length > 0) {
                injectUiFallback(container);
            }
        });

        // ─── L1: 创建 FAB ─────────────────────────────────
        createFab();

        // ─── L2: 创建浮动窗口（隐藏） ─────────────────────
        createFloatingPanel();

        // ─── 事件监听 ──────────────────────────────────────
        eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);
        eventSource.on(event_types.MESSAGE_RENDERED, onMessageRendered);
    })();
});

/**
 * 等待指定元素出现在 DOM 中
 * @param {string} selector - CSS 选择器
 * @param {number} [timeout=10000] - 超时毫秒数
 * @returns {Promise<jQuery>}
 */
function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const el = $(selector);
        if (el.length) { resolve(el); return; }
        const timer = setInterval(() => {
            const el = $(selector);
            if (el.length) { clearInterval(timer); resolve(el); }
        }, 200);
        setTimeout(() => { clearInterval(timer); reject(new Error(`Timeout waiting for ${selector}`)); }, timeout);
    });
}

// ═══════════════════════════════════════════════════════════════
// SECTION 4: UI — PANEL INJECTION FALLBACK (L0)
// ═══════════════════════════════════════════════════════════════
// SillyTavern 通过 manifest.json 的 html 字段自动注入 settings_panel.html，
// 并将其包裹在 #ST-OpenAI-Image-Relay-settings 的 inline-drawer 中。
// 此函数仅在自动注入失败时作为回退使用。

async function injectUiFallback(container) {
    let htmlContent = "";

    try {
        htmlContent = await $.get(`${extensionFolderPath}/settings_panel.html`);
    } catch (error) {
        console.error(`[${extensionName}] Failed to load settings_panel.html`, error);
        return;
    }

    const drawerHtml = `
    <div id="ST-OpenAI-Image-Relay-settings" class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>🖼️ 图片中继</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content" style="display:none;">${htmlContent}</div>
    </div>`;

    container.prepend(drawerHtml);
    bindPanelEvents();
    syncAllUi();
    setStatus("就绪");
}

// ═══════════════════════════════════════════════════════════════
// SECTION 6: UI — FAB (L1)
// ═══════════════════════════════════════════════════════════════

function createFab() {
    if ($("#oair_fab").length > 0) return;

    const fab = $('<div id="oair_fab"><i class="fa-solid fa-image"></i></div>');
    $("body").append(fab);

    // 应用保存的位置或默认位置
    const settings = extension_settings[extensionName];
    if (settings.fabPosition && settings.fabPosition.x != null && settings.fabPosition.y != null) {
        fab.css({ left: settings.fabPosition.x + "px", top: settings.fabPosition.y + "px" });
    } else {
        // 默认：右下角 (right: 20px, bottom: 80px)
        fab.css({
            left: (window.innerWidth - 44 - 20) + "px",
            top: (window.innerHeight - 44 - 80) + "px",
        });
    }

    // 根据 fabEnabled 显示/隐藏
    if (settings.fabEnabled) {
        fab.addClass("oair-fab--visible");
    }

    // ─── 拖拽处理 ─────────────────────────────────────────
    let isDragging = false;
    let hasMoved = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    fab.on("mousedown", function (e) {
        e.preventDefault();
        isDragging = true;
        hasMoved = false;
        startX = e.clientX;
        startY = e.clientY;
        startLeft = fab.offset().left;
        startTop = fab.offset().top;

        $(document).on("mousemove.oair_fab", function (e2) {
            const dx = e2.clientX - startX;
            const dy = e2.clientY - startY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                hasMoved = true;
            }
            // 限制在视口内
            let newLeft = Math.max(0, Math.min(window.innerWidth - 44, startLeft + dx));
            let newTop = Math.max(0, Math.min(window.innerHeight - 44, startTop + dy));
            fab.css({
                left: newLeft + "px",
                top: newTop + "px",
                right: "auto",
                bottom: "auto",
            });
        });

        $(document).on("mouseup.oair_fab", function () {
            $(document).off(".oair_fab");
            isDragging = false;

            if (hasMoved) {
                // 保存位置到设置
                extension_settings[extensionName].fabPosition = {
                    x: fab.offset().left,
                    y: fab.offset().top,
                };
                saveSettingsDebounced();
            } else {
                // 点击：切换浮动窗口
                toggleFloatingPanel();
            }
        });
    });

    // ─── 触摸支持 ─────────────────────────────────────────
    fab.on("touchstart", function (e) {
        const touch = e.originalEvent.touches[0];
        isDragging = true;
        hasMoved = false;
        startX = touch.clientX;
        startY = touch.clientY;
        startLeft = fab.offset().left;
        startTop = fab.offset().top;

        $(document).on("touchmove.oair_fab", function (e2) {
            e2.preventDefault();
            const t = e2.originalEvent.touches[0];
            const dx = t.clientX - startX;
            const dy = t.clientY - startY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                hasMoved = true;
            }
            let newLeft = Math.max(0, Math.min(window.innerWidth - 44, startLeft + dx));
            let newTop = Math.max(0, Math.min(window.innerHeight - 44, startTop + dy));
            fab.css({
                left: newLeft + "px",
                top: newTop + "px",
                right: "auto",
                bottom: "auto",
            });
        });

        $(document).on("touchend.oair_fab", function () {
            $(document).off(".oair_fab");
            isDragging = false;

            if (hasMoved) {
                extension_settings[extensionName].fabPosition = {
                    x: fab.offset().left,
                    y: fab.offset().top,
                };
                saveSettingsDebounced();
            } else {
                toggleFloatingPanel();
            }
        });
    });
}

/**
 * 更新 FAB 视觉状态
 * @param {'idle'|'loading'|'success'|'error'} state
 */
function updateFabState(state) {
    const fab = $("#oair_fab");
    if (!fab.length) return;

    fab.removeClass("oair-fab--loading oair-fab--success oair-fab--error");

    if (state === "loading") {
        fab.addClass("oair-fab--loading");
    } else if (state === "success") {
        fab.addClass("oair-fab--success");
        setTimeout(() => fab.removeClass("oair-fab--success"), 2000);
    } else if (state === "error") {
        fab.addClass("oair-fab--error");
        setTimeout(() => fab.removeClass("oair-fab--error"), 3000);
    }
    // 'idle' → 无额外 class
}

// ═══════════════════════════════════════════════════════════════
// SECTION 7: UI — FLOATING PANEL (L2)
// ═══════════════════════════════════════════════════════════════

function createFloatingPanel() {
    if ($("#oair_floating_panel").length > 0) return;

    const panel = $(`
        <div id="oair_floating_panel">
            <div class="oair-floating-header">
                <h3>🖼️ 图片中继</h3>
                <button class="oair-floating-close" title="关闭"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="oair-floating-body"></div>
        </div>
    `);

    $("body").append(panel);

    // 居中定位
    const panelWidth = 480;
    const panelHeight = 600;
    panel.css({
        left: Math.max(20, (window.innerWidth - panelWidth) / 2) + "px",
        top: Math.max(20, (window.innerHeight - panelHeight) / 2) + "px",
    });

    // 关闭按钮
    panel.find(".oair-floating-close").on("click", () => toggleFloatingPanel(false));

    // ─── 标题栏拖拽 ──────────────────────────────────────
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    panel.find(".oair-floating-header").on("mousedown", function (e) {
        // 点击关闭按钮时不拖拽
        if ($(e.target).closest(".oair-floating-close").length) return;
        e.preventDefault();
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        startLeft = panel.offset().left;
        startTop = panel.offset().top;

        $(document).on("mousemove.oair_panel", function (e2) {
            const dx = e2.clientX - startX;
            const dy = e2.clientY - startY;
            panel.css({
                left: (startLeft + dx) + "px",
                top: (startTop + dy) + "px",
                right: "auto",
            });
        });

        $(document).on("mouseup.oair_panel", function () {
            $(document).off(".oair_panel");
            isDragging = false;
        });
    });

    // 触摸拖拽
    panel.find(".oair-floating-header").on("touchstart", function (e) {
        if ($(e.target).closest(".oair-floating-close").length) return;
        const touch = e.originalEvent.touches[0];
        isDragging = true;
        startX = touch.clientX;
        startY = touch.clientY;
        startLeft = panel.offset().left;
        startTop = panel.offset().top;

        $(document).on("touchmove.oair_panel", function (e2) {
            e2.preventDefault();
            const t = e2.originalEvent.touches[0];
            const dx = t.clientX - startX;
            const dy = t.clientY - startY;
            panel.css({
                left: (startLeft + dx) + "px",
                top: (startTop + dy) + "px",
                right: "auto",
            });
        });

        $(document).on("touchend.oair_panel", function () {
            $(document).off(".oair_panel");
            isDragging = false;
        });
    });

    // ─── 加载 settings_full.html 内容 ─────────────────────
    $.get(`${extensionFolderPath}/settings_full.html`)
        .then(function (html) {
            panel.find(".oair-floating-body").html(html);
            bindFloatingEvents();
            syncAllUi();
        })
        .catch(function (error) {
            console.error(`[${extensionName}] Failed to load settings_full.html`, error);
            panel.find(".oair-floating-body").html(
                '<div style="padding:20px; text-align:center; color:#ff9090;">' +
                '<p><b>配置页面加载失败</b></p>' +
                '<p style="font-size:0.85em; opacity:0.7;">请检查插件文件是否完整，或尝试重新安装插件。</p>' +
                '</div>'
            );
        });
}

/**
 * 显示/隐藏浮动窗口
 * @param {boolean} [show] - true=显示, false=隐藏, undefined=切换
 */
function toggleFloatingPanel(show) {
    const panel = $("#oair_floating_panel");
    if (!panel.length) return;

    if (typeof show === "undefined") {
        show = !panel.hasClass("oair-floating--visible");
    }

    if (show) {
        panel.addClass("oair-floating--visible");
        syncAllUi();
    } else {
        panel.removeClass("oair-floating--visible");
    }
}

// ═══════════════════════════════════════════════════════════════
// SECTION 8: UI — PANEL EVENT BINDING (L0)
// ═══════════════════════════════════════════════════════════════

function bindPanelEvents() {
    // ─── 面板设置 ─────────────────────────────────────────
    // 启用/禁用（双向同步）
    bindScopedInput("#oair_enabled", "#oair_fl_enabled", "enabled", ($el) => $el.prop("checked"));

    // FAB 开关
    bindScopedInput(null, null, "fabEnabled", null);
    // FAB 开关仅存在于面板
    $("#oair_fab_enabled").off("input.oair change.oair").on("change.oair", function () {
        extension_settings[extensionName].fabEnabled = $(this).prop("checked");
        saveSettingsDebounced();
        const fab = $("#oair_fab");
        if (extension_settings[extensionName].fabEnabled) {
            fab.addClass("oair-fab--visible");
        } else {
            fab.removeClass("oair-fab--visible");
        }
        syncAllUi();
    });

    // 打开浮动窗口按钮
    $("#oair_btn_open_floating").off("click.oair").on("click.oair", function (e) {
        e.preventDefault();
        toggleFloatingPanel(true);
    });

    // ─── 恢复默认设置按钮 ──────────────────────────────────
    $("#oair_btn_reset").off("click.oair").on("click.oair", function (e) {
        e.preventDefault();
        if (confirm("确定要恢复所有设置为默认值吗？此操作不可撤销。")) {
            extension_settings[extensionName] = structuredClone(defaultSettings);
            saveSettingsDebounced();
            applyMainPromptInjection();
            syncAllUi();
            setStatus("已恢复默认设置", "success");
        }
    });
}

// ═══════════════════════════════════════════════════════════════
// SECTION 9: UI — FLOATING EVENT BINDING (L2)
// ═══════════════════════════════════════════════════════════════

function bindFloatingEvents() {
    // ─── 基础设置 ──────────────────────────────────────────
    bindScopedInput(null, "#oair_fl_main_prompt", "mainPrompt", ($el) => $el.val());
    bindScopedInput(null, "#oair_fl_message_gen_enabled", "messageGenEnabled", ($el) => $el.prop("checked"));

    // ─── 后端设置 ──────────────────────────────────────────
    bindScopedInput(null, "#oair_fl_service_url", "serviceUrl", ($el) => $el.val());
    bindScopedInput(null, "#oair_fl_api_key", "apiKey", ($el) => $el.val());
    bindScopedInput(null, "#oair_fl_model", "model", ($el) => $el.val());
    bindScopedInput(null, "#oair_fl_timeout_ms", "timeoutMs", ($el) => Number($el.val()) || defaultSettings.timeoutMs);
    bindScopedInput(null, "#oair_fl_prompt_template", "promptTemplate", ($el) => $el.val());
    bindScopedInput(null, "#oair_fl_images_prompt_template", "imagesPromptTemplate", ($el) => $el.val());
    bindScopedInput(null, "#oair_fl_image_size", "imageSize", ($el) => $el.val());
    bindScopedInput(null, "#oair_fl_image_count", "imageCount", ($el) => Number($el.val()) || 1);
    bindScopedInput(null, "#oair_fl_image_response_format", "imageResponseFormat", ($el) => $el.val());
    bindScopedInput(null, "#oair_fl_extra_body", "extraBody", ($el) => $el.val());

    // API 模式切换（需要特殊处理字段可见性）
    $("#oair_fl_api_mode").off("change.oair").on("change.oair", function () {
        const isImagesMode = $(this).val() === "images";
        $("#oair_floating_panel .oair-images-api-fields").toggle(isImagesMode);
        $("#oair_floating_panel .oair-chat-api-fields").toggle(!isImagesMode);
        extension_settings[extensionName].apiMode = $(this).val();
        saveSettingsDebounced();
        applyMainPromptInjection();
        syncAllUi();
    });

    // ─── 提取设置 ──────────────────────────────────────────
    bindScopedInput(null, "#oair_fl_extraction_regex", "extractionRegex", ($el) => $el.val());
    bindScopedInput(null, "#oair_fl_response_image_regex", "responseImageRegex", ($el) => $el.val());

    // ─── 优化设置 ──────────────────────────────────────────
    bindScopedInput(null, "#oair_fl_optimize_enabled", "optimizeEnabled", ($el) => $el.prop("checked"));
    bindScopedInput(null, "#oair_fl_optimize_auto", "optimizeAuto", ($el) => $el.prop("checked"));
    bindScopedInput(null, "#oair_fl_optimize_template", "optimizeTemplate", ($el) => $el.val());
    bindScopedInput(null, "#oair_fl_optimize_api_url", "optimizeApiUrl", ($el) => $el.val());
    bindScopedInput(null, "#oair_fl_optimize_model", "optimizeModel", ($el) => $el.val());
    bindScopedInput(null, "#oair_fl_optimize_api_key", "optimizeApiKey", ($el) => $el.val());

    // ─── NSFW 规避 ──────────────────────────────────────────
    bindScopedInput(null, "#oair_fl_nsfw_avoidance", "nsfwAvoidance", ($el) => $el.prop("checked"));
    bindScopedInput(null, "#oair_fl_nsfw_avoidance_template", "nsfwAvoidanceTemplate", ($el) => $el.val());

    // ─── 消息生图 ──────────────────────────────────────────
    bindScopedInput(null, "#oair_fl_summarize_template", "summarizeTemplate", ($el) => $el.val());

    // ─── 手动生图 ──────────────────────────────────────────
    $("#oair_fl_btn_manual_gen").off("click.oair").on("click.oair", (e) => { e.preventDefault(); manualGenerate(); });
    $("#oair_fl_btn_optimize").off("click.oair").on("click.oair", (e) => { e.preventDefault(); manualOptimize(); });
    $("#oair_fl_btn_clear_manual").off("click.oair").on("click.oair", (e) => {
        e.preventDefault();
        $("#oair_fl_manual_preview").empty();
        $("#oair_fl_manual_optimized_prompt").hide();
        $("#oair_fl_manual_optimized_text").text("");
        setStatus("预览已清空");
    });
}

/**
 * 双向绑定辅助：绑定面板和浮动窗口中的同一设置输入
 * @param {string|null} panelSelector - 面板中的选择器
 * @param {string|null} floatingSelector - 浮动窗口中的选择器
 * @param {string} key - extension_settings 中的键名
 * @param {function|null} getter - 从 jQuery 元素取值的函数
 */
function bindScopedInput(panelSelector, floatingSelector, key, getter) {
    if (panelSelector && $(panelSelector).length) {
        $(panelSelector).off("input.oair change.oair").on("input.oair change.oair", function () {
            extension_settings[extensionName][key] = getter($(panelSelector));
            saveSettingsDebounced();
            applyMainPromptInjection();
            syncAllUi();
        });
    }
    if (floatingSelector && $(floatingSelector).length) {
        $(floatingSelector).off("input.oair change.oair").on("input.oair change.oair", function () {
            extension_settings[extensionName][key] = getter($(floatingSelector));
            saveSettingsDebounced();
            applyMainPromptInjection();
            syncAllUi();
        });
    }
}

// ═══════════════════════════════════════════════════════════════
// SECTION 10: UI — SETTINGS SYNC
// ═══════════════════════════════════════════════════════════════

function syncAllUi() {
    const s = extension_settings[extensionName];

    // ─── 面板 (L0) ────────────────────────────────────────
    $("#ST-OpenAI-Image-Relay-settings #oair_enabled").prop("checked", !!s.enabled);
    $("#ST-OpenAI-Image-Relay-settings #oair_fab_enabled").prop("checked", !!s.fabEnabled);

    // ─── 浮动窗口 (L2) ───────────────────────────────────
    // 基础
    $("#oair_fl_enabled").prop("checked", !!s.enabled);
    $("#oair_fl_main_prompt").val(s.mainPrompt || "");
    $("#oair_fl_message_gen_enabled").prop("checked", s.messageGenEnabled !== false);

    // 后端
    $("#oair_fl_api_mode").val(s.apiMode || "chat");
    $("#oair_fl_service_url").val(s.serviceUrl || "");
    $("#oair_fl_api_key").val(s.apiKey || "");
    $("#oair_fl_model").val(s.model || "");
    $("#oair_fl_timeout_ms").val(Number(s.timeoutMs) || defaultSettings.timeoutMs);
    $("#oair_fl_prompt_template").val(s.promptTemplate || "");
    $("#oair_fl_images_prompt_template").val(s.imagesPromptTemplate || "");
    $("#oair_fl_image_size").val(s.imageSize || "1024x1024");
    $("#oair_fl_image_count").val(Number(s.imageCount) || 1);
    $("#oair_fl_image_response_format").val(s.imageResponseFormat || "url");
    $("#oair_fl_extra_body").val(s.extraBody || "");

    // API 模式字段可见性（浮动窗口内）
    const isImagesMode = (s.apiMode || "chat") === "images";
    $("#oair_floating_panel .oair-images-api-fields").toggle(isImagesMode);
    $("#oair_floating_panel .oair-chat-api-fields").toggle(!isImagesMode);

    // 提取
    $("#oair_fl_extraction_regex").val(s.extractionRegex || "");
    $("#oair_fl_response_image_regex").val(s.responseImageRegex || "");

    // 优化
    $("#oair_fl_optimize_enabled").prop("checked", !!s.optimizeEnabled);
    $("#oair_fl_optimize_auto").prop("checked", !!s.optimizeAuto);
    $("#oair_fl_optimize_template").val(s.optimizeTemplate || "");
    $("#oair_fl_optimize_api_url").val(s.optimizeApiUrl || "");
    $("#oair_fl_optimize_model").val(s.optimizeModel || "");
    $("#oair_fl_optimize_api_key").val(s.optimizeApiKey || "");

    // NSFW 规避
    $("#oair_fl_nsfw_avoidance").prop("checked", !!s.nsfwAvoidance);
    $("#oair_fl_nsfw_avoidance_template").val(s.nsfwAvoidanceTemplate || "");

    // 消息生图
    $("#oair_fl_summarize_template").val(s.summarizeTemplate || "");
}

// ═══════════════════════════════════════════════════════════════
// SECTION 11: MAIN PROMPT INJECTION & HELPERS
// ═══════════════════════════════════════════════════════════════

function ensureSettings() {
    const current = extension_settings[extensionName] || {};
    extension_settings[extensionName] = {
        ...structuredClone(defaultSettings),
        ...current,
    };
}

function applyMainPromptInjection() {
    const settings = extension_settings[extensionName];
    const prompt = String(settings?.mainPrompt || "").trim();

    if (!settings?.enabled || !prompt) {
        setExtensionPrompt(mainPromptKey, "", extension_prompt_types.NONE, 0, false, extension_prompt_roles.SYSTEM);
        return;
    }

    setExtensionPrompt(
        mainPromptKey,
        prompt,
        extension_prompt_types.BEFORE_PROMPT,
        0,
        false,
        extension_prompt_roles.SYSTEM,
    );
}

/**
 * 更新状态（面板 + 浮动窗口）
 */
function setStatus(text, kind = "info") {
    const colors = {
        info: "cyan",
        success: "#90ff90",
        warning: "#ffd280",
        error: "#ff9090",
    };
    const color = colors[kind] || colors.info;

    // 面板状态
    $("#oair_status").text(text).css("color", color);
    // 浮动窗口状态
    $("#oair_fl_status").text(text).css("color", color);

    // 同步 FAB 状态
    if (kind === "success") {
        updateFabState("success");
    } else if (kind === "error") {
        updateFabState("error");
    } else if (kind === "info" && (text.includes("正在") || text.includes("处理中") || text.includes("生图"))) {
        updateFabState("loading");
    } else {
        updateFabState("idle");
    }
}

function setButtonLoading(selector, loading) {
    const btn = $(selector);
    if (loading) {
        btn.data("original-text", btn.html());
        btn.prop("disabled", true).html('<i class="fa-solid fa-spinner fa-spin"></i> 处理中...');
    } else {
        btn.prop("disabled", false).html(btn.data("original-text") || btn.html());
    }
}

// ═══════════════════════════════════════════════════════════════
// SECTION 12: PROMPT PIPELINE (optimize + sanitize)
// ═══════════════════════════════════════════════════════════════

/**
 * 通用 LLM 调用 — 始终使用 /v1/chat/completions
 */
async function callLlmForText(systemPrompt, userPrompt) {
    const settings = extension_settings[extensionName];
    const apiUrl = String(settings.optimizeApiUrl || "").trim() || settings.serviceUrl;
    const model = String(settings.optimizeModel || "").trim() || settings.model;
    const apiKey = String(settings.optimizeApiKey || "").trim() || settings.apiKey;
    const endpoint = resolveChatCompletionsUrl(apiUrl);

    const body = {
        model,
        stream: false,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
        ],
    };

    const headers = { "Content-Type": "application/json" };
    if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
    }

    const responseText = await fetchWithTimeout(
        endpoint,
        { method: "POST", headers, body: JSON.stringify(body) },
        Number(settings.timeoutMs) || defaultSettings.timeoutMs,
    );

    const data = parseBackendPayload(responseText);
    return extractContentFromPayload(data).trim();
}

/**
 * 使用 LLM 优化提示词
 */
async function optimizePrompt(prompt) {
    const settings = extension_settings[extensionName];
    if (!settings.optimizeEnabled) return prompt;

    const template = settings.optimizeTemplate || defaultSettings.optimizeTemplate;
    const systemPrompt = "你是一个专业的图片提示词优化专家。";
    const userMessage = renderPrompt(template, prompt);

    try {
        const result = await callLlmForText(systemPrompt, userMessage);
        return result || prompt;
    } catch (error) {
        console.warn(`[${extensionName}] Prompt optimization failed, using original`, error);
        return prompt;
    }
}

/**
 * NSFW 安全审查 — 使用 LLM 净化提示词
 */
async function sanitizePrompt(prompt) {
    const settings = extension_settings[extensionName];
    if (!settings.nsfwAvoidance) return prompt;

    const template = settings.nsfwAvoidanceTemplate || defaultSettings.nsfwAvoidanceTemplate;
    const systemPrompt = "你是一个内容安全审查专家。";
    const userMessage = renderPrompt(template, prompt);

    try {
        const result = await callLlmForText(systemPrompt, userMessage);
        return result || prompt;
    } catch (error) {
        console.warn(`[${extensionName}] NSFW sanitization failed, using original prompt`, error);
        return prompt;
    }
}

/**
 * 提示词处理流水线：原始 → 优化 → 安全审查
 * @param {string} prompt - 原始提示词
 * @param {object} options - { forceOptimize: boolean }
 */
async function processPromptPipeline(prompt, options = {}) {
    const settings = extension_settings[extensionName];

    // Step 1: 优化（如果启用且满足条件）
    const shouldOptimize = options.forceOptimize || settings.optimizeAuto;
    if (settings.optimizeEnabled && shouldOptimize) {
        setStatus("正在优化提示词...", "info");
        prompt = await optimizePrompt(prompt);
    }

    // Step 2: NSFW 安全审查（如果启用）
    if (settings.nsfwAvoidance) {
        setStatus("正在安全审查...", "info");
        prompt = await sanitizePrompt(prompt);
    }

    return prompt;
}

// ═══════════════════════════════════════════════════════════════
// SECTION 13: IMAGE REQUEST — DISPATCHER
// ═══════════════════════════════════════════════════════════════

/**
 * 图片请求分发器 — 根据 apiMode 选择不同后端
 */
async function requestImagesFromBackend(prompt) {
    const settings = extension_settings[extensionName];
    if (settings.apiMode === "images") {
        return requestViaImagesGenerations(prompt);
    }
    return requestViaChatCompletions(prompt);
}

// ═══════════════════════════════════════════════════════════════
// SECTION 14: IMAGE REQUEST — CHAT COMPLETIONS MODE
// ═══════════════════════════════════════════════════════════════

async function requestViaChatCompletions(prompt) {
    const settings = extension_settings[extensionName];
    const endpoint = resolveChatCompletionsUrl(settings.serviceUrl);
    const userPrompt = renderPrompt(settings.promptTemplate, prompt);
    const extraBody = parseOptionalJson(settings.extraBody, "额外请求体 JSON");

    const body = {
        ...extraBody,
        model: String(settings.model || defaultSettings.model),
        stream: false,
        messages: [{ role: "user", content: userPrompt }],
    };

    const headers = {
        "Content-Type": "application/json",
    };

    const apiKey = String(settings.apiKey || "").trim();
    if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
    }

    const responseText = await fetchWithTimeout(
        endpoint,
        {
            method: "POST",
            headers,
            body: JSON.stringify(body),
        },
        Number(settings.timeoutMs) || defaultSettings.timeoutMs,
    );

    const data = parseBackendPayload(responseText);
    const content = extractContentFromPayload(data);
    const images = extractImagesFromPayload(data, endpoint, settings.responseImageRegex);

    return {
        images,
        content,
        raw: data,
    };
}

// ═══════════════════════════════════════════════════════════════
// SECTION 15: IMAGE REQUEST — IMAGES API MODE
// ═══════════════════════════════════════════════════════════════

/**
 * 解析服务地址为 /v1/images/generations 端点
 */
function resolveImagesApiUrl(rawUrl) {
    const input = String(rawUrl || "").trim();
    if (!input) {
        throw new Error("服务地址不能为空。");
    }

    let url;
    try {
        url = new URL(input);
    } catch {
        throw new Error("服务地址格式无效。");
    }

    const pathname = url.pathname.replace(/\/+$/, "");

    // 已经是 images/generations 结尾
    if (/\/images\/generations$/i.test(pathname)) {
        return url.toString();
    }

    // 是 /v1/chat/completions 结尾 → 替换为 /v1/images/generations
    if (/\/chat\/completions$/i.test(pathname)) {
        url.pathname = pathname.replace(/\/chat\/completions$/i, "") + "/images/generations";
        return url.toString();
    }

    // 是 /v1 结尾 → 追加 /images/generations
    if (/\/v\d+$/i.test(pathname)) {
        url.pathname = `${pathname}/images/generations`;
        return url.toString();
    }

    // 其他 → 直接追加
    url.pathname = `${pathname}/v1/images/generations`;
    return url.toString();
}

/**
 * 通过 /v1/images/generations 接口生图
 */
async function requestViaImagesGenerations(prompt) {
    const settings = extension_settings[extensionName];
    const endpoint = resolveImagesApiUrl(settings.serviceUrl);
    const template = settings.imagesPromptTemplate || defaultSettings.imagesPromptTemplate;
    const finalPrompt = renderPrompt(template, prompt);
    const extraBody = parseOptionalJson(settings.extraBody, "额外请求体 JSON");

    const body = {
        ...extraBody,
        model: String(settings.model || defaultSettings.model),
        prompt: finalPrompt,
        n: Number(settings.imageCount) || 1,
        size: String(settings.imageSize || "1024x1024"),
        response_format: String(settings.imageResponseFormat || "url"),
    };

    const headers = {
        "Content-Type": "application/json",
    };

    const apiKey = String(settings.apiKey || "").trim();
    if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
    }

    const responseText = await fetchWithTimeout(
        endpoint,
        {
            method: "POST",
            headers,
            body: JSON.stringify(body),
        },
        Number(settings.timeoutMs) || defaultSettings.timeoutMs,
    );

    const data = parseBackendPayload(responseText);
    const images = extractImagesFromImagesApiResponse(data);

    return {
        images,
        content: "",
        raw: data,
    };
}

/**
 * 解析 /v1/images/generations 响应
 */
function extractImagesFromImagesApiResponse(data) {
    const images = [];

    if (Array.isArray(data?.data)) {
        for (const item of data.data) {
            if (typeof item === "string" && looksLikeImageRef(item)) {
                images.push(item);
                continue;
            }

            if (!item || typeof item !== "object") continue;

            if (item.url) {
                images.push(item.url);
            }
            if (item.b64_json) {
                const fmt = String(item.format || "png").toLowerCase();
                images.push(`data:image/${fmt};base64,${item.b64_json}`);
            }
        }
    }

    // 兜底：检查顶层 images 字段
    if (Array.isArray(data?.images)) {
        for (const item of data.images) {
            if (typeof item === "string" && looksLikeImageRef(item)) {
                images.push(item);
            } else if (item?.url) {
                images.push(item.url);
            } else if (item?.b64_json) {
                const fmt = String(item.format || "png").toLowerCase();
                images.push(`data:image/${fmt};base64,${item.b64_json}`);
            }
        }
    }

    return dedupeStrings(images);
}

// ═══════════════════════════════════════════════════════════════
// SECTION 16: MESSAGE PROCESSING (auto pipeline)
// ═══════════════════════════════════════════════════════════════

async function onMessageReceived(messageId) {
    const settings = extension_settings[extensionName];
    if (!settings?.enabled || !Number.isInteger(messageId)) {
        return;
    }

    const context = getContext();
    const message = context.chat?.[messageId];
    if (!message || message.is_user || message.is_system || !message.mes) {
        return;
    }

    let extractionRegex;
    try {
        extractionRegex = parseRegex(settings.extractionRegex, "提取提示词正则");
    } catch (error) {
        setStatus(error.message, "error");
        return;
    }

    const matches = collectMatches(message.mes, extractionRegex);
    if (!matches.length) {
        return;
    }

    const inFlightKey = `${context.chatId || "chat"}:${messageId}`;
    if (inFlightMessages.has(inFlightKey)) {
        return;
    }

    inFlightMessages.add(inFlightKey);
    setStatus(`正在处理 ${matches.length} 处匹配...`, "info");

    try {
        const replacements = [];
        const collectedImages = [];
        const collectedTitles = [];
        let successCount = 0;

        for (const match of matches) {
            let prompt = String(match.capture || "").trim();
            if (!prompt) {
                replacements.push(match.fullMatch);
                continue;
            }

            // 运行提示词处理流水线
            prompt = await processPromptPipeline(prompt, { forceOptimize: false });

            const result = await requestImagesFromBackend(prompt);
            if (!result.images.length) {
                replacements.push(match.fullMatch);
                continue;
            }

            replacements.push("");
            collectedImages.push(...result.images);
            collectedTitles.push(prompt);
            successCount += 1;
        }

        if (!successCount) {
            setStatus("未检测到图片输出", "warning");
            return;
        }

        message.mes = cleanupMessageText(applyReplacements(message.mes, matches, replacements));
        message.extra = message.extra || {};
        attachGeneratedImages(message, collectedImages, collectedTitles);
        message.extra[extensionName] = {
            lastRunAt: Date.now(),
            replacements: successCount,
            images: dedupeStrings(collectedImages).length,
        };

        updateMessageBlock(messageId, message);
        await context.saveChat();
        setStatus(`已替换 ${successCount} 处匹配`, "success");
    } catch (error) {
        console.error(`[${extensionName}] Message processing failed`, error);
        setStatus(error.message, "error");
        toastr.error(error.message);
    } finally {
        inFlightMessages.delete(inFlightKey);
    }
}

// ═══════════════════════════════════════════════════════════════
// SECTION 17: MANUAL GENERATION
// ═══════════════════════════════════════════════════════════════

async function manualGenerate() {
    let prompt = String($("#oair_fl_manual_prompt").val() || "").trim();
    if (!prompt) {
        toastr.warning("请先输入提示词。");
        return;
    }

    setStatus("手动生图中...", "info");
    setButtonLoading("#oair_fl_btn_manual_gen", true);
    updateFabState("loading");

    try {
        // 如果有优化后的提示词，使用优化版本
        const optimizedText = String($("#oair_fl_manual_optimized_text").text() || "").trim();
        if (optimizedText) {
            prompt = optimizedText;
        }

        // 运行 NSFW 安全审查
        prompt = await sanitizePrompt(prompt);

        const result = await requestImagesFromBackend(prompt);
        renderManualPreview(result.images, result.content);

        if (result.images.length > 0) {
            setStatus(`已生成 ${result.images.length} 张图片`, "success");
            toastr.success(`已生成 ${result.images.length} 张图片。`);
        } else {
            setStatus("未检测到图片输出", "warning");
            toastr.warning("后端没有返回图片结果。");
        }
    } catch (error) {
        console.error(`[${extensionName}] Manual generation failed`, error);
        setStatus(error.message, "error");
        toastr.error(error.message);
    } finally {
        setButtonLoading("#oair_fl_btn_manual_gen", false);
        updateFabState("idle");
    }
}

async function manualOptimize() {
    const prompt = String($("#oair_fl_manual_prompt").val() || "").trim();
    if (!prompt) {
        toastr.warning("请先输入提示词。");
        return;
    }

    const settings = extension_settings[extensionName];
    if (!settings.optimizeEnabled) {
        toastr.warning("请先在「优化」标签页启用提示词优化功能。");
        return;
    }

    setStatus("正在优化提示词...", "info");
    setButtonLoading("#oair_fl_btn_optimize", true);

    try {
        const optimized = await optimizePrompt(prompt);
        if (optimized && optimized !== prompt) {
            $("#oair_fl_manual_optimized_text").text(optimized);
            $("#oair_fl_manual_optimized_prompt").show();
            setStatus("提示词已优化", "success");
            toastr.success("提示词优化完成，可查看优化结果。");
        } else if (optimized === prompt) {
            setStatus("提示词无需优化", "info");
            toastr.info("优化结果与原始提示词相同，将使用原始提示词。");
        } else {
            setStatus("优化失败，将使用原始提示词", "warning");
        }
    } catch (error) {
        console.error(`[${extensionName}] Manual optimization failed`, error);
        setStatus(error.message, "error");
        toastr.error(error.message);
    } finally {
        setButtonLoading("#oair_fl_btn_optimize", false);
    }
}

function renderManualPreview(images, content = "") {
    const preview = $("#oair_fl_manual_preview");
    preview.empty();

    for (const imageUrl of images) {
        $("<img>")
            .attr("src", imageUrl)
            .css({
                width: "100%",
                maxWidth: "100%",
                borderRadius: "6px",
                cursor: "pointer",
            })
            .on("click", () => window.open(imageUrl, "_blank"))
            .appendTo(preview);
    }

    if (!images.length && content) {
        $("<pre>")
            .text(content)
            .css({
                whiteSpace: "pre-wrap",
                margin: 0,
                padding: "8px",
                background: "rgba(0,0,0,0.2)",
                borderRadius: "6px",
                fontSize: "0.8em",
            })
            .appendTo(preview);
    }
}

// ═══════════════════════════════════════════════════════════════
// SECTION 18: MESSAGE IMAGE GENERATION (feat 6 & 7)
// ═══════════════════════════════════════════════════════════════

/**
 * 消息渲染时注入生图按钮
 */
function onMessageRendered(messageId) {
    const settings = extension_settings[extensionName];
    if (!settings?.enabled || settings.messageGenEnabled === false) return;

    const mesBlock = $(`.mes[mesid="${messageId}"]`);
    if (!mesBlock.length) return;

    // 避免重复注入
    if (mesBlock.find('.oair-msg-action').length) return;

    const buttonsArea = mesBlock.find('.mes_buttons');
    if (!buttonsArea.length) return;

    // 「使用此消息内容生图」按钮
    $('<div class="oair-msg-action mes_button" title="使用此消息内容生图">')
        .html('<i class="fa-solid fa-image"></i>')
        .on('click', (e) => {
            e.stopPropagation();
            generateFromMessage(messageId);
        })
        .appendTo(buttonsArea);

    // 「总结此消息并生图」按钮
    $('<div class="oair-msg-action mes_button" title="总结此消息并生图">')
        .html('<i class="fa-solid fa-wand-magic-sparkles"></i>')
        .on('click', (e) => {
            e.stopPropagation();
            summarizeAndGenerate(messageId);
        })
        .appendTo(buttonsArea);
}

/**
 * 使用消息内容直接生图
 */
async function generateFromMessage(messageId) {
    const settings = extension_settings[extensionName];
    const context = getContext();
    const message = context.chat?.[messageId];
    if (!message?.mes) {
        toastr.warning("无法读取消息内容。");
        return;
    }

    let prompt = stripHtmlTags(message.mes).trim();
    if (!prompt) {
        toastr.warning("消息内容为空。");
        return;
    }

    const inFlightKey = `msg:${context.chatId || "chat"}:${messageId}`;
    if (inFlightMessages.has(inFlightKey)) return;
    inFlightMessages.add(inFlightKey);

    try {
        setStatus("正在从消息生图...", "info");
        prompt = await processPromptPipeline(prompt, { forceOptimize: false });
        const result = await requestImagesFromBackend(prompt);

        if (result.images.length > 0) {
            attachGeneratedImages(message, result.images, [prompt]);
            message.extra = message.extra || {};
            message.extra[extensionName] = {
                lastRunAt: Date.now(),
                source: "message-gen",
            };
            updateMessageBlock(messageId, message);
            await context.saveChat();
            setStatus("消息生图完成", "success");
            toastr.success("消息生图完成！");
        } else {
            setStatus("未检测到图片输出", "warning");
            toastr.warning("后端没有返回图片结果。");
        }
    } catch (error) {
        console.error(`[${extensionName}] Message generation failed`, error);
        setStatus(error.message, "error");
        toastr.error(error.message);
    } finally {
        inFlightMessages.delete(inFlightKey);
    }
}

/**
 * 总结消息内容并生图
 */
async function summarizeAndGenerate(messageId) {
    const settings = extension_settings[extensionName];
    const context = getContext();
    const message = context.chat?.[messageId];
    if (!message?.mes) {
        toastr.warning("无法读取消息内容。");
        return;
    }

    const inFlightKey = `sum:${context.chatId || "chat"}:${messageId}`;
    if (inFlightMessages.has(inFlightKey)) return;
    inFlightMessages.add(inFlightKey);

    try {
        setStatus("正在总结消息...", "info");
        const prompt = await summarizeMessageToPrompt(message.mes);
        if (!prompt) {
            setStatus("总结失败", "warning");
            toastr.warning("消息总结失败，请检查优化配置。");
            return;
        }

        setStatus("正在生图...", "info");
        // 总结模板已包含 SFW 指令，但额外运行安全审查
        const sanitizedPrompt = await sanitizePrompt(prompt);
        const result = await requestImagesFromBackend(sanitizedPrompt);

        if (result.images.length > 0) {
            attachGeneratedImages(message, result.images, [prompt]);
            message.extra = message.extra || {};
            message.extra[extensionName] = {
                lastRunAt: Date.now(),
                source: "summarize-gen",
            };
            updateMessageBlock(messageId, message);
            await context.saveChat();
            setStatus("总结生图完成", "success");
            toastr.success("总结生图完成！");
        } else {
            setStatus("未检测到图片输出", "warning");
            toastr.warning("后端没有返回图片结果。");
        }
    } catch (error) {
        console.error(`[${extensionName}] Summarize-generate failed`, error);
        setStatus(error.message, "error");
        toastr.error(error.message);
    } finally {
        inFlightMessages.delete(inFlightKey);
    }
}

/**
 * 使用 LLM 将消息内容总结为生图提示词
 */
async function summarizeMessageToPrompt(messageContent) {
    const settings = extension_settings[extensionName];
    const template = settings.summarizeTemplate || defaultSettings.summarizeTemplate;
    const systemPrompt = "你是一个擅长将文字内容转化为图片提示词的专家。";
    const userMessage = renderPromptWithMessage(template, messageContent);

    try {
        return await callLlmForText(systemPrompt, userMessage);
    } catch (error) {
        console.warn(`[${extensionName}] Summarization failed`, error);
        return "";
    }
}

// ═══════════════════════════════════════════════════════════════
// SECTION 19: HTTP & PARSING UTILITIES
// ═══════════════════════════════════════════════════════════════

async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
        });

        const text = await response.text();
        if (!response.ok) {
            const message = text?.trim() || `HTTP ${response.status}`;
            throw new Error(`后端请求失败：${message}`);
        }

        return text;
    } catch (error) {
        if (error?.name === "AbortError") {
            throw new Error("后端请求超时。");
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

function parseBackendPayload(text) {
    if (!text) {
        return {};
    }

    try {
        return JSON.parse(text);
    } catch {
        return {
            choices: [
                {
                    message: {
                        content: text,
                    },
                },
            ],
        };
    }
}

function extractContentFromPayload(data) {
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === "string") {
        return content;
    }

    if (Array.isArray(content)) {
        return content
            .map((item) => {
                if (typeof item === "string") {
                    return item;
                }

                if (item?.type === "text") {
                    return item.text || "";
                }

                return "";
            })
            .join("");
    }

    return "";
}

function extractImagesFromPayload(data, endpoint, responseImageRegexSetting) {
    const collected = [];
    const structuredSources = [
        data?.media,
        data?.choices?.[0]?.message?.media,
        data?.images,
        data?.choices?.[0]?.message?.images,
        data?.choices?.[0]?.message?.content,
    ];

    for (const source of structuredSources) {
        collectStructuredImages(source, endpoint, collected);
    }

    const content = extractContentFromPayload(data);
    if (content) {
        const customRegex = safeParseRegex(responseImageRegexSetting);
        if (customRegex) {
            collectImagesFromText(content, customRegex, endpoint, collected);
        }

        collectImagesFromText(content, markdownImageRegex, endpoint, collected);
        collectImagesFromText(content, looseImageUrlRegex, endpoint, collected);
    }

    return dedupeStrings(collected);
}

function collectStructuredImages(source, endpoint, output) {
    if (!source) {
        return;
    }

    if (typeof source === "string") {
        if (looksLikeImageRef(source)) {
            pushImageCandidate(source, endpoint, output);
        }
        return;
    }

    if (!Array.isArray(source)) {
        return;
    }

    for (const item of source) {
        if (typeof item === "string") {
            if (looksLikeImageRef(item)) {
                pushImageCandidate(item, endpoint, output);
            }
            continue;
        }

        if (!item || typeof item !== "object") {
            continue;
        }

        const mediaType = String(item.media_type || item.type || "image").toLowerCase();
        if (mediaType && !["image", "image_url", "input_image"].includes(mediaType)) {
            continue;
        }

        const imageUrlValue = typeof item.image_url === "string"
            ? item.image_url
            : item.image_url?.url;

        pushImageCandidate(item.url || item.data_uri || imageUrlValue, endpoint, output);

        if (item.b64_json) {
            const format = String(item.format || "png").toLowerCase();
            pushImageCandidate(`data:image/${format};base64,${item.b64_json}`, endpoint, output);
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// SECTION 20: TEXT & REGEX UTILITIES
// ═══════════════════════════════════════════════════════════════

function looksLikeImageRef(value) {
    const text = String(value || "").trim();
    if (!text) {
        return false;
    }

    if (text.startsWith("data:image")) {
        return true;
    }

    looseImageUrlRegex.lastIndex = 0;
    return looseImageUrlRegex.test(text);
}

function collectImagesFromText(text, regex, endpoint, output) {
    for (const match of collectMatches(text, regex)) {
        pushImageCandidate(match.capture || match.fullMatch, endpoint, output);
    }
}

function pushImageCandidate(candidate, endpoint, output) {
    const normalized = normalizeImageRef(candidate, endpoint);
    if (normalized) {
        output.push(normalized);
    }
}

function normalizeImageRef(candidate, endpoint) {
    const value = String(candidate || "").trim();
    if (!value) {
        return "";
    }

    if (value.startsWith("data:image")) {
        return value;
    }

    try {
        return new URL(value, endpoint).toString();
    } catch {
        return value;
    }
}

function applyReplacements(text, matches, replacements) {
    let cursor = 0;
    let output = "";

    matches.forEach((match, index) => {
        output += text.slice(cursor, match.index);
        output += replacements[index] ?? match.fullMatch;
        cursor = match.index + match.fullMatch.length;
    });

    output += text.slice(cursor);
    return output;
}

function cleanupMessageText(text) {
    return String(text || "")
        .replace(/\n{4,}/g, "\n\n\n")
        .trim();
}

function collectMatches(text, regex) {
    const sourceText = String(text || "");
    if (!sourceText) {
        return [];
    }

    const flags = regex.flags || "";
    const runner = new RegExp(regex.source, regex.global ? flags : `${flags}g`);
    const results = [];

    for (let match = runner.exec(sourceText); match; match = runner.exec(sourceText)) {
        results.push({
            index: match.index,
            fullMatch: match[0],
            capture: extractCapture(match),
        });

        if (!regex.global) {
            break;
        }

        if (match[0] === "") {
            runner.lastIndex += 1;
        }
    }

    return results;
}

function extractCapture(match) {
    if (match?.groups?.prompt) {
        return match.groups.prompt;
    }

    for (let index = 1; index < match.length; index++) {
        if (typeof match[index] === "string" && match[index].length > 0) {
            return match[index];
        }
    }

    return match[0] || "";
}

function dedupeStrings(values) {
    return [...new Set(values.filter(Boolean))];
}

function renderPrompt(template, prompt) {
    const source = String(template || defaultSettings.promptTemplate);
    return source.replaceAll("{{prompt}}", String(prompt || "").trim());
}

function renderPromptWithMessage(template, message) {
    return String(template || "")
        .replaceAll("{{message}}", String(message || "").trim())
        .replaceAll("{{prompt}}", String(message || "").trim());
}

function parseRegex(value, label) {
    const regex = safeParseRegex(value);
    if (!regex) {
        throw new Error(`${label} 格式无效。`);
    }
    return regex;
}

function safeParseRegex(value) {
    return regexFromString(String(value || "").trim());
}

function parseOptionalJson(value, label) {
    const text = String(value || "").trim();
    if (!text) {
        return {};
    }

    try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error();
        }
        return parsed;
    } catch {
        throw new Error(`${label} 格式无效。`);
    }
}

function resolveChatCompletionsUrl(rawUrl) {
    const input = String(rawUrl || "").trim();
    if (!input) {
        throw new Error("服务地址不能为空。");
    }

    let url;
    try {
        url = new URL(input);
    } catch {
        throw new Error("服务地址格式无效。");
    }

    const pathname = url.pathname.replace(/\/+$/, "");
    if (/\/chat\/completions$/i.test(pathname)) {
        return url.toString();
    }

    if (!pathname || pathname === "") {
        url.pathname = "/v1/chat/completions";
        return url.toString();
    }

    url.pathname = `${pathname}/chat/completions`;
    return url.toString();
}

function stripHtmlTags(html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || "";
}

// ═══════════════════════════════════════════════════════════════
// SECTION 21: IMAGE HANDLING UTILITIES
// ═══════════════════════════════════════════════════════════════

function attachGeneratedImages(message, images, titles) {
    const newImages = dedupeStrings(images);
    if (!newImages.length) {
        return;
    }

    const extra = message.extra || {};
    const existingImages = [];

    if (Array.isArray(extra.image_swipes)) {
        existingImages.push(...extra.image_swipes);
    }

    if (extra.image) {
        existingImages.push(extra.image);
    }

    const mergedImages = dedupeStrings([...newImages, ...existingImages]);
    const firstTitle = titles.find((title) => String(title || "").trim().length > 0);

    extra.image_swipes = mergedImages;
    extra.image = newImages[0];
    extra.inline_image = true;

    if (firstTitle) {
        extra.title = firstTitle;
    }

    message.extra = extra;
}
