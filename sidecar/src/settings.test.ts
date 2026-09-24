// TDD para a validação em runtime dos JSONs de Settings (T-003).
// Contrato canônico dos tipos: contracts/settings.ts (RF-700/RF-600).

import { describe, expect, it } from "vitest";
import {
  DEFAULT_FEATURE_TOGGLES,
  DEFAULT_SHORTCUTS,
  parseFeatureToggles,
  parseShortcutMap,
} from "./settings.js";

describe("parseFeatureToggles", () => {
  it("accepts the default feature toggle set", () => {
    const result = parseFeatureToggles(DEFAULT_FEATURE_TOGGLES);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(DEFAULT_FEATURE_TOGGLES);
    }
  });

  it("rejects a non-object value", () => {
    const result = parseFeatureToggles("not-an-object");

    expect(result.ok).toBe(false);
  });

  it("fills a missing toggle with the contract default (legacy blobs stay valid)", () => {
    // Blobs persistidos antes de um toggle novo (ex.: pushToListen) não
    // podem descartar as preferências do usuário na leitura — a chave
    // ausente herda o default; as demais preservam o valor salvo.
    const { pushToListen: _pushToListen, ...legacyBlob } = DEFAULT_FEATURE_TOGGLES;
    const result = parseFeatureToggles({ ...legacyBlob, autoScroll: false });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pushToListen).toBe(DEFAULT_FEATURE_TOGGLES.pushToListen);
      expect(result.value.autoScroll).toBe(false);
    }
  });

  it("rejects a toggle with the wrong type", () => {
    const result = parseFeatureToggles({ ...DEFAULT_FEATURE_TOGGLES, autoScroll: "yes" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.path === "autoScroll")).toBe(true);
    }
  });

  it("rejects an unknown toggle name", () => {
    const result = parseFeatureToggles({ ...DEFAULT_FEATURE_TOGGLES, madeUpToggle: true });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.path === "madeUpToggle")).toBe(true);
    }
  });
});

describe("parseShortcutMap", () => {
  it("accepts the default shortcut set", () => {
    const result = parseShortcutMap(DEFAULT_SHORTCUTS);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(DEFAULT_SHORTCUTS);
    }
  });

  it("rejects a non-object value", () => {
    const result = parseShortcutMap(42);

    expect(result.ok).toBe(false);
  });

  it("rejects an unknown shortcut command", () => {
    const result = parseShortcutMap({ ...DEFAULT_SHORTCUTS, madeUpCommand: null });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.path === "madeUpCommand")).toBe(true);
    }
  });

  it("rejects a binding without a modifier and a key that is not an allowed modifierless key (RF-602)", () => {
    const result = parseShortcutMap({
      ...DEFAULT_SHORTCUTS,
      captureScreen: { enabled: true, modifiers: [], key: "E" },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.path === "captureScreen")).toBe(true);
    }
  });

  it("accepts a binding without a modifier when the key is an allowed modifierless key (RF-602)", () => {
    const result = parseShortcutMap({
      ...DEFAULT_SHORTCUTS,
      captureScreen: { enabled: true, modifiers: [], key: "CapsLock" },
    });

    expect(result.ok).toBe(true);
  });

  it("rejects duplicate key combinations across two enabled shortcuts (RF-602)", () => {
    const result = parseShortcutMap({
      ...DEFAULT_SHORTCUTS,
      captureScreen: { enabled: true, modifiers: ["Cmd"], key: "D" },
      toggleVoiceRecording: { enabled: true, modifiers: ["Cmd"], key: "D" },
    });

    expect(result.ok).toBe(false);
  });

  it("rejects an invalid modifier name", () => {
    const result = parseShortcutMap({
      ...DEFAULT_SHORTCUTS,
      captureScreen: { enabled: true, modifiers: ["Meta"], key: "E" },
    });

    expect(result.ok).toBe(false);
  });
});
