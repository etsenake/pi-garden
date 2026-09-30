import { expect, test } from "@playwright/test";
import type { TimelineToolCall } from "../../contracts/timeline-types";
import { desktopToolPresentation } from "../../src/features/conversation/tool-presentation";

function tool(overrides: Partial<TimelineToolCall> = {}): TimelineToolCall {
  return {
    kind: "tool",
    id: "call-1",
    callId: "call-1",
    toolName: "garden_probe",
    status: "running",
    label: "Ran garden_probe",
    createdAt: "2026-09-30T00:00:00.000Z",
    ...overrides,
  };
}

test("tool presentation follows Pi's call, stream, result, and error states", () => {
  expect(
    desktopToolPresentation(
      tool({
        executionStarted: false,
        argumentsComplete: false,
        input: { city: "pa" },
      }),
      false,
    ),
  ).toMatchObject({
    phase: "pending",
    arguments: { city: "pa" },
    argumentsComplete: false,
    executionStarted: false,
    expanded: false,
  });

  expect(
    desktopToolPresentation(
      tool({ executionStarted: true, argumentsComplete: true, input: { city: "paris" } }),
      false,
    ).phase,
  ).toBe("running");

  expect(
    desktopToolPresentation(
      tool({
        executionStarted: true,
        argumentsComplete: true,
        partial: { details: { step: 1 } },
      }),
      true,
    ),
  ).toMatchObject({
    phase: "partial",
    partial: { details: { step: 1 } },
    expanded: true,
  });

  expect(
    desktopToolPresentation(
      tool({
        status: "success",
        output: {
          content: [{ type: "text", text: "rain" }],
          details: { weather: "rain" },
          isError: false,
        },
      }),
      true,
    ),
  ).toMatchObject({
    phase: "complete",
    result: { details: { weather: "rain" }, isError: false },
  });

  expect(
    desktopToolPresentation(
      tool({ status: "error", detail: "boom", output: { isError: true, content: [] } }),
      false,
    ),
  ).toMatchObject({ phase: "error", error: "boom", result: { isError: true } });
});
