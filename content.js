// LinkedIn Posts & Comments Formatter - Enhanced Version
// Tracks editors and manages formatting functionality

// Debug mode - set to false for production to prevent logging user content
const DEBUG = true; // TEMP: enabled for debugging toolbar issues
const log = DEBUG ? console.log.bind(console) : () => {};
const logError = console.error.bind(console); // Always log errors

// Inject CSS to override LinkedIn's toolbar centering
function injectToolbarStyles() {
    const styleId = 'linkedin-formatter-toolbar-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        /* Keep buttons inline without forcing new line */
        .linkedin-formatter-buttons {
            margin-right: 8px !important;
        }
        /* Floating overlay container - positioned above native toolbar in modals */
        .linkedin-formatter-overlay {
            position: fixed;
            z-index: 9999;
            display: flex;
            align-items: center;
            padding: 4px 12px;
            background: #ffffff;
            border-bottom: 1px solid rgba(0, 0, 0, 0.08);
            box-sizing: border-box;
            pointer-events: auto;
        }
        /* Ensure toolbar footer uses flexbox with space-between for left/right alignment */
        .linkedin-formatter-footer-container {
            display: flex !important;
            justify-content: space-between !important;
            align-items: center !important;
            width: 100% !important;
        }
        /* Left section for formatting buttons */
        .linkedin-formatter-left-section {
            display: flex !important;
            align-items: center !important;
            flex: 1 !important;
        }
        /* Right section for Post button */
        .linkedin-formatter-right-section {
            display: flex !important;
            align-items: center !important;
        }
    `;
    document.head.appendChild(style);
}

// State management using WeakSet for automatic garbage collection
const state = {
    editors: new WeakSet(),
    formattingBars: new WeakMap(),
    observer: null,
    urlObserver: null,
    urlCheckInterval: null,  // Store interval ID for cleanup
    currentEditor: null,
    keyboardShortcutsEnabled: true  // Cache keyboard shortcuts setting
};

// ============================================================
// UNICODE FORMATTING ENGINE — Centralized Configuration
// ============================================================

// Single source of truth: all Unicode ranges for reverse conversion.
// Each entry maps a formatted code-point range back to its ASCII base.
// Format: [rangeStart, rangeEnd, asciiBase]
const FORMAT_RANGES = [
    // Bold (Sans-Serif)
    [0x1D5D4, 0x1D5ED, 65],  // A-Z
    [0x1D5EE, 0x1D607, 97],  // a-z
    [0x1D7EC, 0x1D7F5, 48],  // 0-9
    // Italic
    [0x1D608, 0x1D621, 65],  // A-Z
    [0x1D622, 0x1D63B, 97],  // a-z
    // Bold Italic
    [0x1D63C, 0x1D655, 65],  // A-Z
    [0x1D656, 0x1D66F, 97],  // a-z
    // Monospace
    [0x1D670, 0x1D689, 65],  // A-Z
    [0x1D68A, 0x1D6A3, 97],  // a-z
    [0x1D7F6, 0x1D7FF, 48],  // 0-9
    // Sans-Serif (plain)
    [0x1D5A0, 0x1D5B9, 65],  // A-Z
    [0x1D5BA, 0x1D5D3, 97],  // a-z
    [0x1D7E2, 0x1D7EB, 48],  // 0-9
    // Script
    [0x1D49C, 0x1D4B5, 65],  // A-Z
    [0x1D4B6, 0x1D4CF, 97],  // a-z
    // Circled
    [0x24B6, 0x24CF, 65],    // A-Z
    [0x24D0, 0x24E9, 97],    // a-z
    [0x2460, 0x2468, 49],    // 1-9
    // Negative Circled
    [0x1F150, 0x1F169, 65],  // A-Z
    // Squared
    [0x1F130, 0x1F149, 65],  // A-Z
    // Fullwidth
    [0xFF21, 0xFF3A, 65],    // A-Z
    [0xFF41, 0xFF5A, 97],    // a-z
    [0xFF10, 0xFF19, 48],    // 0-9
];

// Style configs for forward conversion (ASCII → Unicode).
// Used by convertToUnicode and isFormatted.
const STYLE_CONFIGS = {
    bold:         { uppercase: 0x1D5D4, lowercase: 0x1D5EE, numbers: 0x1D7EC },
    italic:       { uppercase: 0x1D608, lowercase: 0x1D622 },
    boldItalic:   { uppercase: 0x1D63C, lowercase: 0x1D656 },
    monospace:    { uppercase: 0x1D670, lowercase: 0x1D68A, numbers: 0x1D7F6 },
    sansSerif:    { uppercase: 0x1D5A0, lowercase: 0x1D5BA, numbers: 0x1D7E2 },
    script:       { uppercase: 0x1D49C, lowercase: 0x1D4B6 },
    strikethrough: { combiningChar: '\u0336' },
    underline:     { combiningChar: '\u0332' },
    // Styles below use special-case logic in convertToUnicode
    circled:         { uppercase: 0x24B6, lowercase: 0x24D0 },
    negativeCircled: { uppercase: 0x1F150 },
    squared:         { uppercase: 0x1F130 },
    fullwidth:       { uppercase: 0xFF21, lowercase: 0xFF41, numbers: 0xFF10 },
};

// Utility: Debounce function to limit execution frequency
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Convert a single Unicode formatted character back to plain ASCII.
// Returns the original char if it's not a known formatted codepoint.
function unicodeToPlainChar(char) {
    const cp = char.codePointAt(0);

    // Special cases not covered by FORMAT_RANGES
    if (cp === 0x24EA) return '0';  // Circled zero
    if (cp === 0x3000) return ' ';  // Fullwidth space

    // Check all ranges (O(n) on ~24 entries — fast for single-char lookups)
    for (let i = 0; i < FORMAT_RANGES.length; i++) {
        const r = FORMAT_RANGES[i];
        if (cp >= r[0] && cp <= r[1]) {
            return String.fromCharCode(r[2] + (cp - r[0]));
        }
    }

    return char;
}

// Enhanced Unicode conversion using character code ranges
function convertToUnicode(text, style) {
    // Special case for circled text
    if (style === 'circled') {
        let result = '';
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const code = char.charCodeAt(0);
            if (code >= 65 && code <= 90) {
                result += String.fromCodePoint(0x24B6 + (code - 65));
            } else if (code >= 97 && code <= 122) {
                result += String.fromCodePoint(0x24D0 + (code - 97));
            } else if (code >= 48 && code <= 57) {
                result += char === '0' ? '⓪' : String.fromCodePoint(0x245F + (code - 48));
            } else {
                result += char;
            }
        }
        return result;
    }

    // Special case for negative circled text
    if (style === 'negativeCircled') {
        let result = '';
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const code = char.charCodeAt(0);
            if (code >= 65 && code <= 90) {
                result += String.fromCodePoint(0x1F150 + (code - 65));
            } else if (code >= 97 && code <= 122) {
                result += String.fromCodePoint(0x1F150 + (code - 97));
            } else {
                result += char;
            }
        }
        return result;
    }

    // Special case for squared text
    if (style === 'squared') {
        let result = '';
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const code = char.charCodeAt(0);
            if (code >= 65 && code <= 90) {
                result += String.fromCodePoint(0x1F130 + (code - 65));
            } else if (code >= 97 && code <= 122) {
                result += String.fromCodePoint(0x1F130 + (code - 97));
            } else {
                result += char;
            }
        }
        return result;
    }

    // Special case for fullwidth text
    if (style === 'fullwidth') {
        let result = '';
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const code = char.charCodeAt(0);
            if (code >= 65 && code <= 90) {
                result += String.fromCodePoint(0xFF21 + (code - 65));
            } else if (code >= 97 && code <= 122) {
                result += String.fromCodePoint(0xFF41 + (code - 97));
            } else if (code >= 48 && code <= 57) {
                result += String.fromCodePoint(0xFF10 + (code - 48));
            } else if (code === 32) {
                result += String.fromCodePoint(0x3000);
            } else {
                result += char;
            }
        }
        return result;
    }

    // Special case for script text (has non-contiguous exceptions)
    if (style === 'script') {
        const scriptMap = {
            'A': '𝒜', 'B': '𝐵', 'C': '𝒞', 'D': '𝒟', 'E': '𝐸', 'F': '𝐹', 'G': '𝒢',
            'H': '𝐻', 'I': '𝐼', 'J': '𝒥', 'K': '𝒦', 'L': '𝐿', 'M': '𝑀', 'N': '𝒩',
            'O': '𝒪', 'P': '𝒫', 'Q': '𝒬', 'R': '𝑅', 'S': '𝒮', 'T': '𝒯', 'U': '𝒰',
            'V': '𝒱', 'W': '𝒲', 'X': '𝒳', 'Y': '𝒴', 'Z': '𝒵',
            'a': '𝒶', 'b': '𝒷', 'c': '𝒸', 'd': '𝒹', 'e': '𝑒', 'f': '𝒻', 'g': '𝑔',
            'h': '𝒽', 'i': '𝒾', 'j': '𝒿', 'k': '𝓀', 'l': '𝓁', 'm': '𝓂', 'n': '𝓃',
            'o': '𝑜', 'p': '𝓅', 'q': '𝓆', 'r': '𝓇', 's': '𝓈', 't': '𝓉', 'u': '𝓊',
            'v': '𝓋', 'w': '𝓌', 'x': '𝓍', 'y': '𝓎', 'z': '𝓏'
        };
        let result = '';
        for (let i = 0; i < text.length; i++) {
            result += scriptMap[text[i]] || text[i];
        }
        return result;
    }

    const config = STYLE_CONFIGS[style];
    if (!config) return text;

    // Handle combining characters (strikethrough, underline)
    if (config.combiningChar) {
        let result = '';
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (char === ' ' || char === '\n' || char === '\r') {
                result += char;
            } else {
                // Convert any existing Unicode format back to plain before adding combining char
                result += unicodeToPlainChar(char) + config.combiningChar;
            }
        }
        return result;
    }

    // Handle regular Unicode ranges (bold, italic, monospace, etc.)
    let result = '';
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const code = char.charCodeAt(0);

        if (code >= 65 && code <= 90 && config.uppercase) {
            result += String.fromCodePoint(code - 65 + config.uppercase);
        } else if (code >= 97 && code <= 122 && config.lowercase) {
            result += String.fromCodePoint(code - 97 + config.lowercase);
        } else if (code >= 48 && code <= 57 && config.numbers) {
            result += String.fromCodePoint(code - 48 + config.numbers);
        } else {
            result += char;
        }
    }
    return result;
}

// Check if text is already formatted in the given style.
// Uses codepoint math — works for ALL styles, not just legacy map styles.
function isFormatted(text, style) {
    const config = STYLE_CONFIGS[style];
    if (!config) return false;

    // Check for combining characters
    if (config.combiningChar) {
        return text.includes(config.combiningChar);
    }

    // Check if any character falls in this style's Unicode ranges
    for (const char of text) {
        const cp = char.codePointAt(0);
        if (config.uppercase && cp >= config.uppercase && cp < config.uppercase + 26) return true;
        if (config.lowercase && cp >= config.lowercase && cp < config.lowercase + 26) return true;
        if (config.numbers  && cp >= config.numbers  && cp < config.numbers + 10) return true;
    }
    return false;
}

// Remove all Unicode formatting from text, returning plain ASCII.
function clearFormatting(text) {
    if (!text) return '';

    log('clearFormatting - processing text of length:', text?.length || 0);

    // Remove combining characters first (strikethrough & underline overlays)
    let result = text.replace(/\u0336/g, '').replace(/\u0332/g, '');

    // Convert each formatted character back to plain ASCII via the centralized engine
    result = Array.from(result).map(char => {
        if (char === ' ' || char === '\n' || char === '\r' || char === '\t') return char;
        return unicodeToPlainChar(char);
    }).join('');

    // Remove bullet points
    result = result.replace(/^•\s*/gm, '');
    result = result.replace(/●\s*/g, '');
    result = result.replace(/^→\s*/gm, '');

    // Remove numbered lists (e.g., "1. ", "2) ", etc.)
    result = result.replace(/^\d+[\.\)]\s+/gm, '');

    // Collapse consecutive newlines to single newlines
    result = result.replace(/\n{2,}/g, '\n');

    log('clearFormatting - output text length:', result?.length || 0);
    return result;
}


// Create font dropdown menu
function createFontDropdown() {
    const dropdown = document.createElement('div');
    dropdown.className = 'linkedin-formatter-font-dropdown';
    dropdown.style.cssText = `
        display: none;
        position: absolute;
        bottom: 45px;
        left: 0;
        background: white;
        border: 1px solid rgba(0,0,0,0.15);
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        padding: 8px 0;
        z-index: 1000;
        min-width: 200px;
        max-height: 300px;
        overflow-y: auto;
    `;

    dropdown.onmousedown = (e) => {
        e.preventDefault();
    };

    const fontOptions = [
        { text: '𝗦𝗮𝗻𝘀-𝘀𝗲𝗿𝗶𝗳', action: 'sansSerif', label: 'Sans-serif' },
        { text: '𝓢𝓬𝓻𝓲𝓹𝓽', action: 'script', label: 'Script' },
        { text: 'Ⓒⓘⓡⓒⓛⓔⓓ', action: 'circled', label: 'Circled' },
        { text: '🅝🅔🅖🅐🅣🅘🅥🅔', action: 'negativeCircled', label: 'Negative Circled' },
        { text: '🅂🅀🅄🄰🅁🄴🄳', action: 'squared', label: 'Squared' },
        { text: 'Ｆｕｌｌｗｉｄｔｈ', action: 'fullwidth', label: 'Fullwidth' },
        { text: '𝙼𝚘𝚗𝚘𝚜𝚙𝚊𝚌𝚎', action: 'monospace', label: 'Monospace' }
    ];

    fontOptions.forEach(option => {
        const item = document.createElement('div');
        item.className = 'font-option';
        item.textContent = `${option.text}`;
        item.title = option.label;
        item.style.cssText = `
            padding: 8px 16px;
            cursor: pointer;
            font-size: 14px;
            transition: background-color 0.2s;
        `;

        item.onmouseenter = () => {
            item.style.backgroundColor = 'rgba(0,0,0,0.08)';
        };
        item.onmouseleave = () => {
            item.style.backgroundColor = 'transparent';
        };

        item.onmousedown = (e) => {
            // Prevent default to avoid losing selection
            e.preventDefault();
        };

        item.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Apply the formatting
            formatText(option.action);
            trackUsage(option.action);

            // Close the dropdown
            dropdown.style.display = 'none';
        };

        dropdown.appendChild(item);
    });

    return dropdown;
}

// Create capitalization dropdown menu
function createCaseDropdown() {
    const dropdown = document.createElement('div');
    dropdown.className = 'linkedin-formatter-case-dropdown';
    dropdown.style.cssText = `
        display: none;
        position: absolute;
        bottom: 45px;
        left: 0;
        background: white;
        border: 1px solid rgba(0,0,0,0.15);
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        padding: 8px 0;
        z-index: 1000;
        min-width: 180px;
    `;

    dropdown.onmousedown = (e) => {
        e.preventDefault();
    };

    const caseOptions = [
        { text: 'AAA', action: 'uppercase', label: 'UPPERCASE' },
        { text: 'aaa', action: 'lowercase', label: 'lowercase' },
        { text: 'Aa', action: 'titleCase', label: 'Title Case' }
    ];

    caseOptions.forEach(option => {
        const item = document.createElement('div');
        item.className = 'case-option';
        item.textContent = option.text;
        item.title = option.label;
        item.style.cssText = `
            padding: 8px 16px;
            cursor: pointer;
            font-size: 14px;
            transition: background-color 0.2s;
        `;

        item.onmouseenter = () => {
            item.style.backgroundColor = 'rgba(0,0,0,0.08)';
        };
        item.onmouseleave = () => {
            item.style.backgroundColor = 'transparent';
        };

        item.onmousedown = (e) => {
            e.preventDefault();
        };

        item.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            formatText(option.action);
            trackUsage(option.action);
            dropdown.style.display = 'none';
        };

        dropdown.appendChild(item);
    });

    return dropdown;
}

// Create list style dropdown menu
function createListDropdown() {
    const dropdown = document.createElement('div');
    dropdown.className = 'linkedin-formatter-list-dropdown';
    dropdown.style.cssText = `
        display: none;
        position: absolute;
        bottom: 45px;
        left: 0;
        background: white;
        border: 1px solid rgba(0,0,0,0.15);
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        padding: 8px 0;
        z-index: 1000;
        min-width: 180px;
    `;

    dropdown.onmousedown = (e) => {
        e.preventDefault();
    };

    const listOptions = [
        { text: '•  Bullet list', action: 'bullet' },
        { text: '→  Arrow list', action: 'arrow' },
        { text: '1.  Numbered list', action: 'numbered' }
    ];

    listOptions.forEach(option => {
        const item = document.createElement('div');
        item.className = 'list-option';
        item.textContent = option.text;
        item.title = option.text;
        item.style.cssText = `
            padding: 8px 16px;
            cursor: pointer;
            font-size: 14px;
            transition: background-color 0.2s;
        `;

        item.onmouseenter = () => {
            item.style.backgroundColor = 'rgba(0,0,0,0.08)';
        };
        item.onmouseleave = () => {
            item.style.backgroundColor = 'transparent';
        };

        item.onmousedown = (e) => {
            e.preventDefault();
        };

        item.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            formatText(option.action);
            trackUsage(option.action);
            dropdown.style.display = 'none';
        };

        dropdown.appendChild(item);
    });

    return dropdown;
}

// Create formatting buttons container
function createFormattingButtons() {
    log('Creating formatting buttons');

    // Simple container
    const container = document.createElement('div');
    container.className = 'linkedin-formatter-buttons';
    container.style.cssText = `
        display: inline-flex;
        gap: 4px;
        align-items: center;
        flex-shrink: 0;
        white-space: nowrap;
        position: relative;
    `;

    // Detect platform for keyboard shortcut display (Mac uses Cmd, others use Ctrl)
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const modifierKey = isMac ? 'Cmd' : 'Ctrl';

    const buttons = [
        { text: 'B', action: 'bold', title: `Bold (${modifierKey}+B)` },
        { text: 'I', action: 'italic', title: `Italic (${modifierKey}+I)` },
        { text: 'B/I', action: 'boldItalic', title: 'Bold Italic' },
        { text: 'S̶', action: 'strikethrough', title: `Strikethrough (${modifierKey}+S)` },
        { text: 'U̲', action: 'underline', title: `Underline (${modifierKey}+U)` },
        { text: 'Aa', action: 'case-dropdown', title: 'Change Case', isDropdown: true },
        { text: 'Ff', action: 'font-dropdown', title: 'Font Style', isDropdown: true },
        { text: '•', action: 'list-dropdown', title: 'List Style', isDropdown: true },
        { text: '✕', action: 'clear', title: 'Clear Formatting' }
    ];

    buttons.forEach(button => {
        const btn = document.createElement('button');
        btn.title = button.title;
        btn.className = 'linkedin-formatter-btn';

        // Create custom SVG icons for special buttons
        if (button.action === 'list-dropdown') {
            btn.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="3" cy="4" r="1.5" fill="currentColor"/>
                    <line x1="6" y1="4" x2="16" y2="4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    <circle cx="3" cy="9" r="1.5" fill="currentColor"/>
                    <line x1="6" y1="9" x2="16" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    <circle cx="3" cy="14" r="1.5" fill="currentColor"/>
                    <line x1="6" y1="14" x2="16" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
            `;
        } else if (button.action === 'case-dropdown') {
            // Change case selector - Aa
            btn.textContent = 'Aa';
        } else if (button.action === 'font-dropdown') {
            // Font style selector - typography A icon
            btn.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <text x="10" y="14" text-anchor="middle" font-size="14" font-weight="bold" font-family="serif" fill="currentColor">A</text>
                    <line x1="3" y1="17" x2="17" y2="17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
            `;
        } else if (button.action === 'clear') {
            // Clear formatting - T with diagonal slash
            btn.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                    <!-- T letter -->
                    <path d="M 6 6 L 14 6 M 10 6 L 10 16" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                    <!-- Diagonal slash -->
                    <line x1="4" y1="17" x2="16" y2="4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
            `;
        } else {
            btn.textContent = button.text;
        }

        // Style to match LinkedIn's buttons
        btn.style.cssText = `
            background-color: transparent;
            border: ${button.isDropdown ? '1px solid rgba(0,0,0,0.2)' : 'none'};
            color: rgba(0,0,0,0.6);
            padding: 8px;
            cursor: pointer;
            border-radius: 50%;
            transition: background-color 0.2s ease;
            min-width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            font-weight: ${button.action === 'bold' || button.action === 'boldItalic' ? 'bold' : 'normal'};
            font-style: ${button.action === 'italic' || button.action === 'boldItalic' ? 'italic' : 'normal'};
        `;

        // Hover effect like LinkedIn's buttons
        btn.onmouseenter = () => {
            btn.style.backgroundColor = 'rgba(0,0,0,0.08)';
        };
        btn.onmouseleave = () => {
            btn.style.backgroundColor = 'transparent';
        };

        // Prevent focus stealing on all buttons
        btn.onmousedown = (e) => {
            e.preventDefault();
        };

        // Handle dropdown button specially
        if (button.isDropdown) {
            let dropdown;
            if (button.action === 'case-dropdown') {
                dropdown = createCaseDropdown();
            } else if (button.action === 'font-dropdown') {
                dropdown = createFontDropdown();
            } else if (button.action === 'list-dropdown') {
                dropdown = createListDropdown();
            }
            container.appendChild(dropdown);

            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                log(`Dropdown button clicked: ${button.action}`);

                // Close any other open dropdowns in the toolbar
                container.querySelectorAll('.linkedin-formatter-case-dropdown, .linkedin-formatter-font-dropdown, .linkedin-formatter-list-dropdown').forEach(d => {
                    if (d !== dropdown) d.style.display = 'none';
                });

                // Toggle dropdown visibility
                const isVisible = dropdown.style.display === 'block';
                dropdown.style.display = isVisible ? 'none' : 'block';
            };

            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (!container.contains(e.target)) {
                    dropdown.style.display = 'none';
                }
            });
        } else {
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                log(`Button clicked: ${button.action}`);
                
                formatText(button.action);
                trackUsage(button.action);
            };
        }

        container.appendChild(btn);
    });

    log('Formatting buttons created:', buttons.map(b => b.text).join(', '));
    return container;
}

