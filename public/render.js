(function(global){
    function escapeHTML(value){
        return String(value == null ? "" : value).replace(/[&<>"']/g, character => ({
            "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
        })[character]);
    }

    function scanTags(content, callback){
        let cursor = 0;
        while((cursor = content.indexOf("<", cursor)) !== -1){
            const end = content.indexOf(">", cursor + 1);
            if(end === -1) return;
            const tag = content.slice(cursor, end + 1);
            const match = /^<\s*(\/?)\s*([a-z][\w:-]*)\b/i.exec(tag);
            if(match) callback(match[2].toLowerCase(), match[1] === "/", tag, cursor, end + 1);
            cursor = end + 1;
        }
    }

    function findHtmlBlockSpans(content){
        const spans = [];
        const stack = [];
        const blockTags = new Set(["table", "div", "ul", "ol", "pre", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "p"]);
        let start = -1;
        scanTags(content, (name, closing, tag, tagStart, tagEnd) => {
            if(!blockTags.has(name)) return;
            if(closing){
                const index = stack.lastIndexOf(name);
                if(index === -1) return;
                stack.length = index;
                if(!stack.length){
                    spans.push([start, tagEnd]);
                    start = -1;
                }
            }else if(!/\/\s*>$/.test(tag)){
                if(!stack.length) start = tagStart;
                stack.push(name);
            }
        });
        return spans;
    }

    function containsMarkdownSignal(content, excludedSpans){
        let cursor = 0;
        let spanIndex = 0;
        while(cursor < content.length){
            const lineEnd = content.indexOf("\n", cursor);
            const end = lineEnd === -1 ? content.length : lineEnd;
            while(spanIndex < excludedSpans.length && excludedSpans[spanIndex][1] <= cursor) spanIndex++;
            const overlapsHtml = spanIndex < excludedSpans.length &&
                excludedSpans[spanIndex][0] < end && excludedSpans[spanIndex][1] > cursor;
            if(!overlapsHtml){
                const line = content.slice(cursor, end).replace(/\r$/, "");
                const trimmed = line.replace(/^[ \t]{0,3}/, "");
                if(/^#{1,6}\s+\S/.test(trimmed) ||
                    /^(?:[-*+] |\d+\. )/.test(trimmed) ||
                    /^>\s+/.test(trimmed) ||
                    isPipeSeparator(trimmed) ||
                    hasBoldMarkers(line)){
                    return true;
                }
            }
            cursor = end + 1;
        }
        return false;
    }

    function isPipeSeparator(line){
        if(line.indexOf("|") === -1 || line.indexOf("-") === -1) return false;
        const cells = line.split("|");
        let count = 0;
        for(const cell of cells){
            const value = cell.trim();
            if(!/^:?-{3,}:?$/.test(value)) continue;
            count++;
        }
        return count >= 2;
    }

    function hasBoldMarkers(line){
        const pairs = ["**", "__"];
        for(const marker of pairs){
            const first = line.indexOf(marker);
            if(first === -1) continue;
            const second = line.indexOf(marker, first + marker.length);
            if(second > first + marker.length) return true;
        }
        return false;
    }

    function replaceSpans(content, spans, replace){
        let result = "";
        let cursor = 0;
        spans.forEach((span, index) => {
            result += content.slice(cursor, span[0]) + replace(content.slice(span[0], span[1]), index);
            cursor = span[1];
        });
        return result + content.slice(cursor);
    }

    function extractMath(content){
        const segments = [];
        let output = "";
        let cursor = 0;
        let openStart = -1;
        let openType = "";
        let braceDepth = 0;
        let index = 0;
        while(index < content.length){
            if(!openType){
                if(content.startsWith("\\ce{", index)){
                    openStart = index;
                    openType = "chem";
                    braceDepth = 1;
                    index += 4;
                    continue;
                }
                if(content.startsWith("\\[", index) || content.startsWith("\\(", index)){
                    openStart = index;
                    openType = content[index + 1] === "[" ? "display-bracket" : "inline-paren";
                    index += 2;
                    continue;
                }
                if(content.startsWith("$$", index) && !isEscaped(content, index)){
                    openStart = index;
                    openType = "display-dollar";
                    index += 2;
                    continue;
                }
                if(content[index] === "$" && !isEscaped(content, index) &&
                    content[index + 1] !== "$" && index + 1 < content.length &&
                    !/\s/.test(content[index + 1])){
                    openStart = index;
                    openType = "inline-dollar";
                    index++;
                    continue;
                }
            }else if(openType === "chem"){
                if(content[index] === "{" && !isEscaped(content, index)) braceDepth++;
                if(content[index] === "}" && !isEscaped(content, index) && --braceDepth === 0){
                    const raw = content.slice(openStart, index + 1);
                    output += content.slice(cursor, openStart);
                    const token = `MATHSEGMENTTOKEN${segments.length}END`;
                    segments.push(raw.startsWith("\\ce{") ? `$${raw}$` : raw);
                    output += token;
                    cursor = index + 1;
                    openType = "";
                }
            }else{
                const closing = openType === "display-dollar" ? "$$" :
                    openType === "inline-dollar" ? "$" :
                    openType === "display-bracket" ? "\\]" : "\\)";
                if(content.startsWith(closing, index) && !isEscaped(content, index)){
                    const closeEnd = index + closing.length;
                    const raw = content.slice(openStart, closeEnd);
                    const isValidInline = openType !== "inline-dollar" ||
                        (index > openStart + 1 && !/\s/.test(content[index - 1]));
                    if(isValidInline){
                        const currency = openType === "inline-dollar" &&
                            /^\$\d+(?:\.\d{1,2})?\s+(?:and|or|to)\s+\$\d+(?:\.\d{1,2})?\$$/i.test(raw);
                        output += content.slice(cursor, openStart);
                        if(currency){
                            output += `MATHSEGMENTTOKEN${segments.length}END`;
                            segments.push({currency:raw});
                        }else{
                            output += `MATHSEGMENTTOKEN${segments.length}END`;
                            segments.push(raw);
                        }
                        cursor = closeEnd;
                        index = closeEnd;
                        openType = "";
                        continue;
                    }
                }
            }
            index++;
        }
        return {
            content:output + content.slice(cursor),
            segments
        };
    }

    function isEscaped(content, index){
        let slashes = 0;
        for(let i = index - 1; i >= 0 && content[i] === "\\"; i--) slashes++;
        return slashes % 2 === 1;
    }

    function normalizeMixedContent(content){
        const normalized = content.split(/\r?\n/).map(line =>
            /^[ \t]*</.test(line) ? line.replace(/^[ \t]+/, "") : line
        ).join("\n");
        const spans = findHtmlBlockSpans(normalized);
        const htmlBlocks = [];
        const markdownInput = replaceSpans(normalized, spans, block => {
            const token = `<!--HTMLBLOCKTOKEN${htmlBlocks.length}END-->`;
            htmlBlocks.push(block);
            return `\n\n${token}\n\n`;
        });
        return {markdownInput, htmlBlocks};
    }

    function renderRichContent(rawString, targetElement, options = {}){
        const source = String(rawString == null ? "" : rawString);
        const inline = options.inline === true;
        const sanitizeOptions = inline ? {
            ALLOWED_TAGS:["sup", "sub", "b", "i", "u", "br", "img"],
            ALLOWED_ATTR:["src", "alt", "class", "style"]
        } : {
            ALLOWED_TAGS:[
                "table", "thead", "tbody", "tfoot", "tr", "th", "td", "sup", "sub",
                "img", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6",
                "p", "br", "strong", "em", "u", "b", "i", "span", "div", "a"
            ],
            ALLOWED_ATTR:[
                "style", "class", "src", "alt", "border", "colspan", "rowspan",
                "href", "target", "rel"
            ]
        };

        try{
            const overSizeLimit = source.length > 100000;
            const hasHtmlTag = source.indexOf("<") !== -1 && (function(){
                let found = false;
                scanTags(source, () => { found = true; });
                return found;
            })();
            const hasMath = !overSizeLimit && (
                source.indexOf("$") !== -1 || source.indexOf("\\[") !== -1 ||
                source.indexOf("\\(") !== -1 || source.indexOf("\\ce{") !== -1
            );
            if(inline && !hasHtmlTag && !hasMath){
                targetElement.textContent = source;
                return;
            }
            if(!inline && !hasHtmlTag && !hasMath && !/[#>*_|\-]/.test(source)){
                targetElement.textContent = source;
                return;
            }

            const mathResult = overSizeLimit || !hasMath ? {content:source, segments:[]} : extractMath(source);
            let rendered;
            let currencySegments = [];
            if(overSizeLimit){
                rendered = source;
            }else if(inline){
                rendered = hasHtmlTag ? mathResult.content : escapeHTML(mathResult.content);
            }else{
                const htmlBlockPattern = /<(?:p|table|thead|tbody|tfoot|tr|th|td|ul|ol|h[1-6]|div|br)\b/i;
                const hasHtmlBlock = htmlBlockPattern.test(source);
                const spans = findHtmlBlockSpans(mathResult.content);
                const hasMarkdown = containsMarkdownSignal(mathResult.content, spans);
                let markdownInput = mathResult.content;
                let htmlBlocks = [];
                if(hasHtmlBlock && hasMarkdown){
                    const normalized = normalizeMixedContent(markdownInput, spans);
                    markdownInput = normalized.markdownInput;
                    htmlBlocks = normalized.htmlBlocks;
                }
                rendered = hasHtmlBlock && !hasMarkdown
                    ? markdownInput
                    : marked.parse(markdownInput, {gfm:true, breaks:true});
                rendered = rendered.replace(/<!--HTMLBLOCKTOKEN(\d+)END-->/g, (token, index) =>
                    htmlBlocks[Number(index)] || token
                );
            }

            rendered = rendered.replace(/MATHSEGMENTTOKEN(\d+)END/g, (token, index) => {
                const segment = mathResult.segments[Number(index)];
                if(segment && typeof segment === "object"){
                    currencySegments.push(segment.currency);
                    return `CURRENCYRESTORETOKEN${currencySegments.length - 1}END`;
                }
                return escapeHTML(segment || token);
            });
            targetElement.innerHTML = DOMPurify.sanitize(rendered, sanitizeOptions);
            if(!inline){
                targetElement.querySelectorAll("table").forEach(table => {
                    const wrapper = document.createElement("div");
                    wrapper.className = "rich-table-scroll";
                    table.parentNode.insertBefore(wrapper, table);
                    wrapper.appendChild(table);
                });
            }
            if(!overSizeLimit && mathResult.segments.some(segment => typeof segment === "string")){
                renderMathInElement(targetElement, {
                    delimiters:[
                        {left:"$$", right:"$$", display:true},
                        {left:"\\[", right:"\\]", display:true},
                        {left:"\\(", right:"\\)", display:false},
                        {left:"$", right:"$", display:false}
                    ],
                    throwOnError:false
                });
            }
            if(currencySegments.length){
                targetElement.innerHTML = targetElement.innerHTML.replace(/CURRENCYRESTORETOKEN(\d+)END/g, (token, index) =>
                    escapeHTML(currencySegments[Number(index)] || token)
                );
            }
        }catch(error){
            console.error("Unable to render rich content", error);
            targetElement.textContent = source;
        }
    }

    global.renderRichContent = renderRichContent;
})(window);
