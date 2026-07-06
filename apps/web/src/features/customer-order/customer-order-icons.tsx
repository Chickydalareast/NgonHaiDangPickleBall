import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function IconBase({ children, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </IconBase>
  );
}

export function ReceiptIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </IconBase>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 18h14" />
      <path d="M7 18a5 5 0 0 1 10 0" />
      <path d="M12 9V6" />
      <path d="M9 6h6" />
      <path d="M4 21h16" />
    </IconBase>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m7 10 5 5 5-5" />
    </IconBase>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m9 6 6 6-6 6" />
    </IconBase>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m7 7 10 10M17 7 7 17" />
    </IconBase>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 5v14M5 12h14" />
    </IconBase>
  );
}

export function MinusIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 12h14" />
    </IconBase>
  );
}

export function GridIcon(props: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" {...props}>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </svg>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 11h14" />
      <path d="M7 11a5 5 0 0 1 10 0" />
      <path d="M12 6V4" />
      <path d="M4 15h16" />
      <path d="M6 15v4h12v-4" />
    </IconBase>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m6 12 4 4 8-8" />
    </IconBase>
  );
}

export function CategoryIcon({ variant }: { variant: number }) {
  const resolved = Math.abs(variant) % 4;

  if (resolved === 0) {
    return (
      <svg aria-hidden="true" viewBox="0 0 64 64">
        <rect x="8" y="8" width="20" height="20" rx="6" fill="#42A5F5" />
        <rect x="36" y="8" width="20" height="20" rx="6" fill="#7E57C2" />
        <rect x="8" y="36" width="20" height="20" rx="6" fill="#26A69A" />
        <rect x="36" y="36" width="20" height="20" rx="6" fill="#FFB74D" />
      </svg>
    );
  }

  if (resolved === 1) {
    return (
      <svg aria-hidden="true" viewBox="0 0 64 64">
        <path d="M22 10h20l-3 43H25l-3-43Z" fill="#62C6BD" />
        <path d="M26 20h12l-1 26H27l-1-26Z" fill="#D7F3EF" />
        <path
          d="M35 10c0-7 4-9 10-11"
          fill="none"
          stroke="#148F84"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <circle cx="31" cy="30" r="4" fill="#F4A261" />
      </svg>
    );
  }

  if (resolved === 2) {
    return (
      <svg aria-hidden="true" viewBox="0 0 64 64">
        <path d="M14 18h36l-5 36H19l-5-36Z" fill="#FF8A80" />
        <path d="M19 12h26l5 8H14l5-8Z" fill="#FFB3AE" />
        <circle cx="27" cy="32" r="4" fill="#FFD166" />
        <circle cx="39" cy="38" r="4" fill="#FFD166" />
        <circle cx="30" cy="45" r="3" fill="#FFD166" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 64 64">
      <ellipse cx="32" cy="42" rx="23" ry="10" fill="#F2C94C" />
      <path d="M16 39c2-13 9-20 16-20s14 7 16 20H16Z" fill="#F5A623" />
      <path
        d="M24 28c4-5 12-5 16 0"
        fill="none"
        stroke="#49A078"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <circle cx="32" cy="15" r="4" fill="#49A078" />
    </svg>
  );
}
