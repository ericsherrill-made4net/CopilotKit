import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { z } from "zod";
import type { AssistantMessage, Message, ToolMessage } from "@ag-ui/core";
import { CopilotChatMessageView } from "../CopilotChatMessageView";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { WildcardToolCallRender } from "../../WildcardToolCallRender";
import { defineToolCallRenderer } from "../../../types";
import { getToolCallLayouts, getTurnWork } from "../tool-call-layout";

const question: Message = { id: "u1", role: "user", content: "Why?" };

const callMessage = (id: string, name = "run_command"): AssistantMessage => ({
  id: `m-${id}`,
  role: "assistant",
  content: "",
  toolCalls: [
    {
      id,
      type: "function",
      function: { name, arguments: JSON.stringify({ command: `cmd ${id}` }) },
    },
  ],
});

const result = (id: string, error?: string): ToolMessage => ({
  id: `r-${id}`,
  role: "tool",
  toolCallId: id,
  content: "ok",
  ...(error ? { error } : {}),
});

const say = (id: string, content: string): Message => ({
  id,
  role: "assistant",
  content,
});

const weather = defineToolCallRenderer({
  name: "weather",
  args: z.object({}),
  render: () => <div data-testid="weather-card">Weather</div>,
});

const renderView = (
  messages: Message[],
  props: Partial<React.ComponentProps<typeof CopilotChatMessageView>> = {},
) =>
  render(
    <CopilotKitProvider renderToolCalls={[weather, WildcardToolCallRender]}>
      <CopilotChatConfigurationProvider threadId="tool-call-display">
        <CopilotChatMessageView messages={messages} {...props} />
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>,
  );

const names = { named: new Set(["weather"]), wildcard: true };

describe("getToolCallLayouts", () => {
  it("groups calls made in a row across messages, owned by the first", () => {
    const messages = [
      question,
      callMessage("a"),
      result("a"),
      callMessage("b"),
      result("b"),
    ];
    const layouts = getToolCallLayouts(messages, messages, names);

    const first = layouts.get("m-a")!.segments;
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ kind: "group", trailing: true });
    expect(
      first[0]!.kind === "group" && first[0]!.calls.map((c) => c.toolCall.id),
    ).toEqual(["a", "b"]);
    expect(layouts.get("m-b")!.segments).toEqual([]);
  });

  it("starts a new group after text or a call with its own renderer", () => {
    const messages = [
      question,
      callMessage("a"),
      say("t", "Checking more."),
      callMessage("b"),
      callMessage("w", "weather"),
      callMessage("c"),
    ];
    const layouts = getToolCallLayouts(messages, messages, names);
    const kinds = ["m-a", "m-b", "m-w", "m-c"].map((id) =>
      layouts.get(id)!.segments.map((segment) => segment.kind),
    );
    expect(kinds).toEqual([["group"], ["group"], ["call"], ["group"]]);
  });

  it("changes its signature when a result arrives for a call it holds", () => {
    const before = [question, callMessage("a"), callMessage("b")];
    const after = [...before, result("b")];
    const signature = (messages: Message[]) =>
      getToolCallLayouts(messages, messages, names).get("m-a")!.signature;
    expect(signature(after)).not.toBe(signature(before));
  });
});

describe("getTurnWork", () => {
  it("treats everything up to the last call as work, and the rest as the reply", () => {
    const messages = [
      question,
      say("t1", "Looking."),
      callMessage("a"),
      result("a"),
      say("t2", "The answer."),
    ];
    const layouts = getToolCallLayouts(messages, messages, names);
    const turn = getTurnWork(messages, layouts).get("u1")!;
    expect([...turn.workMessageIds]).toEqual(["t1", "m-a"]);
    expect(turn.firstMessageId).toBe("t1");
    expect(turn.calls).toHaveLength(1);
  });
});

