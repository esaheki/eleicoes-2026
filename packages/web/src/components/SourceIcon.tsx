import { FaYoutube, FaXTwitter, FaNewspaper } from 'react-icons/fa6';

interface SourceIconProps {
  source: string;
  className?: string;
}

const CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  youtube:  { icon: FaYoutube,   color: '#FF0000', label: 'YouTube' },
  twitter:  { icon: FaXTwitter,  color: '#000000', label: 'X' },
  news:     { icon: FaNewspaper, color: '#6B7280', label: 'Notícias' },
};

export function SourceIcon({ source, className = '' }: SourceIconProps) {
  const cfg = CONFIG[source.toLowerCase()];
  if (!cfg) return <span className={`text-xs text-gray-400 ${className}`}>{source}</span>;

  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${className}`} style={{ color: cfg.color }}>
      <Icon size={13} />
      {cfg.label}
    </span>
  );
}
