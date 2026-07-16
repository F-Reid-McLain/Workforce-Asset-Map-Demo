// ===== STICKY HEADER (hide on scroll down, show on scroll up) =====
(function () {
    const header = document.querySelector('.main-header');
    if (!header) return;

    // Offset body so content doesn't hide under fixed header
    function applyOffset() {
        document.body.style.paddingTop = header.offsetHeight + 'px';
    }
    applyOffset();
    window.addEventListener('resize', applyOffset);

    let lastY = window.scrollY;
    const THRESHOLD = 6;

    // Pages with the mobile jump-nav (currently just Workforce Data) dock it
    // sticky right under the header at a fixed top offset — if the header
    // were also free to hide-on-scroll here, sliding it away would leave the
    // nav floating with an empty gap above it instead of sitting flush under
    // the header like it's meant to. Keep the header pinned visible instead,
    // only on this page and only at the width where the jump-nav is actually
    // in its horizontal-bar mode.
    const hasJumpNav = !!document.querySelector('.page-jumpnav');

    window.addEventListener('scroll', function () {
        const currentY = window.scrollY;
        const suppressHide = hasJumpNav && window.innerWidth <= 768;
        // Mobile rubber-band overscroll at the top fires scroll events with
        // a real delta even though the user hasn't actually scrolled down —
        // that was tripping the hide logic and hiding the nav (hamburger
        // included) right at the top of the page until the next upward
        // scroll cleared it. Never hide while at/near the top.
        if (currentY <= 0) {
            header.classList.remove('header-hidden');
        } else if (!suppressHide && currentY > lastY + THRESHOLD) {
            header.classList.add('header-hidden');
        } else if (currentY < lastY - THRESHOLD) {
            header.classList.remove('header-hidden');
        }
        header.classList.toggle('scrolled', currentY > 10);
        lastY = currentY;
    }, { passive: true });
})();

// ===== MOBILE NAV TOGGLE =====
document.addEventListener('DOMContentLoaded', function () {
    const toggle = document.getElementById('nav-toggle');
    const nav    = document.getElementById('main-nav');
    if (!toggle || !nav) return;

    function openNav() {
        nav.classList.add('open');
        toggle.classList.add('open');
        toggle.setAttribute('aria-expanded', 'true');
    }

    function closeNav() {
        nav.classList.remove('open');
        toggle.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
    }

    toggle.addEventListener('click', function (e) {
        e.stopPropagation();
        nav.classList.contains('open') ? closeNav() : openNav();
    });

    // Close when a nav link is clicked (navigation or same-page)
    nav.querySelectorAll('.nav-link').forEach(function (link) {
        link.addEventListener('click', closeNav);
    });

    // Close when clicking outside the header
    document.addEventListener('click', function (e) {
        if (!nav.contains(e.target) && !toggle.contains(e.target)) {
            closeNav();
        }
    });

    // Close on ESC
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeNav();
    });
});