// Track usage statistics
function trackUsage(action) {
    try {
        chrome.storage.local.get(['usage'], (result) => {
            const usage = result.usage || { count: 0, actions: {} };
            usage.count++;
            usage.actions[action] = (usage.actions[action] || 0) + 1;
            usage.lastUsed = Date.now();
            chrome.storage.local.set({ usage });
        });
    } catch (error) {
        log('Usage tracking failed:', error);
    }
}

// Enhanced text formatting with better LinkedIn compatibility
function formatText(action) {
    log(`Formatting text: ${action}, selected length:`, window.getSelection().toString().length);

    try {
        const selection = window.getSelection();
        if (!selection.rangeCount) {
            log('No selection range available');
            return;
        }

        log(`Selection rangeCount: ${selection.rangeCount}`);

        // Find the best range (some editors return empty ranges at index 0)
        let range = selection.getRangeAt(0);
        for (let i = 0; i < selection.rangeCount; i++) {
            const r = selection.getRangeAt(i);
            log(`Range ${i} length: ${r.toString().length}`);
            if (r.toString().length > 0) {
                range = r;
                break;
            }
        }

        let selectedText = range.toString();
        const rangeIsEmpty = selectedText.length === 0;

        // If the range is empty, try to get text from the global selection
        // (LinkedIn's main post modal has a bug where range is empty but selection exists)
        if (rangeIsEmpty && selection.toString().length > 0) {
            selectedText = selection.toString();
            log('Using global selection text (range was empty):', selectedText.length);
        }

        // For non-bullet actions, we need selected text
        if (selectedText.length === 0 && action !== 'bullet' && action !== 'arrow' && action !== 'numbered') {
            log('No text selected for formatting');
            return;
        }

        let formattedText = '';

        // === UNICODE FORMAT ACTIONS (bold, italic, etc.) ===
        if (action === 'bold' || action === 'italic' || action === 'boldItalic' ||
            action === 'monospace' || action === 'strikethrough' || action === 'underline' ||
            action === 'sansSerif' || action === 'script' || action === 'circled' ||
            action === 'negativeCircled' || action === 'squared' || action === 'fullwidth') {
            const alreadyFormatted = isFormatted(selectedText, action);
            let plainText = clearFormatting(selectedText);

            if (alreadyFormatted) {
                formattedText = plainText;
                log('Removing formatting (toggle off):', action);
            } else {
                formattedText = convertToUnicode(plainText, action);
                log('Adding formatting:', action);
            }

        // === BULLET ACTION ===
        } else if (action === 'bullet') {
            formattedText = processBullets(selectedText, range, rangeIsEmpty);

        // === ARROW BULLET ACTION ===
        } else if (action === 'arrow') {
            formattedText = processBullets(selectedText, range, rangeIsEmpty, '→');

        // === NUMBERED LIST ACTION ===
        } else if (action === 'numbered') {
            formattedText = processNumberedList(selectedText, range, rangeIsEmpty);

        // === UPPERCASE / LOWERCASE ===
        } else if (action === 'uppercase') {
            formattedText = clearFormatting(selectedText).toUpperCase();
        } else if (action === 'lowercase') {
            formattedText = clearFormatting(selectedText).toLowerCase();
        } else if (action === 'titleCase') {
            formattedText = clearFormatting(selectedText)
                .toLowerCase()
                .replace(/(?:^|\s)\S/g, char => char.toUpperCase());

        // === CLEAR FORMATTING ===
        } else if (action === 'clear') {
            log('Clearing formatting from text length:', selectedText?.length || 0);
            formattedText = clearFormatting(selectedText);
            log('Cleared result length:', formattedText?.length || 0);
        }

        if (!formattedText && formattedText !== '') {
            logError('No formatted text generated');
            return;
        }

        // === TEXT REPLACEMENT ===
        const rangeHasContent = range ? range.toString().length > 0 : false;
        log(`Range has content: ${rangeHasContent}, formattedText length: ${formattedText?.length || 0}`);

        const editorEl = state.currentEditor || document.activeElement;
        
        // Ensure the editor has focus before we try to manipulate content.
        if (editorEl && editorEl.isContentEditable && document.activeElement !== editorEl) {
            editorEl.focus();
        }

        let insertSuccess = false;
        
        // PRIMARY PATH: document.execCommand
        // We MUST use execCommand whenever possible because it correctly triggers 
        // internal React/Draft.js events that LinkedIn relies on to track state.
        // Direct DOM manipulation (range.insertNode) works visually but gets reverted by LinkedIn.
        const lines = formattedText.split('\n');
        const isMultiline = lines.length > 1;

        if (isMultiline) {
            log('Multi-line primary path: inserting line by line');
            // Try atomic replacement first for multiline if possible
            const deleted = document.execCommand('delete', false, null);
            if (deleted) {
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].length > 0) {
                        document.execCommand('insertText', false, lines[i]);
                    }
                    if (i < lines.length - 1) {
                        document.execCommand('insertParagraph', false, null);
                    }
                }
                insertSuccess = true;
            }
        }

        if (!insertSuccess) {
            insertSuccess = document.execCommand('insertText', false, formattedText);
            log(`execCommand insertText result: ${insertSuccess}`);
        }

        if (!insertSuccess && rangeHasContent) {
            // FALLBACK PATH: Range-based replacement 
            // Fallback for when execCommand fails (e.g. certain comment field scenarios)
            log('Using range-based replacement as fallback');
            range.deleteContents();
            const textNode = document.createTextNode(formattedText);
            range.insertNode(textNode);

            // Move caret to end of insertion
            const newRange = document.createRange();
            newRange.setStart(textNode, formattedText.length);
            newRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(newRange);
            insertSuccess = true;
        } 
        
        if (!insertSuccess && editorEl && editorEl.isContentEditable) {
            // LAST RESORT: synthetic input events
            log('Using synthetic input events as last resort');
            editorEl.dispatchEvent(new InputEvent('beforeinput', {
                bubbles: true, cancelable: true,
                inputType: 'insertText', data: formattedText
            }));
            editorEl.dispatchEvent(new InputEvent('input', {
                bubbles: true, cancelable: false,
                inputType: 'insertText', data: formattedText
            }));
            insertSuccess = true;
        }

        // Trigger change events for LinkedIn compatibility
        const editor = state.currentEditor || document.activeElement;
        if (editor && editor.isContentEditable) {
            setTimeout(() => {
                // Use plain Event (not InputEvent with data) to avoid LinkedIn's
                // framework re-processing newlines into extra paragraph breaks.
                // The insertion itself (execCommand or insertNode) already fired
                // native events; this is just a notification for UI updates.
                const events = [
                    new Event('input', { bubbles: true }),
                    new Event('change', { bubbles: true })
                ];
                events.forEach(event => {
                    try { editor.dispatchEvent(event); } catch (e) { log('Event dispatch error:', e); }
                });
            }, 0);
        }

        log('Formatting applied successfully - length:', formattedText?.length || 0);
    } catch (error) {
        logError('Error applying formatting:', error);
    }
}

