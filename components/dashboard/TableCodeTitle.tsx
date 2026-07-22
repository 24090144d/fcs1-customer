'use client';

type Props = {
  code: string;
  title: string;
  titleColor: string;
  codeColor: string;
  background: string;
};

export function TableCodeTitle({ code, title, titleColor, codeColor, background }: Props) {
  return (
    <h4 className="flex items-center gap-2 font-serif font-semibold leading-snug" style={{ color: titleColor }}>
      <span
        className="shrink-0 font-mono"
        style={{
          fontSize: '0.62rem',
          letterSpacing: '0.04em',
          fontWeight: 700,
          color: codeColor,
          background,
          border: `1px solid ${codeColor}40`,
          padding: '1px 5px',
          lineHeight: 1.4,
        }}
      >
        {code}
      </span>
      {title}
    </h4>
  );
}
