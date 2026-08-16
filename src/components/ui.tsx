import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";

type Tone = "primary" | "ghost" | "danger" | "quiet";

export function Button({
  tone = "ghost",
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone }) {
  const tones: Record<Tone, string> = {
    primary:
      "bg-accent text-[#1a1206] hover:bg-accent-2 font-semibold border-transparent",
    ghost:
      "bg-raised hover:bg-hover border-line-strong text-ink",
    danger:
      "bg-[#2a1418] hover:bg-[#3a1a20] border-[#5a2430] text-danger",
    quiet:
      "bg-transparent hover:bg-hover border-transparent text-muted hover:text-ink",
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] transition disabled:opacity-40 disabled:pointer-events-none ${tones[tone]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.12em] text-faint">
      {children}
    </label>
  );
}

export function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "ok" | "warn" | "danger" | "pk" | "sk" | "info";
}) {
  const map = {
    default: "bg-hover text-muted border-line",
    ok: "bg-[#143022] text-ok border-[#1f4a34]",
    warn: "bg-[#2a2110] text-accent border-[#4a3818]",
    danger: "bg-[#2a1418] text-danger border-[#5a2430]",
    pk: "bg-[#15233a] text-pk border-[#24385a]",
    sk: "bg-[#241836] text-sk border-[#3a2858]",
    info: "bg-[#132033] text-info border-[#243a58]",
  };
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${map[tone]}`}
    >
      {children}
    </span>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/60 p-8 backdrop-blur-sm">
      <div
        className={`mt-6 w-full rounded-2xl border border-line-strong bg-panel shadow-2xl ${
          wide ? "max-w-4xl" : "max-w-xl"
        }`}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-muted hover:bg-hover hover:text-ink"
          >
            Esc
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
      <div className="text-[15px] font-semibold">{title}</div>
      <div className="max-w-md text-sm text-muted">{body}</div>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-muted">
      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
      {label ? <span>{label}</span> : null}
    </div>
  );
}
