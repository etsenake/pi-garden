import { expect, test } from "@playwright/test";
import {
  activeAutocompleteTrigger,
  extensionAutocompleteSuppressed,
} from "../../src/features/conversation/hooks/use-editor-autocomplete";
import { bindTextareaEditor } from "../../src/features/conversation/composer-editor";

test("slash and mention contexts suppress extension autocomplete", () => {
  expect(extensionAutocompleteSuppressed("/model", 6, false)).toBe(true);
  expect(extensionAutocompleteSuppressed("hello @jo", 9, false)).toBe(true);
  expect(extensionAutocompleteSuppressed("hello", 5, true)).toBe(true);
  expect(extensionAutocompleteSuppressed("hello :jo", 9, false)).toBe(false);
});

test("trigger characters match the token start", () => {
  expect(activeAutocompleteTrigger("say :na", 7, [":", "@"])).toBe(":");
  expect(activeAutocompleteTrigger("say hello", 9, [":"])).toBeNull();
  expect(activeAutocompleteTrigger("line\n@ab", 8, ["@"])).toBe("@");
});

test("the default textarea implements selection on the editor handle", () => {
  const textarea = {
    selectionStart: 0,
    selectionEnd: 0,
    dataset: {},
    focus() {},
    setSelectionRange(start: number, end: number) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
    style: { height: "" },
    scrollHeight: 40,
  };
  const handle = bindTextareaEditor(textarea as unknown as HTMLTextAreaElement);
  handle.setSelection(1, 3);
  expect(handle.getSelection()).toEqual({ start: 1, end: 3 });
  handle.syncHeight?.(80);
  expect(textarea.style.height).toBe("40px");
});
