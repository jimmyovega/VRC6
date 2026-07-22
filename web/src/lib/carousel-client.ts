// Client-side behaviour for carousels rendered by lib/body.ts: one-at-a-time
// paging (prev/next/dots) plus a shared, full-screen gallery lightbox opened by
// clicking any slide. Imported by the public article page and the editor's
// read-only preview. No dependencies; safe to call more than once (each carousel
// is marked initialised).

interface LightboxState {
  srcs: string[];
  alts: string[];
  index: number;
}

let lightbox: HTMLElement | null = null;
let lbImg: HTMLImageElement | null = null;
let lbCounter: HTMLElement | null = null;
let lbState: LightboxState | null = null;
let lastFocus: HTMLElement | null = null;

function ensureLightbox(): HTMLElement {
  if (lightbox) return lightbox;
  const el = document.createElement("div");
  el.className = "carousel-lightbox";
  el.hidden = true;
  el.innerHTML =
    '<button type="button" class="cl-close" aria-label="Close">✕</button>' +
    '<button type="button" class="cl-prev" aria-label="Previous image">‹</button>' +
    '<img class="cl-img" alt="" />' +
    '<button type="button" class="cl-next" aria-label="Next image">›</button>' +
    '<div class="cl-counter" aria-hidden="true"></div>';
  document.body.appendChild(el);

  lbImg = el.querySelector(".cl-img");
  lbCounter = el.querySelector(".cl-counter");
  el.querySelector(".cl-close")!.addEventListener("click", closeLightbox);
  el.querySelector(".cl-prev")!.addEventListener("click", (e) => {
    e.stopPropagation();
    stepLightbox(-1);
  });
  el.querySelector(".cl-next")!.addEventListener("click", (e) => {
    e.stopPropagation();
    stepLightbox(1);
  });
  // Click on the backdrop (not the image or a control) closes.
  el.addEventListener("click", (e) => {
    if (e.target === el) closeLightbox();
  });
  lightbox = el;
  return el;
}

function renderLightbox() {
  if (!lbState || !lbImg) return;
  lbImg.src = lbState.srcs[lbState.index];
  lbImg.alt = lbState.alts[lbState.index] ?? "";
  const multi = lbState.srcs.length > 1;
  if (lbCounter) lbCounter.textContent = multi ? `${lbState.index + 1} / ${lbState.srcs.length}` : "";
  const prev = lightbox?.querySelector<HTMLElement>(".cl-prev");
  const next = lightbox?.querySelector<HTMLElement>(".cl-next");
  if (prev) prev.hidden = !multi;
  if (next) next.hidden = !multi;
}

function stepLightbox(delta: number) {
  if (!lbState) return;
  const n = lbState.srcs.length;
  lbState.index = (lbState.index + delta + n) % n;
  renderLightbox();
}

function onKey(e: KeyboardEvent) {
  if (!lightbox || lightbox.hidden) return;
  if (e.key === "Escape") closeLightbox();
  else if (e.key === "ArrowLeft") stepLightbox(-1);
  else if (e.key === "ArrowRight") stepLightbox(1);
}

function openLightbox(state: LightboxState, opener: HTMLElement) {
  const el = ensureLightbox();
  lbState = state;
  lastFocus = opener;
  renderLightbox();
  el.hidden = false;
  document.addEventListener("keydown", onKey);
  el.querySelector<HTMLElement>(".cl-close")?.focus();
}

function closeLightbox() {
  if (!lightbox) return;
  lightbox.hidden = true;
  lbState = null;
  document.removeEventListener("keydown", onKey);
  lastFocus?.focus();
  lastFocus = null;
}

function setupCarousel(root: HTMLElement) {
  if (root.dataset.carouselReady) return;
  root.dataset.carouselReady = "1";

  const track = root.querySelector<HTMLElement>(".carousel-track");
  const slides = Array.from(root.querySelectorAll<HTMLElement>(".carousel-slide"));
  const dots = Array.from(root.querySelectorAll<HTMLElement>(".carousel-dot"));
  if (!track || slides.length === 0) return;

  let index = 0;
  const go = (n: number) => {
    index = (n + slides.length) % slides.length;
    track.style.transform = `translateX(-${index * 100}%)`;
    dots.forEach((d, i) => d.classList.toggle("is-active", i === index));
    slides.forEach((s, i) => s.setAttribute("aria-hidden", i === index ? "false" : "true"));
  };

  root.querySelector(".carousel-arrow.prev")?.addEventListener("click", () => go(index - 1));
  root.querySelector(".carousel-arrow.next")?.addEventListener("click", () => go(index + 1));
  dots.forEach((d, i) => d.addEventListener("click", () => go(i)));

  // Clicking a slide opens the gallery lightbox for this carousel's images.
  const srcs = slides.map((s) => s.querySelector("img")?.src ?? "");
  const alts = slides.map((s) => s.querySelector("img")?.alt ?? "");
  slides.forEach((s, i) => {
    s.addEventListener("click", () => openLightbox({ srcs, alts, index: i }, s));
  });

  go(0);
}

/** Initialise every carousel under `root` (default: the whole document). */
export function initCarousels(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>(".carousel[data-carousel]").forEach(setupCarousel);
}
