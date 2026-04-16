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
    savedSelection: null,  // Store selection when opening dropdown
    keyboardShortcutsEnabled: true  // Cache keyboard shortcuts setting
};

// Unicode character mapping for text formatting
const unicodeRanges = {
    bold: {
        uppercase: 0x1D5D4,  // A-Z: U+1D5D4 to U+1D5ED
        lowercase: 0x1D5EE,  // a-z: U+1D5EE to U+1D607
        numbers: 0x1D7EC     // 0-9: U+1D7EC to U+1D7F5
    },
    italic: {
        uppercase: 0x1D608,  // A-Z
        lowercase: 0x1D622   // a-z
    },
    boldItalic: {
        uppercase: 0x1D63C,  // A-Z
        lowercase: 0x1D656   // a-z
    },
    monospace: {
        uppercase: 0x1D670,  // A-Z: U+1D670 to U+1D689
        lowercase: 0x1D68A,  // a-z: U+1D68A to U+1D6A3
        numbers: 0x1D7F6     // 0-9: U+1D7F6 to U+1D7FF
    },
    sansSerif: {
        uppercase: 0x1D5A0,  // A-Z
        lowercase: 0x1D5BA,  // a-z
        numbers: 0x1D7E2     // 0-9
    },
    script: {
        uppercase: 0x1D49C,  // A-Z (with some exceptions)
        lowercase: 0x1D4B6   // a-z
    },
    // Strikethrough and underline use combining characters
    strikethrough: {
        combiningChar: '\u0336'  // Combining long stroke overlay
    },
    underline: {
        combiningChar: '\u0332'  // Combining low line
    }
};

// Legacy maps for backwards compatibility and reverse conversion
const boldMap = {
    'A': '𝐀', 'B': '𝐁', 'C': '𝐂', 'D': '𝐃', 'E': '𝐄', 'F': '𝐅', 'G': '𝐆', 'H': '𝐇', 'I': '𝐈', 'J': '𝐉',
    'K': '𝐊', 'L': '𝐋', 'M': '𝐌', 'N': '𝐍', 'O': '𝐎', 'P': '𝐏', 'Q': '𝐐', 'R': '𝐑', 'S': '𝐒', 'T': '𝐓',
    'U': '𝐔', 'V': '𝐕', 'W': '𝐖', 'X': '𝐗', 'Y': '𝐘', 'Z': '𝐙',
    'a': '𝐚', 'b': '𝐛', 'c': '𝐜', 'd': '𝐝', 'e': '𝐞', 'f': '𝐟', 'g': '𝐠', 'h': '𝐡', 'i': '𝐢', 'j': '𝐣',
    'k': '𝐤', 'l': '𝐥', 'm': '𝐦', 'n': '𝐧', 'o': '𝐨', 'p': '𝐩', 'q': '𝐪', 'r': '𝐫', 's': '𝐬', 't': '𝐭',
    'u': '𝐮', 'v': '𝐯', 'w': '𝐰', 'x': '𝐱', 'y': '𝐲', 'z': '𝐳',
    '0': '𝟎', '1': '𝟏', '2': '𝟐', '3': '𝟑', '4': '𝟒', '5': '𝟓', '6': '𝟔', '7': '𝟕', '8': '𝟖', '9': '𝟗'
};

const italicMap = {
    'A': '𝐴', 'B': '𝐵', 'C': '𝐶', 'D': '𝐷', 'E': '𝐸', 'F': '𝐹', 'G': '𝐺', 'H': '𝐻', 'I': '𝐼', 'J': '𝐽',
    'K': '𝐾', 'L': '𝐿', 'M': '𝑀', 'N': '𝑁', 'O': '𝑂', 'P': '𝑃', 'Q': '𝑄', 'R': '𝑅', 'S': '𝑆', 'T': '𝑇',
    'U': '𝑈', 'V': '𝑉', 'W': '𝑊', 'X': '𝑋', 'Y': '𝑌', 'Z': '𝑍',
    'a': '𝑎', 'b': '𝑏', 'c': '𝑐', 'd': '𝑑', 'e': '𝑒', 'f': '𝑓', 'g': '𝑔', 'h': 'ℎ', 'i': '𝑖', 'j': '𝑗',
    'k': '𝑘', 'l': '𝑙', 'm': '𝑚', 'n': '𝑛', 'o': '𝑜', 'p': '𝑝', 'q': '𝑞', 'r': '𝑟', 's': '𝑠', 't': '𝑡',
    'u': '𝑢', 'v': '𝑣', 'w': '𝑤', 'x': '𝑥', 'y': '𝑦', 'z': '𝑧'
};