// Helper: Process bullet formatting
function processBullets(selectedText, range, rangeIsEmpty, bulletChar = '•') {
    const allBulletChars = ['•', '●', '→'];

    // Strip any bullet character from a line
    function stripAnyBullet(text) {
        let t = text.trim();
        for (const bc of allBulletChars) {
            if (t.startsWith(bc + ' ')) return t.slice(bc.length + 1).trim();
            if (t.startsWith(bc)) return t.slice(bc.length).trim();
        }
        return t;
    }

    if (rangeIsEmpty) {
        // String-based approach (main post modal with broken ranges)
        log('Bullet: using string-based fallback');
        const lines = selectedText.split('\n').filter(line => line.trim());

        if (lines.length === 0) return bulletChar + ' ';

        if (lines.length === 1) {
            const text = lines[0].trim();
            if (text.startsWith(bulletChar)) {
                return stripAnyBullet(text);
            }
            return bulletChar + ' ' + stripAnyBullet(text);
        }

        const allHaveTargetBullet = lines.every(line => line.trim().startsWith(bulletChar));
        if (allHaveTargetBullet) {
            return lines.map(line => stripAnyBullet(line)).join('\n');
        }
        return lines.map(line => {
            const t = line.trim();
            if (!t) return '';
            return bulletChar + ' ' + stripAnyBullet(t);
        }).join('\n');
    }

    // Range-based approach (comments with working ranges)
    if (range.startContainer === range.endContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
        const text = selectedText.trim();
        if (text.startsWith(bulletChar)) {
            return stripAnyBullet(text);
        }
        return bulletChar + ' ' + stripAnyBullet(text);
    }

    // Multi-line via range cloning
    const tempDiv = document.createElement('div');
    tempDiv.appendChild(range.cloneContents());
    const textWithBreaks = tempDiv.innerHTML
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .trim();
    const lines = textWithBreaks.split('\n').filter(line => line.trim());

    if (lines.length === 0) return bulletChar + ' ' + selectedText;

    const allHaveTargetBullet = lines.every(line => line.trim().startsWith(bulletChar));
    if (allHaveTargetBullet) {
        return lines.map(line => stripAnyBullet(line)).join('\n');
    }
    return lines.map(line => {
        const t = line.trim();
        if (!t) return '';
        return bulletChar + ' ' + stripAnyBullet(t);
    }).join('\n');
}

