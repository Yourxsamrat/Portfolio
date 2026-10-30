/* =========================================================
   Portfolio interactions
   - mobile menu, scroll progress, scrollspy, reveal-on-scroll
   - project filter, contact form, copy-email, toast
   - live IST clock, back-to-top
   ========================================================= */
(() => {
    "use strict";

    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    document.documentElement.classList.add("js");

    /* ---------- Toast ---------- */
    const toast = $("#toast");
    let toastTimer;
    function showToast(message) {
        if (!toast) return;
        toast.textContent = message;
        toast.classList.add("show");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
    }

    /* ---------- Mobile menu ---------- */
    const menuBtn = $("#menu-toggle");
    const mobileMenu = $("#mobile-menu");

    function setMenu(open) {
        if (!menuBtn || !mobileMenu) return;
        menuBtn.setAttribute("aria-expanded", String(open));
        mobileMenu.classList.toggle("open", open);
        document.body.classList.toggle("menu-open", open);
    }

    if (menuBtn && mobileMenu) {
        menuBtn.addEventListener("click", () =>
            setMenu(menuBtn.getAttribute("aria-expanded") !== "true")
        );
        $$("a", mobileMenu).forEach((a) => a.addEventListener("click", () => setMenu(false)));
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") setMenu(false);
        });
        window.addEventListener("resize", () => {
            if (window.innerWidth > 900) setMenu(false);
        });
    }

    /* ---------- Scroll progress + back-to-top ---------- */
    const progress = $("#scroll-progress");
    const toTop = $("#back-to-top");

    function onScroll() {
        const doc = document.documentElement;
        const max = doc.scrollHeight - window.innerHeight;
        const pct = max > 0 ? (window.scrollY / max) * 100 : 0;
        if (progress) progress.style.width = pct + "%";
        if (toTop) toTop.classList.toggle("show", window.scrollY > 600);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    if (toTop) {
        toTop.addEventListener("click", () =>
            window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" })
        );
    }

    /* ---------- Scrollspy ---------- */
    const navLinks = $$('.nav-links a[href^="#"], #mobile-menu a[href^="#"]');
    const spyTargets = ["about", "work", "skills", "contact"]
        .map((id) => document.getElementById(id))
        .filter(Boolean);

    if ("IntersectionObserver" in window && spyTargets.length) {
        const spy = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) return;
                    navLinks.forEach((link) => {
                        const active = link.getAttribute("href") === "#" + entry.target.id;
                        link.classList.toggle("active", active);
                        if (active) link.setAttribute("aria-current", "true");
                        else link.removeAttribute("aria-current");
                    });
                });
            },
            { rootMargin: "-45% 0px -50% 0px" }
        );
        spyTargets.forEach((t) => spy.observe(t));
    }

    /* ---------- Reveal on scroll ---------- */
    const revealEls = $$(".reveal");
    if (reduceMotion || !("IntersectionObserver" in window)) {
        revealEls.forEach((el) => el.classList.add("in"));
    } else {
        const io = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add("in");
                        io.unobserve(entry.target);
                    }
                });
            },
            { threshold: 0.12, rootMargin: "0px 0px -6% 0px" }
        );
        revealEls.forEach((el) => io.observe(el));
    }

    /* ---------- Project filter ---------- */
    const filterBtns = $$(".filter-btn");
    const cards = $$(".project-card");
    const emptyState = $("#project-empty");

    filterBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
            const filter = btn.dataset.filter;
            filterBtns.forEach((b) => {
                const on = b === btn;
                b.classList.toggle("active", on);
                b.setAttribute("aria-pressed", String(on));
            });

            let visible = 0;
            cards.forEach((card) => {
                const tags = (card.dataset.category || "").split(" ");
                const show = filter === "all" || tags.includes(filter);
                card.hidden = !show;
                if (show) {
                    visible++;
                    card.classList.remove("in");
                    // restart the reveal animation
                    void card.offsetWidth;
                    card.classList.add("in");
                }
            });
            if (emptyState) emptyState.hidden = visible !== 0;
        });
    });

    /* ---------- Copy email ---------- */
    const copyBtn = $("#copy-email");
    if (copyBtn) {
        copyBtn.addEventListener("click", async () => {
            const email = copyBtn.dataset.email;
            try {
                await navigator.clipboard.writeText(email);
                showToast("Email copied to clipboard");
            } catch {
                showToast("Copy failed — " + email);
            }
        });
    }

    /* ---------- Contact form (opens the visitor's mail client) ---------- */
    const form = $("#contact-form");
    if (form) {
        const status = $("#form-status");
        const fields = {
            name: $("#cf-name"),
            email: $("#cf-email"),
            message: $("#cf-message"),
        };
        const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        const setError = (field, msg) => {
            const err = $("#" + field.id + "-error");
            field.setAttribute("aria-invalid", msg ? "true" : "false");
            if (err) err.textContent = msg;
        };

        function validate() {
            let ok = true;
            if (fields.name.value.trim().length < 2) {
                setError(fields.name, "Please enter your name.");
                ok = false;
            } else setError(fields.name, "");

            if (!emailRe.test(fields.email.value.trim())) {
                setError(fields.email, "Please enter a valid email.");
                ok = false;
            } else setError(fields.email, "");

            if (fields.message.value.trim().length < 10) {
                setError(fields.message, "Message should be at least 10 characters.");
                ok = false;
            } else setError(fields.message, "");
            return ok;
        }

        Object.values(fields).forEach((f) =>
            f.addEventListener("input", () => {
                if (f.getAttribute("aria-invalid") === "true") validate();
            })
        );

        form.addEventListener("submit", (e) => {
            e.preventDefault();
            if (!validate()) {
                status.textContent = "Please fix the highlighted fields.";
                return;
            }
            const to = form.dataset.to;
            const subject = encodeURIComponent("Portfolio enquiry from " + fields.name.value.trim());
            const body = encodeURIComponent(
                fields.message.value.trim() +
                    "\n\n— " +
                    fields.name.value.trim() +
                    " (" +
                    fields.email.value.trim() +
                    ")"
            );
            status.textContent = "Opening your email app…";
            window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
            showToast("Opening your email app…");
            form.reset();
        });
    }

    /* ---------- Live local time (IST) ---------- */
    const clock = $("#local-time");
    if (clock) {
        const fmt = new Intl.DateTimeFormat("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
            timeZone: "Asia/Kolkata",
        });
        const tick = () => (clock.textContent = fmt.format(new Date()) + " IST");
        tick();
        setInterval(tick, 30000);
    }

    /* ---------- Footer year ---------- */
    const year = $("#year");
    if (year) year.textContent = new Date().getFullYear();
})();