const boldItalicMap = {
    'A': '𝑨', 'B': '𝑩', 'C': '𝑪', 'D': '𝑫', 'E': '𝑬', 'F': '𝑭', 'G': '𝑮', 'H': '𝑯', 'I': '𝑰', 'J': '𝑱',
    'K': '𝑲', 'L': '𝑳', 'M': '𝑴', 'N': '𝑵', 'O': '𝑶', 'P': '𝑷', 'Q': '𝑸', 'R': '𝑹', 'S': '𝑺', 'T': '𝑻',
    'U': '𝑼', 'V': '𝑽', 'W': '𝑾', 'X': '𝑿', 'Y': '𝒀', 'Z': '𝒁',
    'a': '𝒂', 'b': '𝒃', 'c': '𝒄', 'd': '𝒅', 'e': '𝒆', 'f': '𝒇', 'g': '𝒈', 'h': '𝒉', 'i': '𝒊', 'j': '𝒋',
    'k': '𝒌', 'l': '𝒍', 'm': '𝒎', 'n': '𝒏', 'o': '𝒐', 'p': '𝒑', 'q': '𝒒', 'r': '𝒓', 's': '𝒔', 't': '𝒕',
    'u': '𝒖', 'v': '𝒗', 'w': '𝒘', 'x': '𝒙', 'y': '𝒚', 'z': '𝒛'
};

// Reverse lookup maps for O(1) performance instead of O(n) indexOf
const reverseBoldMap = Object.fromEntries(Object.entries(boldMap).map(([k, v]) => [v, k]));
const reverseItalicMap = Object.fromEntries(Object.entries(italicMap).map(([k, v]) => [v, k]));
const reverseBoldItalicMap = Object.fromEntries(Object.entries(boldItalicMap).map(([k, v]) => [v, k]));

// Utility: Debounce function to limit execution frequency (optimized)
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Helper function to check if a character is a Unicode formatted character
function isUnicodeFormattedChar(char) {
    const codePoint = char.codePointAt(0);
    
    // Check all Unicode formatting ranges
    return (
        // Bold: U+1D5D4-U+1D607, U+1D7EC-U+1D7F5
        (codePoint >= 0x1D5D4 && codePoint <= 0x1D607) || (codePoint >= 0x1D7EC && codePoint <= 0x1D7F5) ||
        // Italic: U+1D608-U+1D63B
        (codePoint >= 0x1D608 && codePoint <= 0x1D63B) ||
        // Bold Italic: U+1D63C-U+1D66F
        (codePoint >= 0x1D63C && codePoint <= 0x1D66F) ||
        // Monospace: U+1D670-U+1D6A3, U+1D7F6-U+1D7FF
        (codePoint >= 0x1D670 && codePoint <= 0x1D6A3) || (codePoint >= 0x1D7F6 && codePoint <= 0x1D7FF) ||
        // Sans-serif: U+1D5A0-U+1D5B9, U+1D5BA-U+1D5D3, U+1D7E2-U+1D7EB
        (codePoint >= 0x1D5A0 && codePoint <= 0x1D5B9) || (codePoint >= 0x1D5BA && codePoint <= 0x1D5D3) || (codePoint >= 0x1D7E2 && codePoint <= 0x1D7EB) ||
        // Script: U+1D49C-U+1D4CF, U+1D4B6-U+1D4E9
        (codePoint >= 0x1D49C && codePoint <= 0x1D4CF) || (codePoint >= 0x1D4B6 && codePoint <= 0x1D4E9) ||
        // Circled: U+24B6-U+24CF, U+24D0-U+24E9, U+24EA, U+2460-U+2468
        (codePoint >= 0x24B6 && codePoint <= 0x24CF) || (codePoint >= 0x24D0 && codePoint <= 0x24E9) || 
        codePoint === 0x24EA || (codePoint >= 0x2460 && codePoint <= 0x2468) ||
        // Negative Circled: U+1F150-U+1F169
        (codePoint >= 0x1F150 && codePoint <= 0x1F169) ||
        // Squared: U+1F130-U+1F149
        (codePoint >= 0x1F130 && codePoint <= 0x1F149) ||
        // Fullwidth: U+FF21-U+FF3A, U+FF41-U+FF5A, U+FF10-U+FF19, U+3000
        (codePoint >= 0xFF21 && codePoint <= 0xFF3A) || (codePoint >= 0xFF41 && codePoint <= 0xFF5A) ||
        (codePoint >= 0xFF10 && codePoint <= 0xFF19) || codePoint === 0x3000
    );
}