// Helper: Process numbered list formatting
function processNumberedList(selectedText, range, rangeIsEmpty) {
    const numPattern = /^\d+[.)]\s/;

    if (rangeIsEmpty) {
        // String-based approach (main post modal with broken ranges)
        log('Numbered: using string-based fallback');
        const lines = selectedText.split('\n').filter(line => line.trim());

        if (lines.length === 0) return '1. ';

        if (lines.length === 1) {
            const text = lines[0].trim();
            if (numPattern.test(text)) return text.replace(/^\d+[.)]\s+/, '');
            return '1. ' + text;
        }

        const allHaveNumbers = lines.every(line => numPattern.test(line.trim()));
        if (allHaveNumbers) {
            return lines.map(line => line.trim().replace(/^\d+[.)]\s+/, '')).join('\n');
        }
        return lines.map((line, i) => {
            const t = line.trim();
            if (!t) return '';
            if (numPattern.test(t)) return t;
            return `${i + 1}. ${t}`;
        }).join('\n');
    }

    // Range-based approach (comments with working ranges)
    if (range.startContainer === range.endContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
        const text = selectedText.trim();
        if (numPattern.test(text)) return text.replace(/^\d+[.)]\s+/, '');
        return '1. ' + text;
    }

    // Multi-line via range cloning
    const tempDiv = document.createElement('div');
    tempDiv.appendChild(range.cloneContents());
    const textWithBreaks = tempDiv.innerHTML
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .trim();
    const lines = textWithBreaks.split('\n').filter(line => line.trim());

    if (lines.length === 0) return '1. ' + selectedText;

    const allHaveNumbers = lines.every(line => numPattern.test(line.trim()));
    if (allHaveNumbers) {
        return lines.map(line => line.trim().replace(/^\d+[.)]\s+/, '')).join('\n');
    }
    return lines.map((line, i) => {
        const t = line.trim();
        if (!t) return '';
        if (numPattern.test(t)) return t;
        return `${i + 1}. ${t}`;
    }).join('\n');
}

