// Simple line icons (24×24, drawn in the current text colour). Static strings, safe to insert as SVG.
const svg = body => `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICON = {
  crane: svg('<path d="M7 21V5"/><path d="M4 5h17"/><path d="M7 5l3-3 3 3"/><path d="M7 9l3-4M7 13l3-4"/><path d="M17 5v5"/><path d="M15.5 10h3l-1.5 3z"/><path d="M4 21h7"/>'),
  delivery: svg('<path d="M2 6h11v10H2z"/><path d="M13 9h4l4 4v3h-8"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>'),
  hoist: svg('<rect x="6" y="3" width="12" height="18" rx="1.5"/><path d="M12 7l-2.5 3h5z"/><path d="M12 17l-2.5-3h5z"/>'),
  pump: svg('<path d="M2 18V13h9l2-3h3v8"/><circle cx="6" cy="19" r="1.6"/><circle cx="14" cy="19" r="1.6"/><path d="M13 10l5-6 4 3"/><path d="M22 7v4"/>'),
  mobile: svg('<path d="M2 18v-4h12v4"/><path d="M14 16h4l2 2"/><circle cx="5" cy="19" r="1.6"/><circle cx="12" cy="19" r="1.6"/><path d="M6 14L19 4"/><path d="M19 4v6"/><path d="M17.5 10h3"/>'),
  calendar: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  pour: svg('<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  plan: svg('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h7"/>'),
  team: svg('<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.5c3 .2 5.5 2.6 5.5 5.5"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>')
};

export function icon(name, cls = 'ic'){
  const s = document.createElement('span');
  s.className = cls;
  s.innerHTML = ICON[name] || '';
  return s;
}