// Helper function to convert a Unicode formatted character back to plain ASCII
function unicodeToPlainChar(char) {
    const codePoint = char.codePointAt(0);
    
    // Bold: U+1D5D4-U+1D607, U+1D7EC-U+1D7F5
    if (codePoint >= 0x1D5D4 && codePoint <= 0x1D5ED) return String.fromCharCode(65 + (codePoint - 0x1D5D4));
    if (codePoint >= 0x1D5EE && codePoint <= 0x1D607) return String.fromCharCode(97 + (codePoint - 0x1D5EE));
    if (codePoint >= 0x1D7EC && codePoint <= 0x1D7F5) return String.fromCharCode(48 + (codePoint - 0x1D7EC));
    
    // Italic: U+1D608-U+1D63B
    if (codePoint >= 0x1D608 && codePoint <= 0x1D621) return String.fromCharCode(65 + (codePoint - 0x1D608));
    if (codePoint >= 0x1D622 && codePoint <= 0x1D63B) return String.fromCharCode(97 + (codePoint - 0x1D622));
    
    // Bold Italic: U+1D63C-U+1D66F
    if (codePoint >= 0x1D63C && codePoint <= 0x1D655) return String.fromCharCode(65 + (codePoint - 0x1D63C));
    if (codePoint >= 0x1D656 && codePoint <= 0x1D66F) return String.fromCharCode(97 + (codePoint - 0x1D656));
    
    // Monospace: U+1D670-U+1D6A3, U+1D7F6-U+1D7FF
    if (codePoint >= 0x1D670 && codePoint <= 0x1D689) return String.fromCharCode(65 + (codePoint - 0x1D670));
    if (codePoint >= 0x1D68A && codePoint <= 0x1D6A3) return String.fromCharCode(97 + (codePoint - 0x1D68A));
    if (codePoint >= 0x1D7F6 && codePoint <= 0x1D7FF) return String.fromCharCode(48 + (codePoint - 0x1D7F6));
    
    // Sans-serif: U+1D5A0-U+1D5B9, U+1D5BA-U+1D5D3, U+1D7E2-U+1D7EB
    if (codePoint >= 0x1D5A0 && codePoint <= 0x1D5B9) return String.fromCharCode(65 + (codePoint - 0x1D5A0));
    if (codePoint >= 0x1D5BA && codePoint <= 0x1D5D3) return String.fromCharCode(97 + (codePoint - 0x1D5BA));
    if (codePoint >= 0x1D7E2 && codePoint <= 0x1D7EB) return String.fromCharCode(48 + (codePoint - 0x1D7E2));
    
    // Script: U+1D49C-U+1D4CF, U+1D4B6-U+1D4E9
    if (codePoint >= 0x1D49C && codePoint <= 0x1D4CF) return String.fromCharCode(65 + (codePoint - 0x1D49C));
    if (codePoint >= 0x1D4B6 && codePoint <= 0x1D4E9) return String.fromCharCode(97 + (codePoint - 0x1D4B6));
    
    // Circled: U+24B6-U+24CF, U+24D0-U+24E9, U+24EA, U+2460-U+2468
    if (codePoint >= 0x24B6 && codePoint <= 0x24CF) return String.fromCharCode(65 + (codePoint - 0x24B6));
    if (codePoint >= 0x24D0 && codePoint <= 0x24E9) return String.fromCharCode(97 + (codePoint - 0x24D0));
    if (codePoint === 0x24EA) return '0';
    if (codePoint >= 0x2460 && codePoint <= 0x2468) return String.fromCharCode(49 + (codePoint - 0x2460));
    
    // Negative Circled: U+1F150-U+1F169
    if (codePoint >= 0x1F150 && codePoint <= 0x1F169) return String.fromCharCode(65 + (codePoint - 0x1F150));
    
    // Squared: U+1F130-U+1F149
    if (codePoint >= 0x1F130 && codePoint <= 0x1F149) return String.fromCharCode(65 + (codePoint - 0x1F130));
    
    // Fullwidth: U+FF21-U+FF3A, U+FF41-U+FF5A, U+FF10-U+FF19, U+3000
    if (codePoint >= 0xFF21 && codePoint <= 0xFF3A) return String.fromCharCode(65 + (codePoint - 0xFF21));
    if (codePoint >= 0xFF41 && codePoint <= 0xFF5A) return String.fromCharCode(97 + (codePoint - 0xFF41));
    if (codePoint >= 0xFF10 && codePoint <= 0xFF19) return String.fromCharCode(48 + (codePoint - 0xFF10));
    if (codePoint === 0x3000) return ' ';
    
    // Check reverse maps for legacy support
    if (reverseBoldMap[char]) return reverseBoldMap[char];
    if (reverseItalicMap[char]) return reverseItalicMap[char];
    if (reverseBoldItalicMap[char]) return reverseBoldItalicMap[char];
    
    return char; // Not a Unicode formatted character
}

