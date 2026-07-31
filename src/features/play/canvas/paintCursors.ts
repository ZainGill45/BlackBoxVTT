const POLYLINE_PEN_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <path d="M26.5 1 31 5.5 13 23.5 4 29l5.5-9Z" fill="#050505" stroke="#050505" stroke-linejoin="round" stroke-width="2"/>
    <path d="m26.25 3.75 2 2-16.5 16.5-4.25 2.5 2.5-4.25Z" fill="#fff" stroke="#fff" stroke-linejoin="round"/>
    <path d="m4 29 8.5-8.5M9.5 20l3 3" fill="none" stroke="#050505" stroke-linecap="round" stroke-width="1.5"/>
    <circle cx="12.5" cy="20.5" r="1.5" fill="#fff" stroke="#050505" stroke-width="1.25"/>
  </svg>
`;

export const POLYLINE_PEN_CURSOR =
  `url("data:image/svg+xml,${encodeURIComponent(POLYLINE_PEN_SVG)}") ` +
  '4 29, crosshair';
