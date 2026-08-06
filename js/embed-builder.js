/* ===== ABOUT PAGE — embed-code builder ===== */
(function () {
    const mapOnlyEl = document.getElementById('embed-opt-map-only');
    const themeEl    = document.getElementById('embed-opt-theme');
    const heightEl   = document.getElementById('embed-opt-height');
    const snippetEl  = document.getElementById('embed-snippet');
    const previewEl  = document.getElementById('embed-preview');
    const previewWrap = document.getElementById('embed-preview-wrap');
    const presetBtns = document.querySelectorAll('.embed-preview-preset');
    const copyBtn    = document.getElementById('embed-copy-btn');
    if (!mapOnlyEl || !themeEl || !heightEl || !snippetEl || !previewEl) return;

    function buildQuery() {
        const params = new URLSearchParams();
        if (mapOnlyEl.checked) params.set('embed', '1');
        if (themeEl.value === 'light') params.set('theme', 'light');
        return params.toString();
    }

    // The preview iframe sits in the About page's ~720px-wide content
    // column, well under the map's own 768px mobile breakpoint (see
    // js/viz-engine.js MOBILE_BREAKPOINT) — so a naive width:100% preview
    // always renders the map's mobile layout, regardless of the viewer's
    // actual screen size. Fix: render the iframe at its real target width
    // (a preset, or the viewer's own window width), then visually shrink it
    // with a CSS transform. transform is paint-only — it doesn't change the
    // iframe's layout viewport, so the map inside still measures its real
    // (e.g. desktop) width and picks the correct breakpoint, while fitting
    // the narrow column with no internal scrollbar.
    let previewWidthMode = 'auto'; // 'auto' | 1280 | 768 | 375

    let lastPreviewWidth = null;

    // Sizing the iframe box (below) does NOT reload its document, so a page
    // that's already loaded keeps whatever mobile/desktop decision it made
    // at its *original* width — js/viz-engine.js's collapseCategoriesOnMobile
    // (MOBILE_BREAKPOINT = 768) is computed once at init and never
    // re-evaluated on resize. A CSS-only resize would leave the preview
    // visually rescaled but stuck on the wrong layout decision, which is
    // exactly the kind of stale/misleading preview this whole feature exists
    // to avoid — so an actual width change forces a real reload, letting the
    // map re-decide its layout against the new width from scratch.
    function layoutPreview(forceReload) {
        if (!previewWrap) return;
        const targetWidth  = previewWidthMode === 'auto' ? window.innerWidth : previewWidthMode;
        const targetHeight = Math.max(parseInt(heightEl.value, 10) || 800, 100);
        const wrapWidth     = previewWrap.clientWidth;
        const scale          = Math.min(wrapWidth / targetWidth, 1);

        previewEl.style.width     = targetWidth + 'px';
        previewEl.style.height    = targetHeight + 'px';
        previewEl.style.transform = 'scale(' + scale + ')';
        previewWrap.style.height  = Math.round(targetHeight * scale) + 'px';

        if (forceReload && targetWidth !== lastPreviewWidth && previewEl.contentWindow) {
            try { previewEl.contentWindow.location.reload(); } catch (e) {}
        }
        lastPreviewWidth = targetWidth;
    }

    let resizeTimer = null;
    window.addEventListener('resize', function () {
        if (previewWidthMode !== 'auto') return;
        // Debounced (not just rAF-coalesced) since this can trigger a full
        // iframe reload — only fire once resizing has actually settled.
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () { layoutPreview(true); }, 350);
    });

    presetBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
            const w = btn.getAttribute('data-width');
            previewWidthMode = w === 'auto' ? 'auto' : parseInt(w, 10);
            presetBtns.forEach(function (b) { b.classList.toggle('active', b === btn); });
            layoutPreview(true);
        });
    });

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
        layoutPreview();
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
