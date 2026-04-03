import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle: string;
  rune: string;
  realmColor: string;
  action?: ReactNode;
}

export function PageHeader({
  title,
  subtitle,
  rune,
  realmColor,
  action,
}: PageHeaderProps) {
  return (
    <div className="animate-fade-up">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <span
              className="text-lg font-cinzel select-none"
              style={{ color: realmColor }}
            >
              {rune}
            </span>
            <h1 className="heading-norse text-xl">{title}</h1>
          </div>
          <div
            className="realm-line mt-1.5 mb-1"
            style={{ background: realmColor }}
          />
          <p className="text-text-muted text-xs tracking-wide font-space-grotesk italic">
            {subtitle}
          </p>
        </div>
        {action}
      </div>
    </div>
  );
}