// Enhanced Unicode conversion using character code ranges
function convertToUnicode(text, style) {
    // Special case for circled text
    if (style === 'circled') {
        let result = '';
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const code = char.charCodeAt(0);
            // Uppercase A-Z → Ⓐ-Ⓩ (U+24B6 to U+24CF)
            if (code >= 65 && code <= 90) {
                result += String.fromCodePoint(0x24B6 + (code - 65));
            }
            // Lowercase a-z → ⓐ-ⓩ (U+24D0 to U+24E9)
            else if (code >= 97 && code <= 122) {
                result += String.fromCodePoint(0x24D0 + (code - 97));
            }
            // Numbers 0-9 → ⓪-⑨ (U+24EA, U+2460-2468)
            else if (code >= 48 && code <= 57) {
                if (char === '0') {
                    result += '⓪';
                } else {
                    result += String.fromCodePoint(0x245F + (code - 48));
                }
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
            // Uppercase A-Z → 🅐-🅩 (U+1F150 to U+1F169)
            if (code >= 65 && code <= 90) {
                result += String.fromCodePoint(0x1F150 + (code - 65));
            }
            // Lowercase - use uppercase negative circled
            else if (code >= 97 && code <= 122) {
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
            // Uppercase A-Z → 🄰-🅉 (U+1F130 to U+1F149)
            if (code >= 65 && code <= 90) {
                result += String.fromCodePoint(0x1F130 + (code - 65));
            }
            // Lowercase - use uppercase squared
            else if (code >= 97 && code <= 122) {
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
            // Uppercase A-Z → Ａ-Ｚ (U+FF21 to U+FF3A)
            if (code >= 65 && code <= 90) {
                result += String.fromCodePoint(0xFF21 + (code - 65));
            }
            // Lowercase a-z → ａ-ｚ (U+FF41 to U+FF5A)
            else if (code >= 97 && code <= 122) {
                result += String.fromCodePoint(0xFF41 + (code - 97));
            }
            // Numbers 0-9 → ０-９ (U+FF10 to U+FF19)
            else if (code >= 48 && code <= 57) {
                result += String.fromCodePoint(0xFF10 + (code - 48));
            }
            // Space → fullwidth space
            else if (code === 32) {
                result += String.fromCodePoint(0x3000);
            } else {
                result += char;
            }
        }
        return result;
    }

    // Special case for script text (has some exceptions)
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
            const char = text[i];
            result += scriptMap[char] || char;
        }
        return result;
    }

    const range = unicodeRanges[style];
    if (!range) return text;

    // Handle combining characters (strikethrough, underline)
    if (range.combiningChar) {
        let result = '';
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            // Don't add combining char to spaces or special chars
            if (char === ' ' || char === '\n' || char === '\r') {
                result += char;
            } else {
                // If character is already Unicode formatted, convert it back to plain ASCII first
                // This prevents combining characters from being attached to Unicode characters
                // which causes rendering issues (diamond-question-mark characters)
                const plainChar = isUnicodeFormattedChar(char) ? unicodeToPlainChar(char) : char;
                result += plainChar + range.combiningChar;
            }
        }
        return result;
    }

    // Handle regular Unicode ranges (bold, italic, monospace, etc.)
    let result = '';
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const code = char.charCodeAt(0);

        // Uppercase A-Z (65-90)
        if (code >= 65 && code <= 90 && range.uppercase) {
            result += String.fromCodePoint(code - 65 + range.uppercase);
        }
        // Lowercase a-z (97-122)
        else if (code >= 97 && code <= 122 && range.lowercase) {
            result += String.fromCodePoint(code - 97 + range.lowercase);
        }
        // Numbers 0-9 (48-57)
        else if (code >= 48 && code <= 57 && range.numbers) {
            result += String.fromCodePoint(code - 48 + range.numbers);
        } else {
            result += char; // Keep original if no mapping
        }
    }
    return result;
}

