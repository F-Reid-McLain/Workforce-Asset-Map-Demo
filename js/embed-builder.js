/* ===== ABOUT PAGE — embed-code builder ===== */
(function () {
    const mapOnlyEl = document.getElementById('embed-opt-map-only');
    const themeEl    = document.getElementById('embed-opt-theme');
    const heightEl   = document.getElementById('embed-opt-height');
    const snippetEl  = document.getElementById('embed-snippet');
    const previewEl  = document.getElementById('embed-preview');
    const copyBtn    = document.getElementById('embed-copy-btn');
    if (!mapOnlyEl || !themeEl || !heightEl || !snippetEl || !previewEl) return;

    function buildQuery() {
        const params = new URLSearchParams();
        if (mapOnlyEl.checked) params.set('embed', '1');
        if (themeEl.value === 'light') params.set('theme', 'light');
        return params.toString();
    }

    function update() {
        const query  = buildQuery();
        const height = Math.max(parseInt(heightEl.value, 10) || 800, 100);
        const src    = 'https://maconworkforce.com/' + (query ? '?' + query : '');

        // textContent, not innerHTML — the angle brackets render literally
        // inside <pre><code> with no manual escaping needed.
        snippetEl.textContent =
            '<iframe\n' +
            '    src="' + src + '"\n' +
            '    title="Macon Workforce Navigator"\n' +
            '    style="width: 100%; height: ' + height + 'px; border: 0;"\n' +
            '    loading="lazy">\n' +
            '</iframe>';

        previewEl.src = 'index.html' + (query ? '?' + query : '');
    }

    mapOnlyEl.addEventListener('change', update);
    themeEl.addEventListener('change', update);
    heightEl.addEventListener('input', update);

    if (copyBtn) {
        const defaultLabel = copyBtn.textContent;
        copyBtn.addEventListener('click', function () {
            if (!navigator.clipboard) return;
            navigator.clipboard.writeText(snippetEl.textContent).then(function () {
                copyBtn.textContent = 'Copied!';
                setTimeout(function () { copyBtn.textContent = defaultLabel; }, 1600);
            }).catch(function () {});
        });
    }

    update();
})();
