import { describe, expect, it } from "vitest";
import { resolveLang } from "../src/i18n/LangProvider.js";
import enMessages from "../src/i18n/messages.en.json";
import zhMessages from "../src/i18n/messages.zh.json";

describe("resolveLang", () => {
  it("keeps English and Chinese message catalogs aligned", () => {
    expect(Object.keys(zhMessages).sort()).toEqual(Object.keys(enMessages).sort());
  });

  it("defaults to zh when navigator language starts with zh", () => {
    expect(resolveLang(null, "zh-CN")).toBe("zh");
    expect(resolveLang(null, "zh-TW")).toBe("zh");
    expect(resolveLang(null, "zh-Hans")).toBe("zh");
    expect(resolveLang(null, "zh")).toBe("zh");
  });

  it("defaults to en for non-zh navigator languages", () => {
    expect(resolveLang(null, "en-US")).toBe("en");
    expect(resolveLang(null, "en-GB")).toBe("en");
    expect(resolveLang(null, "fr-FR")).toBe("en");
    expect(resolveLang(null, "ja-JP")).toBe("en");
  });

  it("uses localStorage override when present", () => {
    expect(resolveLang("zh", "en-US")).toBe("zh");
    expect(resolveLang("en", "zh-CN")).toBe("en");
  });
});
