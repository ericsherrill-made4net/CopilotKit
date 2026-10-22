import React, { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { twMerge } from "tailwind-merge";
import type { ToolCallEntry } from "./tool-call-layout";
import { pluralize } from "./CopilotChatToolCallGroup";

export interface CopilotChatWorkSummaryProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** The agent is still working on this reply. */
  isWorking: boolean;
  /** Whether the work (narration and tool calls) is showing. */
  isOpen: boolean;
  /** The tool calls the reply made. */
  calls: ToolCallEntry[];
  /** When the agent started on the reply, if this client saw it start. */
  startedAt?: number;
  /** When it finished, if this client saw it finish. */
  finishedAt?: number;
}

function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

/** Re-renders every second while `active`, returning the current time. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * The line at the top of a reply in the `"turn"` tool-call display. While the
 * agent works it reads "Working 4s"; once the reply is done it reads "Worked
 * for 9s · 7 tools" and toggles the work it folded away.
 */
export function CopilotChatWorkSummary({
  isWorking,
  isOpen,
  calls,
  startedAt,
  finishedAt,
  className,
  ...props
}: CopilotChatWorkSummaryProps) {
  const now = useNow(isWorking);
  const failed = calls.filter((call) => call.toolMessage?.error).length;
  const duration =
    startedAt !== undefined && finishedAt !== undefined
      ? formatDuration(finishedAt - startedAt)
      : undefined;

  return (
    <button
      type="button"
      data-copilotkit
      data-testid="copilot-work-summary"
      data-state={isWorking ? "working" : "done"}
      aria-expanded={isOpen}
      className={twMerge(
        "cpk:m-0 cpk:inline-flex cpk:max-w-full cpk:cursor-pointer cpk:items-center cpk:gap-1.5 cpk:rounded-md cpk:border-none cpk:bg-transparent cpk:p-0 cpk:py-0.5 cpk:text-sm cpk:text-muted-foreground cpk:transition-colors cpk:hover:text-foreground cpk:focus-visible:outline-2 cpk:focus-visible:outline-ring",
        className,
      )}
      {...props}
    >
      {isWorking ? (
        <>
          <span className="cpk:font-medium cpk-shimmer">Working</span>
          {startedAt !== undefined && (
            <span className="cpk:text-xs cpk:tabular-nums cpk:opacity-70">
              {Math.max(0, Math.floor((now - startedAt) / 1000))}s
            </span>
          )}
        </>
      ) : (
        <>
          <span className="cpk:font-medium">
            {duration
              ? `Worked for ${duration}`
              : `Used ${pluralize(calls.length, "tool")}`}
          </span>
          {duration && (
            <span className="cpk:text-xs cpk:opacity-70">
              {pluralize(calls.length, "tool")}
            </span>
          )}
          {failed > 0 && (
            <span className="cpk:text-destructive">{failed} failed</span>
          )}
        </>
      )}
      <ChevronRight
        aria-hidden="true"
        className={twMerge(
          "cpk:size-3.5 cpk:shrink-0 cpk:transition-transform cpk:duration-200",
          isOpen && "cpk:rotate-90",
        )}
      />
    </button>
  );
}

export default CopilotChatWorkSummary;