// Check if text is already formatted
function isFormatted(text, style) {
    const range = unicodeRanges[style];
    if (!range) return false;

    // Check for combining characters
    if (range.combiningChar) {
        return text.includes(range.combiningChar);
    }

    // Use reverse maps for O(1) lookup instead of O(n) Object.values().includes()
    const reverseMap = style === 'bold' ? reverseBoldMap :
                       style === 'italic' ? reverseItalicMap :
                       style === 'boldItalic' ? reverseBoldItalicMap : null;

    if (reverseMap) {
        // Check if any character exists in reverse map (means it's formatted)
        for (let i = 0; i < text.length; i++) {
            if (reverseMap[text[i]]) {
                return true;
            }
        }
        return false;
    }

    // Fallback: Check legacy maps for backward compatibility (shouldn't reach here for bold/italic/boldItalic)
    const map = style === 'bold' ? boldMap :
                 style === 'italic' ? italicMap :
                 style === 'boldItalic' ? boldItalicMap : null;

    if (map) {
        // Last resort: check against map values (for styles without reverse maps)
        for (let i = 0; i < text.length; i++) {
            if (Object.values(map).includes(text[i])) {
                return true;
            }
        }
        return false;
    }

    return false;
}

// Remove Unicode formatting
function removeFormatting(text, style) {
    const range = unicodeRanges[style];
    if (!range) return text;

    // Remove combining characters using regex replace (more efficient than split/join)
    if (range.combiningChar) {
        // Escape the combining character for regex
        const escaped = range.combiningChar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return text.replace(new RegExp(escaped, 'g'), '');
    }

    // Use reverse lookup maps for O(1) performance instead of O(n) indexOf
    const reverseMap = style === 'bold' ? reverseBoldMap :
                       style === 'italic' ? reverseItalicMap :
                       style === 'boldItalic' ? reverseBoldItalicMap : null;

    if (reverseMap) {
        let result = '';
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            result += reverseMap[char] || char;
        }
        return result;
    }

    return text;
}

