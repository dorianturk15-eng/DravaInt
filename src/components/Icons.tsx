import type { SVGProps } from 'react';

function base(props: SVGProps<SVGSVGElement>) {
  return {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'currentColor',
    ...props,
  };
}

// Row 1, Icon 5: Vortex blades
export function IconRefresh(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M19 12a7 7 0 0 1-7 7 7 7 0 0 1-7-7 7 7 0 0 1 5.5-6.8V3.1A9 9 0 0 0 3 12a9 9 0 0 0 9 9 9 9 0 0 0 9-9h-2zM12 2l4 4h-8l4-4z" />
    </svg>
  );
}

// Row 5, Icon 7: Flat bar scanner stripes
export function IconPrint(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4" width="18" height="3" rx="1.5" />
      <rect x="3" y="10" width="18" height="3" rx="1.5" />
      <rect x="3" y="16" width="14" height="3" rx="1.5" />
    </svg>
  );
}

// Row 1, Icon 1: Circle with four curved arcs forming a diamond star
export function IconSun(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 15c0-2.76-2.24-5-5-5 2.76 0 5-2.24 5-5 0 2.76 2.24 5 5 5-2.76 0-5 2.24-5 5z" />
    </svg>
  );
}

// Row 4, Icon 3: Smooth S-curve divide
export function IconMoon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M12 2A10 10 0 0 0 2 12a10 10 0 0 0 10 10c0-5.5-4.5-10-10-10 5.5 0 10-4.5 10-10z" />
    </svg>
  );
}

// Row 1, Icon 8: Eight-pointed flower/asterisk
export function IconPlus(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M11 3h2v18h-2zM3 11h18v2H3zM5.5 4.1l1.4 1.4 13 13-1.4 1.4-13-13zM18.5 4.1l1.4 1.4-13 13-1.4-1.4 13-13z" />
    </svg>
  );
}

// Row 3, Icon 8: Hourglass
export function IconTrash(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M4 3h16v2l-6 7 6 7v2H4v-2l6-7-6-7V3z" />
    </svg>
  );
}

// Row 1, Icon 2: Half moon capsule shape
export function IconEdit(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M4 12a8 8 0 0 1 8-8h2v16h-2a8 8 0 0 1-8-8z" />
    </svg>
  );
}

// Row 5, Icon 6: Exit arrow
export function IconLogout(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M10 4H3v16h7v-3H6V7h4V4zm8 4l-1.4 1.4 2.6 2.6H9v2h10.2l-2.6 2.6L18 16l5-5-5-5z" />
    </svg>
  );
}

// Row 1, Icon 6: Upload lines
export function IconUpload(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M11 20h2V8h3l-4-5-4 5h3v12zM2 18h20v2H2z" />
    </svg>
  );
}

// Row 3, Icon 4: Concentric overlapping loops/ovals
export function IconCalendar(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <ellipse cx="12" cy="7" rx="8" ry="4" />
      <ellipse cx="12" cy="12" rx="8" ry="4" />
      <ellipse cx="12" cy="17" rx="8" ry="4" />
    </svg>
  );
}

// Row 4, Icon 4: Isometric 3D Star/Cube structure
export function IconGear(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M12 2l7 4v12l-7 4-7-4V6l7-4zm0 2.3L6.5 7.5v9l5.5 3.2 5.5-3.2v-9L12 4.3z" />
      <circle cx="12" cy="12" r="3.5" />
    </svg>
  );
}

// Row 4, Icon 5: Concentric target rings
export function IconChart(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 16a6 6 0 1 1 6-6 6 6 0 0 1-6 6z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

// Row 2, Icon 3: Minimalist concentric arches/rainbow
export function IconGantt(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M12 4C6.48 4 2 8.48 2 14h2a8 8 0 0 1 16 0h2c0-5.52-4.48-10-10-10zm0 4a6 6 0 0 0-6 6h2a4 4 0 0 1 8 0h2a6 6 0 0 0-6-6zm0 4a2 2 0 0 0-2 2h4a2 2 0 0 0-2-2z" />
    </svg>
  );
}

// Row 5, Icon 5: Triquetra / interlocking loops
export function IconFlow(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M12 4a6 6 0 1 0 4.24 10.24A6 6 0 0 0 12 4zm0 2.5A3.5 3.5 0 0 1 14.5 10a3.5 3.5 0 0 1-5 0 3.5 3.5 0 0 1 2.5-3.5z" />
      <circle cx="12" cy="11" r="2" />
    </svg>
  );
}

// Row 5, Icon 2: Four circles forming a grid
export function IconDashboard(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <circle cx="6" cy="6" r="4.5" />
      <circle cx="18" cy="6" r="4.5" />
      <circle cx="6" cy="18" r="4.5" />
      <circle cx="18" cy="18" r="4.5" />
    </svg>
  );
}

// Row 3, Icon 1: Grid of checker squares
export function IconList(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

// Row 5, Icon 8: Four circles intersecting diamond gaps
export function IconBoard(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M12 2A10 10 0 1 0 22 12 10 10 0 0 0 12 2zm1 2v7h7v2h-7v7h-2v-7H4v-2h7V4z" />
    </svg>
  );
}

// Row 2, Icon 6: Four corners pointing inwards / cross
export function IconShield(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M3 3h7v3H6v4H3V3zm18 0v7h-3V6h-4V3h7zM3 21v-7h3v4h4v3H3zm18 0h-7v-3h4v-4h3v7zM11 8h2v8h-2zm-3 3h8v2H8z" />
    </svg>
  );
}

// Solid triangle warning glyph
export function IconAlert(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M12 2 1 21h22L12 2zm1 14h-2v-2h2v2zm0-4h-2V8h2v4z" />
    </svg>
  );
}
