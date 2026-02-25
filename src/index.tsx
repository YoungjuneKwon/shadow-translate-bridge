import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useMemo,
  useState,
} from "react";
import { v4 as uuidv4 } from "uuid";

export type TranslationCallback = (translatedText: string) => void;

export type TranslateMode = "text" | "html";

export interface TranslateOptions {
  mode?: TranslateMode;
}

interface BridgeState {
  register: (
    value: string,
    onChange: TranslationCallback,
    options?: TranslateOptions,
  ) => string;
  unregister: (id: string) => void;
  updateValue: (id: string, newValue: string) => void;
  clearTranslateBridge: () => void;
}

interface MirrorEntry {
  id: string;
  value: string;
  count: number;
  mode: TranslateMode;
  template?: string;
  textCount?: number;
}

const HTML_TEXT_PLACEHOLDER_PREFIX = "__STB_TEXT_";
const HTML_TEXT_PLACEHOLDER_SUFFIX = "__";
const HTML_SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT"]);

class MirrorManager {
  private container: HTMLDivElement;
  private observers: Map<string, Set<TranslationCallback>> = new Map();
  private valueToMirror: Map<string, MirrorEntry> = new Map();
  private idToEntry: Map<string, MirrorEntry> = new Map();
  private instanceToMirror: Map<string, string> = new Map();
  private instanceToCallback: Map<string, TranslationCallback> = new Map();
  private instanceToMode: Map<string, TranslateMode> = new Map();
  private mutationObserver: MutationObserver;

