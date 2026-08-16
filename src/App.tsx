import { useEffect } from "react";
import { ConnectionScreen } from "./components/ConnectionScreen";
import { AppShell } from "./components/AppShell";
import { AppProvider, useApp } from "./store";

function Toasts() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-96 flex-col gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          className={`pointer-events-auto rounded-xl border px-3 py-2 text-left text-sm shadow-lg ${
            t.kind === "err"
              ? "border-[#5a2430] bg-[#2a1418] text-danger"
              : t.kind === "ok"
                ? "border-[#1f4a34] bg-[#143022] text-ok"
                : "border-line bg-raised text-ink"
          }`}
          onClick={() => dismissToast(t.id)}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}

function Shell() {
  const { active, refreshConnections } = useApp();
  useEffect(() => {
    refreshConnections();
  }, [refreshConnections]);
  return (
    <>
      {active ? <AppShell /> : <ConnectionScreen />}
      <Toasts />
    </>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