// Remove all Unicode formatting from text using the actual Unicode ranges
function clearFormatting(text) {
    if (!text) return '';

    log('clearFormatting - processing text of length:', text?.length || 0);

    // First, remove combining characters (strikethrough and underline)
    // These need to be removed BEFORE processing individual characters
    let result = text;
    result = result.replace(/\u0336/g, ''); // Combining long stroke overlay (strikethrough)
    result = result.replace(/\u0332/g, ''); // Combining low line (underline)

    // Now process each character to convert formatted text back to plain
    // Use Array.from to properly handle Unicode characters (including surrogate pairs)
    result = Array.from(result).map(char => {
        // Skip whitespace characters - preserve them exactly
        if (char === ' ' || char === '\n' || char === '\r' || char === '\t') {
            return char;
        }

        // Use codePointAt to get the actual Unicode code point (handles surrogate pairs)
        const codePoint = char.codePointAt(0);

        // Bold (Sans-serif): U+1D5D4-U+1D607, U+1D7EC-U+1D7F5
        if (codePoint >= 0x1D5D4 && codePoint <= 0x1D5ED) {
            return String.fromCharCode(65 + (codePoint - 0x1D5D4)); // Bold uppercase A-Z
        }
        if (codePoint >= 0x1D5EE && codePoint <= 0x1D607) {
            return String.fromCharCode(97 + (codePoint - 0x1D5EE)); // Bold lowercase a-z
        }
        if (codePoint >= 0x1D7EC && codePoint <= 0x1D7F5) {
            return String.fromCharCode(48 + (codePoint - 0x1D7EC)); // Bold numbers 0-9
        }

        // Italic: U+1D608-U+1D63B
        if (codePoint >= 0x1D608 && codePoint <= 0x1D621) {
            return String.fromCharCode(65 + (codePoint - 0x1D608)); // Italic uppercase A-Z
        }
        if (codePoint >= 0x1D622 && codePoint <= 0x1D63B) {
            return String.fromCharCode(97 + (codePoint - 0x1D622)); // Italic lowercase a-z
        }

        // Bold Italic: U+1D63C-U+1D66F
        if (codePoint >= 0x1D63C && codePoint <= 0x1D655) {
            return String.fromCharCode(65 + (codePoint - 0x1D63C)); // Bold Italic uppercase A-Z
        }
        if (codePoint >= 0x1D656 && codePoint <= 0x1D66F) {
            return String.fromCharCode(97 + (codePoint - 0x1D656)); // Bold Italic lowercase a-z
        }

        // Monospace: U+1D670-U+1D6A3, U+1D7F6-U+1D7FF
        if (codePoint >= 0x1D670 && codePoint <= 0x1D689) {
            return String.fromCharCode(65 + (codePoint - 0x1D670)); // Monospace uppercase A-Z
        }
        if (codePoint >= 0x1D68A && codePoint <= 0x1D6A3) {
            return String.fromCharCode(97 + (codePoint - 0x1D68A)); // Monospace lowercase a-z
        }
        if (codePoint >= 0x1D7F6 && codePoint <= 0x1D7FF) {
            return String.fromCharCode(48 + (codePoint - 0x1D7F6)); // Monospace numbers 0-9
        }

        // Sans-serif: U+1D5A0-U+1D5B9, U+1D5BA-U+1D5D3, U+1D7E2-U+1D7EB
        if (codePoint >= 0x1D5A0 && codePoint <= 0x1D5B9) {
            return String.fromCharCode(65 + (codePoint - 0x1D5A0)); // Sans-serif uppercase A-Z
        }
        if (codePoint >= 0x1D5BA && codePoint <= 0x1D5D3) {
            return String.fromCharCode(97 + (codePoint - 0x1D5BA)); // Sans-serif lowercase a-z
        }
        if (codePoint >= 0x1D7E2 && codePoint <= 0x1D7EB) {
            return String.fromCharCode(48 + (codePoint - 0x1D7E2)); // Sans-serif numbers 0-9
        }

        // Script: U+1D49C-U+1D4CF (uppercase), U+1D4B6-U+1D4E9 (lowercase)
        // Note: Script has some exceptions, but we'll handle the main ranges
        if (codePoint >= 0x1D49C && codePoint <= 0x1D4CF) {
            return String.fromCharCode(65 + (codePoint - 0x1D49C)); // Script uppercase A-Z
        }
        if (codePoint >= 0x1D4B6 && codePoint <= 0x1D4E9) {
            return String.fromCharCode(97 + (codePoint - 0x1D4B6)); // Script lowercase a-z
        }

        // Circled: U+24B6-U+24CF (uppercase), U+24D0-U+24E9 (lowercase), U+24EA (0), U+2460-U+2468 (1-9)
        if (codePoint >= 0x24B6 && codePoint <= 0x24CF) {
            return String.fromCharCode(65 + (codePoint - 0x24B6)); // Circled uppercase A-Z
        }
        if (codePoint >= 0x24D0 && codePoint <= 0x24E9) {
            return String.fromCharCode(97 + (codePoint - 0x24D0)); // Circled lowercase a-z
        }
        if (codePoint === 0x24EA) {
            return '0'; // Circled 0
        }
        if (codePoint >= 0x2460 && codePoint <= 0x2468) {
            return String.fromCharCode(49 + (codePoint - 0x2460)); // Circled 1-9
        }

        // Negative Circled: U+1F150-U+1F169 (uppercase and lowercase)
        if (codePoint >= 0x1F150 && codePoint <= 0x1F169) {
            // Both uppercase and lowercase map to the same range, convert to uppercase
            const offset = codePoint - 0x1F150;
            return String.fromCharCode(65 + offset); // Negative circled A-Z
        }

        // Squared: U+1F130-U+1F149 (uppercase and lowercase)
        if (codePoint >= 0x1F130 && codePoint <= 0x1F149) {
            // Both uppercase and lowercase map to the same range, convert to uppercase
            const offset = codePoint - 0x1F130;
            return String.fromCharCode(65 + offset); // Squared A-Z
        }

        // Fullwidth: U+FF21-U+FF3A (uppercase), U+FF41-U+FF5A (lowercase), U+FF10-U+FF19 (numbers), U+3000 (space)
        if (codePoint >= 0xFF21 && codePoint <= 0xFF3A) {
            return String.fromCharCode(65 + (codePoint - 0xFF21)); // Fullwidth uppercase A-Z
        }
        if (codePoint >= 0xFF41 && codePoint <= 0xFF5A) {
            return String.fromCharCode(97 + (codePoint - 0xFF41)); // Fullwidth lowercase a-z
        }
        if (codePoint >= 0xFF10 && codePoint <= 0xFF19) {
            return String.fromCharCode(48 + (codePoint - 0xFF10)); // Fullwidth numbers 0-9
        }
        if (codePoint === 0x3000) {
            return ' '; // Fullwidth space → regular space
        }

        // Also check reverse legacy maps for backwards compatibility (O(1) lookup)
        const reverseMaps = [reverseBoldMap, reverseItalicMap, reverseBoldItalicMap];
        for (const reverseMap of reverseMaps) {
            if (reverseMap[char]) {
                return reverseMap[char];
            }
        }

        // Not a formatted character, return as-is
        return char;
    }).join('');

    // Remove bullet points (but preserve spaces after them if any)
    result = result.replace(/^•\s*/gm, '');
    result = result.replace(/●\s*/g, '');
    result = result.replace(/^→\s*/gm, '');

    // Remove numbered lists (e.g., "1. ", "2) ", etc.)
    result = result.replace(/^\d+[\.\)]\s+/gm, '');

    // Collapse consecutive newlines to single newlines
    // Prevents extra blank lines when clearing formatting across <p> elements
    // (selection.toString() can return \n\n between paragraphs)
    result = result.replace(/\n{2,}/g, '\n');

    log('clearFormatting - output text length:', result?.length || 0);
    return result;
}

