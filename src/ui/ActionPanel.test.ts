import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import type { Action } from "../engine";
import i18n, { i18nReady } from "../i18n";
import { ActionPanel, mayorConfirmBlocked } from "./ActionPanel";

function renderMayor(legal: Action[]) {
  return renderToStaticMarkup(
    createElement(ActionPanel, {
      legal,
      onAct: () => undefined,
      busy: false,
      prompt: "市長",
      phaseType: "mayorAssign",
    }),
  );
}

beforeAll(async () => {
  await i18nReady;
  await i18n.changeLanguage("zh-Hant");
});

describe("ActionPanel mayor confirm", () => {
  it("stays enabled after all colonists are placed, even without board-mapped actions", () => {
    const html = renderMayor([{ type: "mayorDone" }]);
    expect(html).toContain("確定");
    expect(html).not.toMatch(/disabled/);
    expect(html).not.toContain(mayorConfirmBlocked());
  });

  it("disables confirm and explains why when colonists still need placing", () => {
    const html = renderMayor([{ type: "mayorPlace", target: { kind: "island", index: 0 } }]);
    expect(html).toMatch(/disabled/);
    expect(html).toContain(mayorConfirmBlocked());
  });
});
