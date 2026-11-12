(function(global){
    function escapeHTML(value){
        return String(value == null ? "" : value).replace(/[&<>"']/g, character => ({
            "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
        })[character]);
    }

    function findHtmlBlockSpans(content){
        const spans = [];
        const tagPattern = /<\/?(table|div|ul|ol|pre|blockquote|h[1-6]|p)\b[^>]*>/gi;
        const stack = [];
        let start = -1;
        let match;
        while((match = tagPattern.exec(content))){
            const tagName = match[1].toLowerCase();
            if(/^<\//.test(match[0])){
                const matchingIndex = stack.lastIndexOf(tagName);
                if(matchingIndex === -1) continue;
                stack.length = matchingIndex;
                if(!stack.length){
                    spans.push([start, tagPattern.lastIndex]);
                    start = -1;
                }
            }else if(!/\/\s*>$/.test(match[0])){
                if(!stack.length) start = match.index;
                stack.push(tagName);
            }
        }
        return spans;
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
        const hasHtmlTag = /<\/?[a-z][\w:-]*(?:\s[^<>]*?)?\s*\/?>/i.test(source);
        const hasMathDelimiter = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\\ce\{[^{}]*\}|(?<!\\)\$(?!\$)(?=\S)(?:\\.|[^$\r\n\\])*\S\$(?![\d$])/.test(source);

        if(inline && !hasHtmlTag && !hasMathDelimiter){
            targetElement.textContent = source;
            return;
        }

        const htmlBlockPattern = /<(?:p|table|thead|tbody|tfoot|tr|th|td|ul|ol|h[1-6]|div|br)\b/i;
        const markdownPattern =
            /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/m.test(source) ||
            /^\s{0,3}#{1,6}\s+\S/m.test(source) ||
            /^\s*(?:[-*+] |\d+\. )/m.test(source) ||
            /(?:\*\*[^*\r\n]+\*\*|__[^_\r\n]+__)/.test(source) ||
            /^\s{0,3}>\s+/m.test(source);
        const hasMath = hasMathDelimiter;

        if(!inline && !hasHtmlTag && !markdownPattern && !hasMath){
            targetElement.textContent = source;
            return;
        }

        const mathSegments = [];
        const contentWithProtectedMath = source.replace(
            /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\\ce\{[^{}]*\}|(?<!\\)\$(?!\$)(?=\S)(?:\\.|[^$\r\n\\])*\S\$(?![\d$])/g,
            match => {
                const token = `MATHSEGMENTTOKEN${mathSegments.length}END`;
                mathSegments.push(match.startsWith("\\ce{") ? `$${match}$` : match);
                return token;
            }
        );
        const currencySegments = [];
        const protectedContent = contentWithProtectedMath.replace(
            /\$\d+(?:\.\d{1,2})?(?:(?:\s+(?:and|or|to)\s+|,\s*)\$\d+(?:\.\d{1,2})?)+/gi,
            match => {
                const token = `CURRENCYSEGMENTTOKEN${currencySegments.length}END`;
                currencySegments.push(match);
                return token;
            }
        );

        try{
            let rendered;
            let currencyPlaceholders = [];
            if(inline){
                rendered = hasHtmlTag ? protectedContent : escapeHTML(protectedContent);
            }else{
                const hasHtmlBlock = htmlBlockPattern.test(source);
                const htmlBlockSpans = findHtmlBlockSpans(protectedContent);
                let markdownProbe = protectedContent;
                htmlBlockSpans.slice().reverse().forEach(([start, end]) => {
                    const maskedBlock = markdownProbe.slice(start, end).replace(/[^\r\n]/g, " ");
                    markdownProbe = markdownProbe.slice(0, start) + maskedBlock + markdownProbe.slice(end);
                });
                markdownProbe = markdownProbe.replace(/<[^>]*>/g, "");
                const hasMarkdown =
                    /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/m.test(markdownProbe) ||
                    /^\s{0,3}#{1,6}\s+\S/m.test(markdownProbe) ||
                    /^\s*(?:[-*+] |\d+\. )/m.test(markdownProbe) ||
                    /(?:\*\*[^*\r\n]+\*\*|__[^_\r\n]+__)/.test(markdownProbe) ||
                    /^\s{0,3}>\s+/m.test(markdownProbe);
                const mixed = hasHtmlBlock && hasMarkdown;
                let markdownInput = protectedContent;
                const htmlPlaceholders = [];

                if(mixed){
                    markdownInput = markdownInput
                        .replace(/^[ \t]+(?=<)/, "")
                        .replace(/(\r?\n)[ \t]+(?=<)/g, "$1");
                    findHtmlBlockSpans(markdownInput).slice().reverse().forEach(([start, end]) => {
                        const token = `<!--HTMLBLOCKTOKEN${htmlPlaceholders.length}END-->`;
                        htmlPlaceholders.push(markdownInput.slice(start, end));
                        markdownInput = markdownInput.slice(0, start) + `\n\n${token}\n\n` + markdownInput.slice(end);
                    });
                }

                rendered = hasHtmlBlock && !hasMarkdown
                    ? markdownInput
                    : marked.parse(markdownInput, { gfm:true, breaks:true });
                rendered = rendered.replace(/<!--HTMLBLOCKTOKEN(\d+)END-->/g, (token, index) =>
                    htmlPlaceholders[Number(index)] || token
                );
            }

            rendered = rendered.replace(/MATHSEGMENTTOKEN(\d+)END/g, (token, index) =>
                escapeHTML(mathSegments[Number(index)] || token)
            );
            rendered = rendered.replace(/CURRENCYSEGMENTTOKEN(\d+)END/g, (token, index) => {
                const placeholder = `CURRENCYRESTORETOKEN${currencyPlaceholders.length}END`;
                currencyPlaceholders.push(currencySegments[Number(index)] || token);
                return placeholder;
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
            if(hasMath || currencyPlaceholders.length){
                renderMathInElement(targetElement, {
                    delimiters:[
                        { left:"$$", right:"$$", display:true },
                        { left:"\\[", right:"\\]", display:true },
                        { left:"\\(", right:"\\)", display:false },
                        { left:"$", right:"$", display:false }
                    ],
                    throwOnError:false
                });
            }
            targetElement.innerHTML = targetElement.innerHTML.replace(/CURRENCYRESTORETOKEN(\d+)END/g, (token, index) =>
                escapeHTML(currencyPlaceholders[Number(index)] || token)
            );
        }catch(error){
            console.error("Unable to render rich content", error);
            try{
                targetElement.innerHTML = global.DOMPurify
                    ? global.DOMPurify.sanitize(source, sanitizeOptions)
                    : "";
                if(!global.DOMPurify) targetElement.textContent = source;
            }catch(fallbackError){
                console.error("Unable to sanitize rich content fallback", fallbackError);
                targetElement.textContent = source;
            }
        }
    }

    global.renderRichContent = renderRichContent;
})(window);