describe("CopilotChatMessageView toolCallDisplay", () => {
  const burst = [
    question,
    callMessage("a"),
    result("a"),
    callMessage("b"),
    result("b", "boom"),
    say("t", "Done."),
  ];

  it("groups calls into one collapsed card by default", () => {
    renderView(burst);
    const group = screen.getByTestId("copilot-tool-call-group");
    expect(group.getAttribute("data-appearance")).toBe("card");
    // The header comes first; the rows (closed, so inert) follow it.
    const toggle = within(group).getAllByRole("button")[0]!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain("Used 2 tools");
    expect(toggle.textContent).toContain("1 failed");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(within(group).getAllByTestId("copilot-tool-render")).toHaveLength(2);
  });

  it("names the running call while the group is still going", () => {
    renderView([question, callMessage("a"), result("a"), callMessage("b")], {
      isRunning: true,
    });
    const group = screen.getByTestId("copilot-tool-call-group");
    expect(group.getAttribute("data-state")).toBe("running");
    expect(group.textContent).toContain("Running run_command");
    expect(group.textContent).toContain("1 done");
  });

  it.each([
    ["line", "line"],
    ["stacked", "stack"],
  ] as const)("draws %s groups", (display, appearance) => {
    renderView(burst, { toolCallDisplay: display });
    expect(
      screen
        .getByTestId("copilot-tool-call-group")
        .getAttribute("data-appearance"),
    ).toBe(appearance);
  });

  it("gives every call its own card with separate", () => {
    renderView(burst, { toolCallDisplay: "separate" });
    expect(screen.queryByTestId("copilot-tool-call-group")).toBeNull();
    expect(screen.getAllByTestId("copilot-tool-render")).toHaveLength(2);
  });

  it("keeps calls with their own renderer visible and outside the group", () => {
    renderView([
      question,
      callMessage("a"),
      callMessage("w", "weather"),
      callMessage("b"),
    ]);
    expect(screen.getByTestId("weather-card")).toBeDefined();
    expect(screen.getAllByTestId("copilot-tool-call-group")).toHaveLength(2);
  });

  it("folds a finished reply's work into the summary with turn", () => {
    renderView([question, say("t1", "Looking."), ...burst.slice(1)], {
      toolCallDisplay: "turn",
    });
    const summary = screen.getByTestId("copilot-work-summary");
    expect(summary.getAttribute("aria-expanded")).toBe("false");
    // No timing for a reply this client didn't watch: it counts the tools.
    expect(summary.textContent).toContain("Used 2 tools");
    expect(
      document.querySelector('[data-work-text="narration"]'),
    ).not.toBeNull();
    expect(document.querySelector('[data-work-text="reply"]')).not.toBeNull();

    fireEvent.click(summary);
    expect(summary.getAttribute("aria-expanded")).toBe("true");
  });

  it("shows Working while the latest reply runs with turn", () => {
    renderView([question], { toolCallDisplay: "turn", isRunning: true });
    const summary = screen.getByTestId("copilot-work-summary");
    expect(summary.getAttribute("data-state")).toBe("working");
    expect(screen.queryByTestId("copilot-loading-cursor")).toBeNull();
  });

  it("makes a closed group's rows inert", () => {
    renderView(burst);
    const group = screen.getByTestId("copilot-tool-call-group");
    const body = group.querySelector("[id]")!;
    expect(body.hasAttribute("inert")).toBe(true);
    fireEvent.click(within(group).getAllByRole("button")[0]!);
    expect(body.hasAttribute("inert")).toBe(false);
  });

  it("keeps a reasoning message mounted when a later call makes it work", () => {
    const reasoning: Message = {
      id: "r1",
      role: "reasoning",
      content: "Thinking about it.",
    };
    const { rerender } = renderView([question, reasoning], {
      toolCallDisplay: "turn",
      isRunning: true,
    });
    const node = screen.getByText("Thinking about it.");

    rerender(
      <CopilotKitProvider renderToolCalls={[weather, WildcardToolCallRender]}>
        <CopilotChatConfigurationProvider threadId="tool-call-display">
          <CopilotChatMessageView
            messages={[question, reasoning, callMessage("a")]}
            toolCallDisplay="turn"
            isRunning
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>,
    );
    expect(screen.getByText("Thinking about it.")).toBe(node);
  });
});
