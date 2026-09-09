'use client';

import { useEffect, useRef, type ReactNode } from 'react';

type Page = { id: string; label: string; kind: 'destination' | 'transport'; content: ReactNode };

export function ItineraryBook({ pages, selectedId, onSelect }: {
  pages: Page[]; selectedId: string; onSelect: (id: string) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollSelection = useRef<string | null>(null);
  const initialized = useRef(false);
  const pageOrder = pages.map((page) => page.id).join('|');

  useEffect(() => {
    const book = viewport.current;
    if (!book) return;
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    const center = (animate: boolean) => {
      const page = Array.from(book.children).find((child) => (child as HTMLElement).dataset.pageId === selectedId) as HTMLElement | undefined;
      if (!page) return;
      const left = book.scrollLeft + page.getBoundingClientRect().left - book.getBoundingClientRect().left - (book.clientWidth - page.offsetWidth) / 2;
      book.scrollTo({ left, behavior: animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant' });
    };
    if (scrollSelection.current !== selectedId) center(initialized.current);
    scrollSelection.current = null;
    initialized.current = true;
    // Recenter after a viewport resize, without replaying the page animation.
    let width = book.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width === book.clientWidth) return;
      width = book.clientWidth;
      center(false);
    });
    observer.observe(book);
    return () => observer.disconnect();
  }, [selectedId, pageOrder]);

  useEffect(() => () => { if (scrollTimer.current) clearTimeout(scrollTimer.current); }, []);

  function syncSelection() {
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      const book = viewport.current;
      if (!book) return;
      const middle = book.getBoundingClientRect().left + book.clientWidth / 2;
      let closest: HTMLElement | null = null;
      let distance = Infinity;
      for (const child of Array.from(book.children)) {
        const page = child as HTMLElement;
        const rect = page.getBoundingClientRect();
        const delta = Math.abs(rect.left + rect.width / 2 - middle);
        if (delta < distance) { closest = page; distance = delta; }
      }
      if (closest?.dataset.pageId && closest.dataset.pageId !== selectedId) {
        scrollSelection.current = closest.dataset.pageId;
        onSelect(closest.dataset.pageId);
      }
    }, 180);
  }

  const index = pages.findIndex((page) => page.id === selectedId);
  return <div className="itinerary-book">
    <div className="book-controls">
      <button type="button" className="button-text" disabled={index <= 0} onClick={() => onSelect(pages[index - 1]!.id)}>← Previous</button>
      <span role="status">{pages[index]?.label} <small>{index + 1} / {pages.length}</small></span>
      <button type="button" className="button-text" disabled={index >= pages.length - 1} onClick={() => onSelect(pages[index + 1]!.id)}>Next →</button>
    </div>
    <div ref={viewport} className="book-viewport" onScroll={syncSelection} tabIndex={0} role="region" aria-label="Itinerary pages"
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? pages.length - 1 : Math.max(0, Math.min(pages.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)));
        if (pages[next]) onSelect(pages[next].id);
      }}>
      {pages.map((page) => <section key={page.id} id={`book-${page.id}`} data-page-id={page.id} className={`book-page book-page-${page.kind} ${page.id === selectedId ? 'book-page-selected' : ''}`} aria-label={page.label}
        onFocusCapture={() => { if (page.id !== selectedId) onSelect(page.id); }}>
        {page.content}
      </section>)}
    </div>
  </div>;
}