// Save current selection
function saveSelection() {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        state.savedSelection = selection.getRangeAt(0).cloneRange();
        log('Selection saved - length:', state.savedSelection?.toString().length || 0);
    }
}

// Restore saved selection
function restoreSelection() {
    if (state.savedSelection) {
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(state.savedSelection);
        log('Selection restored - length:', state.savedSelection?.toString().length || 0);
    }
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

    const fontOptions = [
        { text: '𝗦𝗮𝗻𝘀-𝘀𝗲𝗿𝗶𝗳', action: 'sansSerif', label: 'Sans-serif' },
        { text: '𝓢𝓬𝓻𝓲𝓹𝓽', action: 'script', label: 'Script' },
        { text: 'Ⓒⓘⓡⓒⓛⓔⓓ', action: 'circled', label: 'Circled' },
        { text: '🅝🅔🅖🅐🅣🅘🅥🅔', action: 'negativeCircled', label: 'Negative Circled' },
        { text: '🅂🅀🅄🄰🅁🄴🄳', action: 'squared', label: 'Squared' },
        { text: 'Ｆｕｌｌｗｉｄｔｈ', action: 'fullwidth', label: 'Fullwidth' },
        { text: '𝙼𝚘𝚗𝚘𝚜𝚙𝚊𝚌𝚎', action: 'monospace', label: 'Monospace' },
        { text: 'AAA', action: 'uppercase', label: 'UPPERCASE' },
        { text: 'aaa', action: 'lowercase', label: 'lowercase' }
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

            // Always restore selection to guarantee focus returns to the editor
            if (state.savedSelection) {
                restoreSelection();
            }

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
            
            // Always restore selection to guarantee focus returns to the editor
            if (state.savedSelection) {
                restoreSelection();
            }
            
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
        { text: 'Aa', action: 'font-dropdown', title: 'Font Style', isDropdown: true },
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
        } else if (button.action === 'font-dropdown') {
            // Font style selector - Text Aa
            btn.textContent = 'Aa';
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
            // Save selection in case we need it later (especially for dropdown)
            saveSelection();
        };

        // Handle dropdown button specially
        if (button.isDropdown) {
            let dropdown;
            if (button.action === 'font-dropdown') {
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
                container.querySelectorAll('.linkedin-formatter-font-dropdown, .linkedin-formatter-list-dropdown').forEach(d => {
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
                
                // If selection was lost, restore it
                if (state.savedSelection) {
                    restoreSelection();
                }
                
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
            // Restore the specific selection if we changed focus
            if (window.getSelection && range) {
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
            }
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
    
    let localSearchContainer = editor;
    for (let i = 0; i < 15; i++) {
        if (localSearchContainer.parentElement) {
            localSearchContainer = localSearchContainer.parentElement;
        }
    }

    log('Looking for emoji button');

    // Prioritize bottom toolbar buttons (Schedule/Clock) so the formatter appears at the very bottom
    // Fall back to media/emoji for comments which don't have a schedule button
    const targetSelectors = [
        // 1. Bottom row with Post button
        'button[aria-label*="schedule" i]',
        'button[aria-label*="Schedule" i]',
        // 2. Middle row / Comment toolbars
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

    let foundButton = null;
    let selectorUsed = '';
    for (const selector of targetSelectors) {
        // Try shadow root first, then fallback to local container
        foundButton = (rootSearchTarget.querySelector && rootSearchTarget.querySelector(selector)) || localSearchContainer.querySelector(selector);
        if (foundButton) {
            log(`Found native toolbar button with selector: ${selector}`);
            selectorUsed = selector;
            break;
        }
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
        // Comment toolbars / standard injection
        // Instead of injecting inside the small pill (which squishes the input), 
        // we append it below the form or the closest macro-wrapper.
        const formWrapper = editor.closest('form') || editor.closest('.comments-comment-box') || toolbar.parentElement.parentElement;
        
        formattingButtons.style.setProperty('margin-top', '8px', 'important');
        formattingButtons.style.setProperty('margin-bottom', '8px', 'important');
        formattingButtons.style.setProperty('width', '100%', 'important');
        formattingButtons.style.setProperty('justify-content', 'flex-start', 'important');
        
        if (formWrapper && formWrapper.parentElement) {
            // Append right after the form wrapper
            formWrapper.insertAdjacentElement('afterend', formattingButtons);
        } else {
            // Fallback
            toolbar.appendChild(formattingButtons);
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
        : (editor.closest('form, [class*="comment"]') || document.body);
        
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
    const editor = findPostEditor();

    if (editor && !state.editors.has(editor)) {
        attachFormatter(editor);
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
    'uppercase', 'lowercase', 'clear'
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