  constructor() {
    this.container = document.createElement("div");
    this.container.id = "shadow-translate-bridge-mirror";

    Object.assign(this.container.style, {
      position: "absolute",
      width: "1px",
      height: "1px",
      padding: "0",
      margin: "-1px",
      overflow: "hidden",
      clip: "rect(0, 0, 0, 0)",
      whiteSpace: "nowrap",
      borderWidth: "0",
      opacity: "0",
      pointerEvents: "none",
      zIndex: "-1000",
    });

    if (!document.getElementById("shadow-translate-bridge-mirror")) {
      document.body.appendChild(this.container);
    } else {
      this.container = document.getElementById(
        "shadow-translate-bridge-mirror",
      ) as HTMLDivElement;
    }

    this.mutationObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === "childList" ||
          mutation.type === "characterData"
        ) {
          const mirrorElement = this.findMirrorElement(mutation.target);
          const id = mirrorElement?.dataset?.mirrorId;
          if (id && this.observers.has(id)) {
            const entry = this.idToEntry.get(id);
            if (entry?.mode === "html") {
              const translatedHtml = this.buildTranslatedHtml(
                mirrorElement,
                entry,
              );
              this.observers
                .get(id)!
                .forEach((callback) => callback(translatedHtml));
              return;
            }

            const translatedText = mirrorElement.innerText;
            // 콜백 실행
            this.observers
              .get(id)!
              .forEach((callback) => callback(translatedText));
          }
        }
      });
    });

    this.mutationObserver.observe(this.container, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  register(
    value: string,
    onChange: TranslationCallback,
    options?: TranslateOptions,
  ): string {
    const mode = this.getTranslateMode(options);
    const key = this.getValueKey(mode, value);
    const existing = this.valueToMirror.get(key);
    if (existing) {
      existing.count += 1;
      this.observers.get(existing.id)?.add(onChange);
      const instanceId = `stb-i-${uuidv4()}`;
      this.instanceToMirror.set(instanceId, existing.id);
      this.instanceToCallback.set(instanceId, onChange);
      this.instanceToMode.set(instanceId, mode);
      return instanceId;
    }

    const mirrorId = `stb-${uuidv4()}`;
    const entry: MirrorEntry = { id: mirrorId, value, count: 1, mode };
    this.valueToMirror.set(key, entry);
    this.idToEntry.set(mirrorId, entry);
    this.observers.set(mirrorId, new Set([onChange]));

    const el = document.createElement("div");
    el.dataset.mirrorId = mirrorId;
    if (mode === "html") {
      const { htmlWithSpans, template, textCount } =
        this.buildHtmlMirror(value);
      entry.template = template;
      entry.textCount = textCount;
      el.innerHTML = htmlWithSpans;
    } else {
      el.innerText = value;
    }
    el.style.display = "block";

    this.container.appendChild(el);

    const instanceId = `stb-i-${uuidv4()}`;
    this.instanceToMirror.set(instanceId, mirrorId);
    this.instanceToCallback.set(instanceId, onChange);
    this.instanceToMode.set(instanceId, mode);
    return instanceId;
  }

  updateValue(instanceId: string, newValue: string) {
    const mirrorId = this.instanceToMirror.get(instanceId);
    if (!mirrorId) return;

    const mode = this.instanceToMode.get(instanceId) || "text";
    const currentEntry = this.idToEntry.get(mirrorId);
    const currentValue = currentEntry?.value;
    if (currentValue === newValue) return;

    const callback = this.instanceToCallback.get(instanceId);
    if (!callback) return;

    const existingTarget = this.valueToMirror.get(
      this.getValueKey(mode, newValue),
    );
    if (existingTarget) {
      this.detachInstance(instanceId, mirrorId, callback);
      existingTarget.count += 1;
      this.observers.get(existingTarget.id)?.add(callback);
      this.instanceToMirror.set(instanceId, existingTarget.id);
      this.instanceToMode.set(instanceId, existingTarget.mode);
      return;
    }

    if (currentEntry && currentEntry.count === 1) {
      const el = this.container.querySelector(
        `[data-mirror-id="${mirrorId}"]`,
      ) as HTMLElement | null;
      if (el) {
        if (mode === "html") {
          const { htmlWithSpans, template, textCount } =
            this.buildHtmlMirror(newValue);
          el.innerHTML = htmlWithSpans;
          currentEntry.template = template;
          currentEntry.textCount = textCount;
        } else if (el.innerText !== newValue) {
          el.innerText = newValue;
        }
      }
      this.valueToMirror.delete(
        this.getValueKey(currentEntry.mode, currentEntry.value),
      );
      currentEntry.value = newValue;
      this.valueToMirror.set(
        this.getValueKey(currentEntry.mode, newValue),
        currentEntry,
      );
      return;
    }

    this.detachInstance(instanceId, mirrorId, callback);
    const newMirrorId = `stb-${uuidv4()}`;
    const entry: MirrorEntry = {
      id: newMirrorId,
      value: newValue,
      count: 1,
      mode,
    };
    this.valueToMirror.set(this.getValueKey(mode, newValue), entry);
    this.idToEntry.set(newMirrorId, entry);
    this.observers.set(newMirrorId, new Set([callback]));

    const el = document.createElement("div");
    el.dataset.mirrorId = newMirrorId;
    if (mode === "html") {
      const { htmlWithSpans, template, textCount } =
        this.buildHtmlMirror(newValue);
      entry.template = template;
      entry.textCount = textCount;
      el.innerHTML = htmlWithSpans;
    } else {
      el.innerText = newValue;
    }
    el.style.display = "block";

    this.container.appendChild(el);
    this.instanceToMirror.set(instanceId, newMirrorId);
    this.instanceToMode.set(instanceId, mode);
  }

  unregister(instanceId: string) {
    const mirrorId = this.instanceToMirror.get(instanceId);
    const callback = this.instanceToCallback.get(instanceId);
    if (!mirrorId || !callback) return;

    this.detachInstance(instanceId, mirrorId, callback);
  }

  clearTranslateBridge() {
    this.observers.clear();
    this.valueToMirror.clear();
    this.idToEntry.clear();
    this.instanceToMirror.clear();
    this.instanceToCallback.clear();
    this.instanceToMode.clear();
    this.container.innerHTML = "";
  }

  private detachInstance(
    instanceId: string,
    mirrorId: string,
    callback: TranslationCallback,
  ) {
    const entry = this.idToEntry.get(mirrorId);
    if (entry) {
      entry.count -= 1;
      if (entry.count <= 0) {
        this.valueToMirror.delete(this.getValueKey(entry.mode, entry.value));
        this.idToEntry.delete(mirrorId);
        this.observers.delete(mirrorId);
        const el = this.container.querySelector(
          `[data-mirror-id="${mirrorId}"]`,
        );
        el?.remove();
      }
    }

    const observerSet = this.observers.get(mirrorId);
    observerSet?.delete(callback);
    if (observerSet && observerSet.size === 0) {
      this.observers.delete(mirrorId);
    }
    this.instanceToMirror.delete(instanceId);
    this.instanceToCallback.delete(instanceId);
    this.instanceToMode.delete(instanceId);
  }

  disconnect() {
    this.mutationObserver.disconnect();
    this.container.remove();
  }

  private getTranslateMode(options?: TranslateOptions): TranslateMode {
    return options?.mode === "html" ? "html" : "text";
  }

  private getValueKey(mode: TranslateMode, value: string) {
    return `${mode}:${value}`;
  }

  private findMirrorElement(target: Node): HTMLElement | null {
    let element =
      target.nodeType === Node.TEXT_NODE
        ? (target.parentElement as HTMLElement | null)
        : (target as HTMLElement | null);
    while (
      element &&
      element !== this.container &&
      !element.dataset?.mirrorId
    ) {
      element = element.parentElement;
    }
    return element?.dataset?.mirrorId ? element : null;
  }

  private collectTranslatableTextNodes(root: HTMLElement): Text[] {
    const nodes: Text[] = [];
    const doc = root.ownerDocument;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    while (current) {
      const textNode = current as Text;
      const parent = textNode.parentElement;
      const text = textNode.textContent || "";
      if (parent && !HTML_SKIP_TAGS.has(parent.tagName) && text.trim()) {
        nodes.push(textNode);
      }
      current = walker.nextNode();
    }
    return nodes;
  }

  private buildHtmlMirror(value: string) {
    const parser = new DOMParser();
    const baseDoc = parser.parseFromString(value, "text/html");
    const mirrorDoc = baseDoc.cloneNode(true) as Document;
    const templateDoc = baseDoc.cloneNode(true) as Document;

    const mirrorTextNodes = this.collectTranslatableTextNodes(mirrorDoc.body);
    const templateTextNodes = this.collectTranslatableTextNodes(
      templateDoc.body,
    );
    const count = Math.min(mirrorTextNodes.length, templateTextNodes.length);

    for (let i = 0; i < count; i += 1) {
      const mirrorNode = mirrorTextNodes[i];
      const span = mirrorDoc.createElement("span");
      span.dataset.stbTextId = String(i);
      span.textContent = mirrorNode.textContent || "";
      mirrorNode.parentNode?.replaceChild(span, mirrorNode);

      const templateNode = templateTextNodes[i];
      templateNode.textContent = `${HTML_TEXT_PLACEHOLDER_PREFIX}${i}${HTML_TEXT_PLACEHOLDER_SUFFIX}`;
    }

    return {
      htmlWithSpans: mirrorDoc.body.innerHTML,
      template: templateDoc.body.innerHTML,
      textCount: count,
    };
  }

  private buildTranslatedHtml(mirrorElement: HTMLElement, entry: MirrorEntry) {
    if (!entry.template) return mirrorElement.innerText;

    const textNodes = Array.from(
      mirrorElement.querySelectorAll("[data-stb-text-id]"),
    ) as HTMLElement[];
    const count = entry.textCount ?? textNodes.length;
    const translatedTextList = new Array<string>(count).fill("");

    textNodes.forEach((node) => {
      const id = Number(node.dataset.stbTextId);
      if (!Number.isNaN(id)) {
        translatedTextList[id] = node.innerText || "";
      }
    });

    let result = entry.template;
    for (let i = 0; i < translatedTextList.length; i += 1) {
      const placeholder = `${HTML_TEXT_PLACEHOLDER_PREFIX}${i}${HTML_TEXT_PLACEHOLDER_SUFFIX}`;
      result = result
        .split(placeholder)
        .join(this.escapeHtml(translatedTextList[i] || ""));
    }
    return result;
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}

const BridgeContext = createContext<BridgeState | null>(null);

export const TranslationBridgeProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const manager = useMemo(() => new MirrorManager(), []);

  const api = useMemo(
    () => ({
      register: (val: string, cb: TranslationCallback) =>
        manager.register(val, cb),
      unregister: (id: string) => manager.unregister(id),
      updateValue: (id: string, val: string) => manager.updateValue(id, val),
      clearTranslateBridge: () => manager.clearTranslateBridge(),
    }),
    [manager],
  );

  return (
    <BridgeContext.Provider value={api}>{children}</BridgeContext.Provider>
  );
};

