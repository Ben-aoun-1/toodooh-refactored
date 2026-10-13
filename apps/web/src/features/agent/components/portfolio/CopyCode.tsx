import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

/** The agent code, copied on click with a visual confirmation (spec §4 bloc 2). */
export function CopyCode({ code, className = '' }: { code: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      type="button"
      onClick={copy}
      className={`inline-flex items-center gap-2 font-bold tracking-wide ${className}`}
      title="Copier le code"
    >
      {code}
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4 opacity-70" />}
      {copied && <span className="text-xs font-medium">Copié</span>}
    </button>
  );
}