// Find post editor with multiple strategies, piercing Shadow DOMs
function findPostEditor() {
    const selectors = [
        '[contenteditable="true"][role="textbox"]',
        '.ql-editor[contenteditable="true"]',
        '[contenteditable="true"]'
    ];

    // Helper to search through light DOM and all open shadow DOMs
    function queryDeepAll(selector) {
        const results = [];
        const queue = [document];
        
        while (queue.length > 0) {
            const root = queue.shift();
            results.push(...root.querySelectorAll(selector));
            
            const allElements = root.querySelectorAll('*');
            for (let i = 0; i < allElements.length; i++) {
                if (allElements[i].shadowRoot) {
                    queue.push(allElements[i].shadowRoot);
                }
            }
        }
        return results;
    }

    for (const selector of selectors) {
        const elements = queryDeepAll(selector);
        for (const element of elements) {
            // Check if element is visible (offsetParent fails in shadow DOM sometimes)
            const rect = element.getBoundingClientRect();
            const isVisible = rect.width > 0 && rect.height > 0;
            
            if (isVisible && element.isContentEditable) {
                // Skip if already has a formatter attached
                if (state.editors.has(element)) {
                    continue;
                }
                return element;
            }
        }
    }
    return null;
}

// Check if element is in a post creation context (more lenient)
function isPostContext(element) {
    if (!element.isContentEditable) return false;

    // Just check if it's visible and editable
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

// Find LinkedIn's bottom toolbar
function findLinkedInToolbar(editor) {
    log('Finding toolbar for editor:', editor);

    // Use getRootNode() to search the entire shadow root (or document)
    // This handles the new shadow DOM structure flawlessly.
    const rootSearchTarget = editor.getRootNode();

    log('Looking for toolbar buttons (local-first search)');

    // Prioritize bottom toolbar buttons (Schedule/Clock) so the formatter appears at the very bottom
    // Fall back to media/emoji for comments which don't have a schedule button
    const targetSelectors = [
        // 1. Bottom row with Post button (modal post creation)
        'button[aria-label*="schedule" i]',
        'button[aria-label*="Schedule" i]',
        // 2. Comment/Reply toolbars — emoji and photo buttons
        'button[aria-label*="photo" i]',
        'button[aria-label*="image" i]',
        'button[aria-label*="Add a" i]',
        'button[aria-label*="Media" i]',
        'button[aria-label*="emoji" i]',
        'button[aria-label*="Emoji" i]',
        'button[aria-label*="Open emoji" i]',
        'button[aria-label*="Add an emoji" i]',
        'button[aria-label*="Insert an emoji" i]'
    ];

    // === LOCAL-FIRST SEARCH using stable LinkedIn DOM anchors ===
    // LinkedIn's new TipTap/ProseMirror DOM has NO <form> elements and uses
    // hashed CSS class names (e.g. "_87db4414"). We use data-testid attributes
    // and ARIA roles which are stable across LinkedIn deployments.
    //
    // DOM hierarchy per comment/reply editor:
    //   editor (role="textbox", contenteditable)
    //     └─ parent: wrapper div
    //       └─ [data-testid="ui-core-tiptap-text-editor-wrapper"] (level 1)
    //         └─ parent (level 2)
    //           └─ [data-display-contents] (level 3)
    //             └─ comment-scope (level 4) ← contains editor + emoji + photo
    //
    // For feed posts, each post is a [role="listitem"] in the feed list.

    const localScopes = [];

    // Strategy 1: TipTap wrapper + walk up to the comment-scope container
    // This is the tightest reliable scope: contains exactly 1 editor, 1 emoji, 1 photo
    const tiptapWrapper = editor.closest('[data-testid="ui-core-tiptap-text-editor-wrapper"]');
    if (tiptapWrapper) {
        let commentScope = tiptapWrapper;
        // Walk up 3 parent levels to reach the container holding emoji/photo buttons
        for (let i = 0; i < 3; i++) {
            if (commentScope.parentElement) {
                commentScope = commentScope.parentElement;
            }
        }
        localScopes.push(commentScope);
        // Also store this scope on the editor for use during insertion
        editor._commentScope = commentScope;
    }

    // Strategy 2: Per-post boundary (each feed post is a listitem)
    const listItem = editor.closest('[role="listitem"]');
    if (listItem) {
        localScopes.push(listItem);
    }

    // Strategy 3: Legacy fallbacks for older LinkedIn layouts
    const formScope = editor.closest('form');
    if (formScope) localScopes.push(formScope);

    // Strategy 4: Dialog/modal scope for post creation
    const dialogScope = editor.closest('[role="dialog"]');
    if (dialogScope) localScopes.push(dialogScope);

    // Strategy 5: Last resort — walk up 15 parents (broad but covers edge cases)
    let broadContainer = editor;
    for (let i = 0; i < 15; i++) {
        if (broadContainer.parentElement) {
            broadContainer = broadContainer.parentElement;
        }
    }
    localScopes.push(broadContainer);

    let foundButton = null;
    let selectorUsed = '';
    let scopeUsed = '';

    // Try each scope from tightest to broadest
    for (const scope of localScopes) {
        for (const selector of targetSelectors) {
            foundButton = scope.querySelector(selector);
            if (foundButton) {
                selectorUsed = selector;
                scopeUsed = scope.getAttribute('data-testid') || scope.getAttribute('role') || scope.tagName || 'unknown';
                break;
            }
        }
        if (foundButton) break;
    }

    // Fall back to root/document search only if all local scopes found nothing
    if (!foundButton) {
        log('Local search found nothing, falling back to root search');
        for (const selector of targetSelectors) {
            foundButton = (rootSearchTarget.querySelector && rootSearchTarget.querySelector(selector)) || broadContainer.querySelector(selector);
            if (foundButton) {
                selectorUsed = selector;
                scopeUsed = 'root';
                break;
            }
        }
    }

    if (foundButton) {
        log(`Found native toolbar button with selector: ${selectorUsed} (scope: ${scopeUsed})`);
    }

    if (foundButton) {
        let toolbar = foundButton.parentElement;
        log(`✅ Using native button parent as toolbar (from: ${selectorUsed})`);
        
        let isBottomRow = selectorUsed.toLowerCase().includes('schedule');
        
        // If it's the bottom row, we want to find the full-width footer container
        // so we can insert the formatting buttons on the far left.
        if (isBottomRow) {
            // Traverse up until we find a container that is nearly the full width of the modal
            // The schedule button is usually in a small right-aligned wrapper.
            let current = toolbar;
            for (let i = 0; i < 5; i++) {
                if (current && current.parentElement && current.parentElement.offsetWidth > 300) {
                    current = current.parentElement;
                    break;
                }
                if (current.parentElement) {
                    current = current.parentElement;
                }
            }
            toolbar = current;
        }
        
        toolbar._isBottomRow = isBottomRow;
        toolbar._formatterInsertionNode = isBottomRow ? toolbar.firstChild : foundButton;
        return toolbar;
    }


    console.warn('❌ Could not find toolbar for editor');
    return null;
}

// Attach formatter to an editor
function attachFormatter(editor) {
    if (state.editors.has(editor)) {
        log('Formatter already attached to this editor');
        return;
    }

    log('=== Attaching formatter ===');
    log('Editor:', editor);
    log('Editor classes:', editor.className);
    log('Editor parent:', editor.parentElement);

    state.editors.add(editor);
    state.currentEditor = editor;

    // Clean up any old instance specifically for this editor just in case
    if (state.formattingBars.has(editor)) {
        const oldBar = state.formattingBars.get(editor);
        if (oldBar && oldBar.isConnected) {
            oldBar.remove();
        }
    }

    // Find LinkedIn's native toolbar (read-only positional reference for modals)
    const toolbar = findLinkedInToolbar(editor);
    if (!toolbar) {
        console.warn('❌ Could not find LinkedIn toolbar - buttons will not be added');
        log('Editor found - tag:', editor.tagName, 'classes:', editor.className?.substring(0, 50));
        return;
    }

    log('✅ Found toolbar:', toolbar);
    log('Toolbar classes:', toolbar.className);

    // Create formatting buttons
    const formattingButtons = createFormattingButtons();
    state.formattingBars.set(editor, formattingButtons);

    // Determine if this is a modal editor (main post) or inline (comment/reply)
    const isModalEditor = !!editor.closest('[role="dialog"]');
    log('Is modal editor:', isModalEditor);

    // === DIRECT INSERTION for all editors ===
    // We insert directly into the toolbar to keep it inline with native buttons.

    if (toolbar._isBottomRow) {
        // We found the full width footer. We want our buttons on the far left, and the native Post button on the far right.
        toolbar.style.setProperty('display', 'flex', 'important');
        toolbar.style.setProperty('justify-content', 'space-between', 'important');
        toolbar.style.setProperty('width', '100%', 'important');
        
        // LinkedIn's footer layout might use `row` or `row-reverse`.
        // To guarantee it appears on the visual left with `space-between`, we must place it:
        // - as the FIRST child if `row`
        // - as the LAST child if `row-reverse`
        const isRowReverse = window.getComputedStyle(toolbar).flexDirection === 'row-reverse';
        
        if (isRowReverse) {
            toolbar.appendChild(formattingButtons);
        } else {
            toolbar.insertBefore(formattingButtons, toolbar.firstChild);
        }
    } else {
        // Comment/Reply toolbars — insert BELOW the editor's comment-scope
        // LinkedIn's TipTap DOM uses data-testid attributes, not forms.
        // The comment-scope container (set in findLinkedInToolbar) holds the
        // editor + emoji/photo buttons in an internal flex layout.
        // We must insert AFTER it (not inside) to avoid breaking the flex layout.
        const commentScope = editor._commentScope;
        
        formattingButtons.style.setProperty('margin-top', '4px', 'important');
        formattingButtons.style.setProperty('margin-bottom', '4px', 'important');
        formattingButtons.style.setProperty('width', '100%', 'important');
        formattingButtons.style.setProperty('justify-content', 'flex-start', 'important');
        
        if (commentScope && commentScope.parentElement) {
            // Insert AFTER the comment-scope container — below the editor + emoji row
            // This keeps the bar outside the internal flex layout that holds the editor
            commentScope.insertAdjacentElement('afterend', formattingButtons);
            log(`✅ Inserted bar after comment-scope container`);
        } else {
            // Last resort fallback
            const legacyWrapper = editor.closest('form') || editor.closest('.comments-comment-box') || toolbar.parentElement.parentElement;
            if (legacyWrapper && legacyWrapper.parentElement) {
                legacyWrapper.insertAdjacentElement('afterend', formattingButtons);
            } else {
                toolbar.appendChild(formattingButtons);
            }
            log(`⚠️ Used legacy fallback for bar insertion`);
        }
    }

    log('✅ Formatting buttons inserted into Document');

    // Keep a reference to the container we injected into
    const insertionParent = formattingButtons.parentElement;

    // Clean up when the editor is removed from the DOM
    const removalObserver = new MutationObserver(() => {
        if (!editor.isConnected) {
            formattingButtons.remove();
            state.editors.delete(editor);
            state.formattingBars.delete(editor);
            if (state.currentEditor === editor) {
                state.currentEditor = null;
            }
            removalObserver.disconnect();
            log('Editor removed, cleaned up formatter');
        } else if (insertionParent && !insertionParent.contains(formattingButtons)) {
            // React might have re-rendered the surrounding UI and removed our buttons.
            // If the editor is still around, we should try to re-attach.
            log('Formatting buttons were removed by external script. Removing editor from state to trigger re-scan.');
            state.editors.delete(editor);
            state.formattingBars.delete(editor);
            formattingButtons.remove();
            removalObserver.disconnect();
        }
    });

    const observerTarget = isModalEditor 
        ? (editor.closest('[role="dialog"], .share-box, .share-creation-state') || document.body)
        : (editor._commentScope || editor.closest('[role="listitem"]') || editor.closest('form') || document.body);
        
    removalObserver.observe(observerTarget, { childList: true, subtree: true });

    // Track focus for all editor types
    editor.addEventListener('focus', () => {
        state.currentEditor = editor;
        log('Editor focused:', editor);
    });
}

// Scan for editors and attach formatters
function scanForEditors() {
    log('Scanning for post editors...');
    // Process ALL new editors found, not just one per scan cycle.
    // This ensures scrolling to new posts or opening replies catches everything.
    let editor = findPostEditor();
    let count = 0;
    while (editor && !state.editors.has(editor) && count < 10) {
        attachFormatter(editor);
        count++;
        editor = findPostEditor();
    }
}

// Handle DOM mutations
function handleMutations(mutations) {
    // Just trigger a scan instead of processing each mutation
    scanForEditors();
}

const debouncedHandleMutations = debounce(handleMutations, 250);

// Set up observers
function setupObservers() {
    // DOM mutation observer - less aggressive
    state.observer = new MutationObserver(debouncedHandleMutations);
    state.observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // URL change observer for SPA navigation
    let lastUrl = location.href;
    state.urlCheckInterval = setInterval(() => {
        const currentUrl = location.href;
        if (currentUrl !== lastUrl) {
            log('URL changed from', lastUrl, 'to', currentUrl);
            lastUrl = currentUrl;
            // Clear existing editors tracking
            state.editors = new WeakSet();
            // Re-scan after navigation
            setTimeout(scanForEditors, 1000);
        }
    }, 1000);

    // Cleanup interval on page unload
    window.addEventListener('beforeunload', () => {
        if (state.urlCheckInterval) {
            clearInterval(state.urlCheckInterval);
            state.urlCheckInterval = null;
        }
    });

    log('Observers set up successfully');
}

// Keyboard shortcuts
function setupKeyboardShortcuts() {
    // Load keyboard shortcuts setting on initialization
    chrome.storage.local.get(['settings'], (result) => {
        const settings = result.settings || {};
        state.keyboardShortcutsEnabled = settings.keyboardShortcuts !== false; // Default to true
    });

    // Listen for settings changes
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes.settings) {
            const newSettings = changes.settings.newValue || {};
            state.keyboardShortcutsEnabled = newSettings.keyboardShortcuts !== false;
        }
    });

    document.addEventListener('keydown', (e) => {
        // Check if we're in an editor
        if (!state.currentEditor || !state.currentEditor.isContentEditable) {
            return;
        }

        // Check if keyboard shortcuts are enabled
        if (!state.keyboardShortcutsEnabled) {
            return;
        }

        const isModifier = e.ctrlKey || e.metaKey;
        const isShift = e.shiftKey;

        // Ctrl/Cmd + B for bold
        if (isModifier && !isShift && e.key === 'b') {
            e.preventDefault();
            formatText('bold');
            trackUsage('bold');
        }
        // Ctrl/Cmd + I for italic
        else if (isModifier && !isShift && e.key === 'i') {
            e.preventDefault();
            formatText('italic');
            trackUsage('italic');
        }
        // Ctrl/Cmd + U for underline
        else if (isModifier && !isShift && e.key === 'u') {
            e.preventDefault();
            formatText('underline');
            trackUsage('underline');
        }
        // Ctrl/Cmd + S for strikethrough
        else if (isModifier && !isShift && e.key === 's') {
            e.preventDefault();
            formatText('strikethrough');
            trackUsage('strikethrough');
        }
    });

    log('Keyboard shortcuts set up');
}