export const useShadowTranslation = (
  value: string,
  onChange: TranslationCallback,
  options?: TranslateOptions,
) => {
  const bridge = useContext(BridgeContext);
  const idRef = useRef<string | null>(null);

  if (!bridge) {
    console.warn(
      "useShadowTranslation must be used within a TranslationBridgeProvider",
    );
    return;
  }

  useEffect(() => {
    idRef.current = bridge.register(value, onChange, options);

    return () => {
      if (idRef.current) bridge.unregister(idRef.current);
    };
  }, [bridge, onChange, options?.mode]);

  useEffect(() => {
    if (idRef.current) {
      bridge.updateValue(idRef.current, value);
    }
  }, [value, bridge]);
};

export const useTranslateBridge = (value: string) => {
  const [translated, setTranslated] = useState(value);

  useShadowTranslation(value, setTranslated);

  return translated;
};

export const useTranslateBridgeHtml = (value: string) => {
  const [translated, setTranslated] = useState(value);

  useShadowTranslation(value, setTranslated, { mode: "html" });

  return translated;
};

export const useClearTranslateBridge = () => {
  const bridge = useContext(BridgeContext);

  if (!bridge) {
    console.warn(
      "useClearTranslateBridge must be used within a TranslationBridgeProvider",
    );
    return () => undefined;
  }

  return bridge.clearTranslateBridge;
};
