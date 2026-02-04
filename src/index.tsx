import React, { createContext, useContext, useEffect, useRef, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

export type TranslationCallback = (translatedText: string) => void;

interface BridgeState {
  register: (value: string, onChange: TranslationCallback) => string;
  unregister: (id: string) => void;
  updateValue: (id: string, newValue: string) => void;
  clearTranslateBridge: () => void;
}

class MirrorManager {
  private container: HTMLDivElement;
  private observers: Map<string, Set<TranslationCallback>> = new Map();
  private valueToMirror: Map<string, { id: string; value: string; count: number }> = new Map();
  private idToValue: Map<string, string> = new Map();
  private instanceToMirror: Map<string, string> = new Map();
  private instanceToCallback: Map<string, TranslationCallback> = new Map();
  private mutationObserver: MutationObserver;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'shadow-translate-bridge-mirror';
    
    Object.assign(this.container.style, {
      position: 'absolute',
      width: '1px',
      height: '1px',
      padding: '0',
      margin: '-1px',
      overflow: 'hidden',
      clip: 'rect(0, 0, 0, 0)',
      whiteSpace: 'nowrap',
      borderWidth: '0',
      opacity: '0',
      pointerEvents: 'none',
      zIndex: '-1000'
    });
    
    if (!document.getElementById('shadow-translate-bridge-mirror')) {
        document.body.appendChild(this.container);
    } else {
        this.container = document.getElementById('shadow-translate-bridge-mirror') as HTMLDivElement;
    }

    this.mutationObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList' || mutation.type === 'characterData') {
           let target = mutation.target as HTMLElement;
           if (target.nodeType === Node.TEXT_NODE) {
               target = target.parentElement as HTMLElement;
           }

           const id = target?.dataset?.mirrorId;
           if (id && this.observers.has(id)) {
              const translatedText = target.innerText;
              // 콜백 실행
              this.observers.get(id)!.forEach((callback) => callback(translatedText));
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

  register(value: string, onChange: TranslationCallback): string {
    const existing = this.valueToMirror.get(value);
    if (existing) {
      existing.count += 1;
      this.observers.get(existing.id)?.add(onChange);
      const instanceId = `stb-i-${uuidv4()}`;
      this.instanceToMirror.set(instanceId, existing.id);
      this.instanceToCallback.set(instanceId, onChange);
      return instanceId;
    }

    const mirrorId = `stb-${uuidv4()}`;
    this.valueToMirror.set(value, { id: mirrorId, value, count: 1 });
    this.idToValue.set(mirrorId, value);
    this.observers.set(mirrorId, new Set([onChange]));

    const el = document.createElement('span');
    el.dataset.mirrorId = mirrorId;
    el.innerText = value;
    el.style.display = 'block';

    this.container.appendChild(el);

    const instanceId = `stb-i-${uuidv4()}`;
    this.instanceToMirror.set(instanceId, mirrorId);
    this.instanceToCallback.set(instanceId, onChange);
    return instanceId;
  }

  updateValue(instanceId: string, newValue: string) {
    const mirrorId = this.instanceToMirror.get(instanceId);
    if (!mirrorId) return;

    const currentValue = this.idToValue.get(mirrorId);
    if (currentValue === newValue) return;

    const callback = this.instanceToCallback.get(instanceId);
    if (!callback) return;

    const existingTarget = this.valueToMirror.get(newValue);
    if (existingTarget) {
      this.detachInstance(instanceId, mirrorId, callback);
      existingTarget.count += 1;
      this.observers.get(existingTarget.id)?.add(callback);
      this.instanceToMirror.set(instanceId, existingTarget.id);
      return;
    }

    const currentEntry = currentValue ? this.valueToMirror.get(currentValue) : undefined;
    if (currentEntry && currentEntry.count === 1) {
      const el = this.container.querySelector(`[data-mirror-id="${mirrorId}"]`) as HTMLElement | null;
      if (el && el.innerText !== newValue) {
        el.innerText = newValue;
      }
      this.valueToMirror.delete(currentEntry.value);
      currentEntry.value = newValue;
      this.valueToMirror.set(newValue, currentEntry);
      this.idToValue.set(mirrorId, newValue);
      return;
    }

    this.detachInstance(instanceId, mirrorId, callback);
    const newMirrorId = `stb-${uuidv4()}`;
    this.valueToMirror.set(newValue, { id: newMirrorId, value: newValue, count: 1 });
    this.idToValue.set(newMirrorId, newValue);
    this.observers.set(newMirrorId, new Set([callback]));

    const el = document.createElement('span');
    el.dataset.mirrorId = newMirrorId;
    el.innerText = newValue;
    el.style.display = 'block';

    this.container.appendChild(el);
    this.instanceToMirror.set(instanceId, newMirrorId);
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
    this.idToValue.clear();
    this.instanceToMirror.clear();
    this.instanceToCallback.clear();
    this.container.innerHTML = '';
  }

  private detachInstance(instanceId: string, mirrorId: string, callback: TranslationCallback) {
    const mirrorValue = this.idToValue.get(mirrorId);
    if (mirrorValue) {
      const entry = this.valueToMirror.get(mirrorValue);
      if (entry) {
        entry.count -= 1;
        if (entry.count <= 0) {
          this.valueToMirror.delete(mirrorValue);
          this.idToValue.delete(mirrorId);
          this.observers.delete(mirrorId);
          const el = this.container.querySelector(`[data-mirror-id="${mirrorId}"]`);
          el?.remove();
        }
      }
    }

    const observerSet = this.observers.get(mirrorId);
    observerSet?.delete(callback);
    if (observerSet && observerSet.size === 0) {
      this.observers.delete(mirrorId);
    }
    this.instanceToMirror.delete(instanceId);
    this.instanceToCallback.delete(instanceId);
  }
  
  disconnect() {
      this.mutationObserver.disconnect();
      this.container.remove();
  }
}

const BridgeContext = createContext<BridgeState | null>(null);

export const TranslationBridgeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const manager = useMemo(() => new MirrorManager(), []);

  const api = useMemo(() => ({
    register: (val: string, cb: TranslationCallback) => manager.register(val, cb),
    unregister: (id: string) => manager.unregister(id),
    updateValue: (id: string, val: string) => manager.updateValue(id, val),
    clearTranslateBridge: () => manager.clearTranslateBridge(),
  }), [manager]);

  return <BridgeContext.Provider value={api}>{children}</BridgeContext.Provider>;
};

export const useShadowTranslation = (value: string, onChange: TranslationCallback) => {
  const bridge = useContext(BridgeContext);
  const idRef = useRef<string | null>(null);

  if (!bridge) {
    console.warn('useShadowTranslation must be used within a TranslationBridgeProvider');
    return;
  }

  useEffect(() => {
    idRef.current = bridge.register(value, onChange);

    return () => {
      if (idRef.current) bridge.unregister(idRef.current);
    };
  }, []);

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

export const useClearTranslateBridge = () => {
  const bridge = useContext(BridgeContext);

  if (!bridge) {
    console.warn('useClearTranslateBridge must be used within a TranslationBridgeProvider');
    return () => undefined;
  }

  return bridge.clearTranslateBridge;
};