// Whitelist of allowed formatting actions
const ALLOWED_ACTIONS = [
    'bold', 'italic', 'boldItalic', 'strikethrough', 'underline',
    'monospace', 'sansSerif', 'script', 'circled', 'negativeCircled',
    'squared', 'fullwidth', 'bullet', 'arrow', 'numbered',
    'uppercase', 'lowercase', 'titleCase', 'clear'
];

// Message listener for extension communication
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    log('Message received:', request.action);
    if (request.action && ALLOWED_ACTIONS.includes(request.action)) {
        formatText(request.action);
        sendResponse({ success: true });
    } else if (request.action) {
        logError('Invalid action received:', request.action);
        sendResponse({ success: false, error: 'Invalid action' });
    }
    return true;
});

// Initialize the extension
function init() {
    log('LinkedIn Formatter - Enhanced Version initializing...');

    try {
        // Clean up stale formatting buttons from previous extension loads/reloads.
        // LinkedIn's React doesn't remove them, so they persist as orphaned elements.
        document.querySelectorAll('.linkedin-formatter-buttons').forEach(el => {
            log('Cleaning up stale formatting buttons');
            el.remove();
        });

        injectToolbarStyles();
        setupObservers();
        setupKeyboardShortcuts();

        // Initial scan after a delay to let LinkedIn load
        setTimeout(scanForEditors, 1000);
        setTimeout(scanForEditors, 2000);
        setTimeout(scanForEditors, 3000);

        // Periodic scan every 1 second for robustness (catches Shadow DOM insertions)
        setInterval(() => {
            const editor = findPostEditor();
            if (editor && !state.editors.has(editor)) {
                log('Periodic scan found new editor');
                scanForEditors();
            }
        }, 1000);

        log('LinkedIn Formatter initialized successfully');
    } catch (error) {
        logError('Error initializing LinkedIn Formatter:', error);
        // Retry initialization after delay
        setTimeout(init, 2000);
    }
}

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Error recovery
window.addEventListener('error', (e) => {
    logError('Extension error:', e);
});

log('LinkedIn Formatter script loaded');
