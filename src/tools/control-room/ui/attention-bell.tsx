import { useState } from "react";
import { useNavigate } from "react-router";
import type { AttentionItem, AttentionView } from "../attention";
import { Button } from "./components/button";
import { Popover, PopoverContent, PopoverTrigger } from "./components/popover";
import { Empty } from "./frame";
import { useLoaded } from "./lib/api";
import { cn } from "./lib/cn";
import { post } from "./lib/write";

const DOT: Record<AttentionItem["severity"], string> = {
  alarm: "bg-alarm",
  waiting: "bg-accent",
  note: "bg-neutral-400",
};

function BellIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

function Item({ item, onOpen }: { item: AttentionItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "grid w-full cursor-pointer grid-cols-[8px_1fr_auto] items-start gap-3 border-b border-divider px-4 py-3 text-left last:border-b-0 hover:bg-neutral-200",
        item.read && "opacity-55"
      )}
    >
      <span className={cn("mt-1.5 size-1.5", DOT[item.severity])} />
      <span>
        <span className="block font-medium">{item.title}</span>
        <span className="block text-[12px] text-neutral-700">{item.detail}</span>
      </span>
      <span className="text-[11px] whitespace-nowrap text-neutral-600">
        {item.at.slice(5, 10)}
      </span>
    </button>
  );
}

export function AttentionBell() {
  const [nonce, setNonce] = useState(0);
  const [open, setOpen] = useState(false);
  const view = useLoaded<AttentionView>(`/api/attention?v=${nonce}`);
  const navigate = useNavigate();
  const reload = () => setNonce((n) => n + 1);
  const unread = view.state === "ready" ? view.data.unread : 0;

  const openItem = (item: AttentionItem) => {
    void post("/api/attention/read", { ids: [item.id] }).then(() => {
      setOpen(false);
      reload();
      void navigate(item.href);
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${unread} things need you`}
          className="relative cursor-pointer border border-transparent p-1.5 text-ink hover:border-divider"
        >
          <BellIcon />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 grid min-w-4 place-items-center bg-accent-900 px-1 text-[10px] font-semibold text-bg tabular-nums">
              {unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="max-h-[70vh] overflow-auto">
        <div className="flex items-baseline justify-between border-b border-divider px-4 py-2.5">
          <h2 className="font-heading m-0 text-[16px] font-semibold">
            Needs your attention
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void post("/api/attention/read", { all: true }).then(reload);
            }}
          >
            mark all read
          </Button>
        </div>
        {view.state === "ready" && view.data.items.length === 0 ? (
          <div className="px-4">
            <Empty>Nothing is waiting on you.</Empty>
          </div>
        ) : (
          view.state === "ready" &&
          view.data.items.map((item) => (
            <Item key={item.id} item={item} onOpen={() => openItem(item)} />
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}
